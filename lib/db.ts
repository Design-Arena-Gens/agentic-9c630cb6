import 'server-only';

import fs from 'fs/promises';
import path from 'path';
import { sql } from '@vercel/postgres';
import { getConfig } from './config';

export type VideoStatus = 'new' | 'scheduled' | 'processing' | 'uploaded' | 'failed';

export interface VideoRecord {
  id: number;
  filename: string;
  status: VideoStatus;
  fileHash: string | null;
  fileSize: number | null;
  scheduledAt: Date | null;
  uploadedAt: Date | null;
  youtubeVideoId: string | null;
  metadata: Record<string, unknown> | null;
  analytics: Record<string, unknown> | null;
  error: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedVideoRecord extends Omit<VideoRecord, 'scheduledAt' | 'uploadedAt' | 'createdAt' | 'updatedAt'> {
  scheduledAt: string | null;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FileStoreShape {
  lastId: number;
  videos: SerializedVideoRecord[];
}

const hasDatabaseUrl = Boolean(
  process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL,
);

const config = getConfig();
const fileStorePath = path.isAbsolute(config.dataStore)
  ? config.dataStore
  : path.join(process.cwd(), config.dataStore);

function deserialize(record: SerializedVideoRecord): VideoRecord {
  return {
    ...record,
    scheduledAt: record.scheduledAt ? new Date(record.scheduledAt) : null,
    uploadedAt: record.uploadedAt ? new Date(record.uploadedAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function serialize(record: VideoRecord): SerializedVideoRecord {
  return {
    ...record,
    scheduledAt: record.scheduledAt ? record.scheduledAt.toISOString() : null,
    uploadedAt: record.uploadedAt ? record.uploadedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function readFileStore(): Promise<FileStoreShape> {
  try {
    const content = await fs.readFile(fileStorePath, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      lastId: Number(parsed.lastId ?? 0),
      videos: Array.isArray(parsed.videos) ? parsed.videos : [],
    };
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        await fs.mkdir(path.dirname(fileStorePath), { recursive: true });
        const initial: FileStoreShape = { lastId: 0, videos: [] };
        await fs.writeFile(fileStorePath, JSON.stringify(initial, null, 2), 'utf-8');
        return initial;
      }
    }
    throw error;
  }
}

async function writeFileStore(store: FileStoreShape) {
  await fs.mkdir(path.dirname(fileStorePath), { recursive: true });
  await fs.writeFile(fileStorePath, JSON.stringify(store, null, 2), 'utf-8');
}

export async function ensureSchema() {
  if (!hasDatabaseUrl) {
    await readFileStore();
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ,
      uploaded_at TIMESTAMPTZ,
      youtube_video_id TEXT,
      metadata JSONB,
      analytics JSONB,
      file_hash TEXT,
      file_size BIGINT,
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_hash TEXT`;
  await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_size BIGINT`;

  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      payload JSONB
    )
  `;
}

function mapVideoRow(row: Record<string, unknown>): VideoRecord {
  const metadataRaw = row.metadata;
  let metadata: Record<string, unknown> | null = null;
  if (typeof metadataRaw === 'string') {
    try {
      metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  } else if (metadataRaw && typeof metadataRaw === 'object') {
    metadata = metadataRaw as Record<string, unknown>;
  }

  const analyticsRaw = row.analytics;
  let analytics: Record<string, unknown> | null = null;
  if (typeof analyticsRaw === 'string') {
    try {
      analytics = JSON.parse(analyticsRaw) as Record<string, unknown>;
    } catch {
      analytics = null;
    }
  } else if (analyticsRaw && typeof analyticsRaw === 'object') {
    analytics = analyticsRaw as Record<string, unknown>;
  }

  return {
    id: Number(row.id),
    filename: String(row.filename),
    status: row.status as VideoStatus,
    fileHash: (row.file_hash as string | null) ?? null,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    scheduledAt: row.scheduled_at ? new Date(String(row.scheduled_at)) : null,
    uploadedAt: row.uploaded_at ? new Date(String(row.uploaded_at)) : null,
    youtubeVideoId: (row.youtube_video_id as string | null) ?? null,
    metadata,
    analytics,
    error: (row.error as string | null) ?? null,
    retryCount: row.retry_count != null ? Number(row.retry_count) : 0,
    createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)) : new Date(),
  };
}

async function getFileVideos(): Promise<VideoRecord[]> {
  const store = await readFileStore();
  return store.videos.map(deserialize);
}

async function saveFileVideos(videos: VideoRecord[]) {
  const lastId = videos.reduce((acc, video) => Math.max(acc, video.id), 0);
  await writeFileStore({ lastId, videos: videos.map(serialize) });
}

async function allocateFileId(): Promise<number> {
  const store = await readFileStore();
  const nextId = store.lastId + 1;
  await writeFileStore({ ...store, lastId: nextId });
  return nextId;
}

export async function getVideoByFilename(filename: string): Promise<VideoRecord | null> {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    return videos.find((video) => video.filename === filename) ?? null;
  }
  const { rows } = await sql`SELECT * FROM videos WHERE filename = ${filename}`;
  if (rows.length === 0) return null;
  return mapVideoRow(rows[0]);
}

export async function getVideoByHash(hash: string): Promise<VideoRecord | null> {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    return videos.find((video) => video.fileHash === hash) ?? null;
  }
  const { rows } = await sql`SELECT * FROM videos WHERE file_hash = ${hash}`;
  if (rows.length === 0) return null;
  return mapVideoRow(rows[0]);
}

export async function upsertVideoRecord(record: {
  filename: string;
  status: VideoStatus;
  scheduledAt?: Date | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
  youtubeVideoId?: string | null;
  uploadedAt?: Date | null;
  fileHash?: string | null;
  fileSize?: number | null;
}) {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    const index = videos.findIndex((video) => video.filename === record.filename);
    const now = new Date();
    if (index >= 0) {
      const existing = videos[index];
      videos[index] = {
        ...existing,
        status: record.status,
        scheduledAt: record.scheduledAt ?? existing.scheduledAt,
        metadata: record.metadata ?? existing.metadata,
        error: record.error ?? existing.error,
        youtubeVideoId: record.youtubeVideoId ?? existing.youtubeVideoId,
        uploadedAt: record.uploadedAt ?? existing.uploadedAt,
        fileHash: record.fileHash ?? existing.fileHash,
        fileSize: record.fileSize ?? existing.fileSize,
        updatedAt: now,
      };
    } else {
      videos.push({
        id: await allocateFileId(),
        filename: record.filename,
        status: record.status,
        fileHash: record.fileHash ?? null,
        fileSize: record.fileSize ?? null,
        scheduledAt: record.scheduledAt ?? null,
        uploadedAt: record.uploadedAt ?? null,
        youtubeVideoId: record.youtubeVideoId ?? null,
        metadata: record.metadata ?? null,
        analytics: null,
        error: record.error ?? null,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await saveFileVideos(videos);
    return;
  }

  const metadataJson = record.metadata ? JSON.stringify(record.metadata) : null;

  await sql`
    INSERT INTO videos (filename, status, scheduled_at, metadata, error, youtube_video_id, uploaded_at, file_hash, file_size)
    VALUES (
      ${record.filename},
      ${record.status},
      ${record.scheduledAt ? record.scheduledAt.toISOString() : null},
      ${metadataJson},
      ${record.error ?? null},
      ${record.youtubeVideoId ?? null},
      ${record.uploadedAt ? record.uploadedAt.toISOString() : null},
      ${record.fileHash ?? null},
      ${record.fileSize ?? null}
    )
    ON CONFLICT (filename)
    DO UPDATE SET
      status = EXCLUDED.status,
      scheduled_at = EXCLUDED.scheduled_at,
      metadata = EXCLUDED.metadata,
      error = EXCLUDED.error,
      youtube_video_id = COALESCE(EXCLUDED.youtube_video_id, videos.youtube_video_id),
      uploaded_at = COALESCE(EXCLUDED.uploaded_at, videos.uploaded_at),
      file_hash = COALESCE(EXCLUDED.file_hash, videos.file_hash),
      file_size = COALESCE(EXCLUDED.file_size, videos.file_size),
      updated_at = NOW()
  `;
}

export async function markVideoAsProcessing(filename: string) {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    const index = videos.findIndex((video) => video.filename === filename);
    if (index >= 0) {
      videos[index] = {
        ...videos[index],
        status: 'processing',
        updatedAt: new Date(),
      };
      await saveFileVideos(videos);
    }
    return;
  }

  await sql`
    UPDATE videos SET status = 'processing', updated_at = NOW()
    WHERE filename = ${filename}
  `;
}

export async function markVideoAsUploaded(
  filename: string,
  youtubeVideoId: string,
  metadata: Record<string, unknown>,
) {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    const index = videos.findIndex((video) => video.filename === filename);
    if (index >= 0) {
      const now = new Date();
      videos[index] = {
        ...videos[index],
        status: 'uploaded',
        youtubeVideoId,
        uploadedAt: now,
        metadata,
        error: null,
        updatedAt: now,
      };
      await saveFileVideos(videos);
    }
    return;
  }

  await sql`
    UPDATE videos
    SET status = 'uploaded',
        youtube_video_id = ${youtubeVideoId},
        uploaded_at = NOW(),
        metadata = ${JSON.stringify(metadata)},
        updated_at = NOW(),
        error = NULL
    WHERE filename = ${filename}
  `;
}

export async function recordVideoError(filename: string, error: string) {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    const index = videos.findIndex((video) => video.filename === filename);
    if (index >= 0) {
      videos[index] = {
        ...videos[index],
        status: 'failed',
        error,
        retryCount: videos[index].retryCount + 1,
        updatedAt: new Date(),
      };
      await saveFileVideos(videos);
    }
    return;
  }

  await sql`
    UPDATE videos
    SET status = 'failed',
        error = ${error},
        retry_count = COALESCE(retry_count, 0) + 1,
        updated_at = NOW()
    WHERE filename = ${filename}
  `;
}

export async function listPendingUploads(): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    return videos
      .filter((video) => ['new', 'scheduled', 'failed'].includes(video.status))
      .sort((a, b) => {
        const aTime = a.scheduledAt?.getTime() ?? a.createdAt.getTime();
        const bTime = b.scheduledAt?.getTime() ?? b.createdAt.getTime();
        return aTime - bTime;
      });
  }

  const { rows } = await sql`
    SELECT * FROM videos
    WHERE status IN ('new', 'scheduled', 'failed')
    ORDER BY scheduled_at NULLS FIRST, created_at ASC
  `;
  return rows.map((row) => mapVideoRow(row as Record<string, unknown>));
}

export async function listReadyToUpload(now: Date): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    return videos.filter((video) => {
      if (!['scheduled', 'failed'].includes(video.status)) return false;
      if (!video.scheduledAt) return true;
      return video.scheduledAt <= now;
    });
  }

  const { rows } = await sql`
    SELECT * FROM videos
    WHERE status IN ('scheduled', 'failed')
      AND (scheduled_at IS NULL OR scheduled_at <= ${now.toISOString()})
    ORDER BY scheduled_at ASC NULLS FIRST
  `;
  return rows.map((row) => mapVideoRow(row as Record<string, unknown>));
}

export async function storeAnalytics(
  videoId: number,
  analytics: Record<string, unknown>,
) {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    const index = videos.findIndex((video) => video.id === videoId);
    if (index >= 0) {
      videos[index] = {
        ...videos[index],
        analytics,
        updatedAt: new Date(),
      };
      await saveFileVideos(videos);
    }
    return;
  }

  await sql`
    UPDATE videos
    SET analytics = ${JSON.stringify(analytics)},
        updated_at = NOW()
    WHERE id = ${videoId}
  `;
}

export async function listVideos(limit = 50): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl) {
    const videos = await getFileVideos();
    return videos
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  const { rows } = await sql`
    SELECT * FROM videos ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => mapVideoRow(row as Record<string, unknown>));
}
