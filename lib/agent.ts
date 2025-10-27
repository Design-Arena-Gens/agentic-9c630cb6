import 'server-only';

import path from 'path';
import fs from 'fs/promises';
import { getConfig } from './config';
import {
  ensureSchema,
  getVideoByFilename,
  getVideoByHash,
  listPendingUploads,
  listReadyToUpload,
  listVideos,
  markVideoAsProcessing,
  markVideoAsUploaded,
  recordVideoError,
  upsertVideoRecord,
} from './db';
import { listVideoFiles, VideoFileDescriptor } from './fs-utils';
import { buildVideoMetadata, persistMetadataSnapshot, VideoMetadata } from './metadata';
import { augmentMetadataWithTrending } from './trending';
import { generateThumbnail } from './thumbnails';
import { applyWatermark } from './watermark';
import { uploadShort } from './youtube';
import { computeNextSchedule } from './scheduler';
import { sendUploadNotification } from './notifications';
import { refreshAnalyticsForVideos } from './analytics';
import { logger } from './logger';

export interface AgentRunResult {
  scanned: number;
  scheduled: number;
  uploaded: number;
  failed: number;
  errors: string[];
}

async function resolveVideoDescriptor(filename: string): Promise<VideoFileDescriptor | null> {
  const config = getConfig();
  const filepath = path.join(config.contentDir, filename);
  try {
    const stat = await fs.stat(filepath);
    if (!stat.isFile()) return null;
    return {
      filepath,
      filename,
      hash: null,
      size: stat.size,
      durationSeconds: null,
    };
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return null;
    }
    throw error;
  }
}

function toVideoMetadata(metadata: Record<string, unknown> | null): VideoMetadata | null {
  if (!metadata) return null;
  return {
    title: (metadata.title as string | undefined) ?? 'Untitled Short',
    description: (metadata.description as string | undefined) ?? '',
    tags: (metadata.tags as string[] | undefined) ?? [],
    hashtags: (metadata.hashtags as string[] | undefined) ?? [],
    language: (metadata.language as string | undefined) ?? 'en',
    scheduleHint: metadata.scheduleHint as string | undefined,
    thumbnailText: metadata.thumbnailText as string | undefined,
    translatedDescriptions: metadata.translatedDescriptions as Record<string, string> | undefined,
    generatedByAi: metadata.generatedByAi as boolean | undefined,
    sourceMetadataPath: (metadata.sourceMetadataPath as string | null | undefined) ?? null,
  };
}

export async function runAgent(): Promise<AgentRunResult> {
  await ensureSchema();
  const result: AgentRunResult = {
    scanned: 0,
    scheduled: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  const config = getConfig();
  const availableVideos = await listVideoFiles();
  result.scanned = availableVideos.length;

  const videosInDb = await listVideos(200);
  const schedulingState = [...videosInDb];

  for (const video of availableVideos) {
    const alreadyUploadedByHash = video.hash ? await getVideoByHash(video.hash) : null;
    if (alreadyUploadedByHash && alreadyUploadedByHash.youtubeVideoId) {
      logger.info('Skipping already uploaded hash', { video: video.filename });
      continue;
    }

    const existing = await getVideoByFilename(video.filename);
    if (existing && existing.status === 'uploaded') {
      logger.info('Skipping already uploaded video filename', { video: video.filename });
      continue;
    }

    if (existing && existing.status === 'scheduled') {
      logger.debug('Video already scheduled', { video: video.filename });
      continue;
    }

    const metadata = await buildVideoMetadata(video);
    const enrichedMetadata = await augmentMetadataWithTrending(metadata);
    await persistMetadataSnapshot(video, enrichedMetadata);

    const nextSchedule = computeNextSchedule(schedulingState);
    const metadataPayload: Record<string, unknown> = { ...enrichedMetadata };

    await upsertVideoRecord({
      filename: video.filename,
      status: nextSchedule ? 'scheduled' : 'new',
      scheduledAt: nextSchedule,
      metadata: metadataPayload,
      fileHash: video.hash,
      fileSize: video.size,
    });

    schedulingState.push({
      id: -1,
      filename: video.filename,
      status: nextSchedule ? 'scheduled' : 'new',
      fileHash: video.hash,
      fileSize: video.size,
      scheduledAt: nextSchedule,
      uploadedAt: null,
      youtubeVideoId: null,
      metadata: metadataPayload,
      analytics: null,
      error: null,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    result.scheduled += 1;
  }

  const queue = await listReadyToUpload(new Date());
  if (queue.length > 0) {
    logger.info('Processing upload queue', { count: queue.length });
  }

  for (const record of queue) {
    try {
      await markVideoAsProcessing(record.filename);
      const descriptor =
        availableVideos.find((video) => video.filename === record.filename) ??
        (await resolveVideoDescriptor(record.filename));
      if (!descriptor) {
        throw new Error(`Video file not found: ${record.filename}`);
      }

      const metadata = toVideoMetadata(record.metadata);
      if (!metadata) {
        throw new Error(`Metadata missing for video ${record.filename}`);
      }

      const processedVideoPath = await applyWatermark(descriptor);
      const thumbnail = await generateThumbnail(descriptor, metadata);

      const upload = await uploadShort({
        videoPath: processedVideoPath,
        thumbnailPath: thumbnail?.thumbnailPath,
        metadata,
        scheduleAt: record.scheduledAt,
        notifySubscribers: config.youtubePrivacyStatus === 'public',
        language: metadata.language,
      });

      if (processedVideoPath !== descriptor.filepath) {
        await fs.unlink(processedVideoPath).catch(() => {});
      }

      const uploadedMetadata: Record<string, unknown> = { ...metadata };
      await markVideoAsUploaded(record.filename, upload.videoId, uploadedMetadata);
      await sendUploadNotification({
        filename: record.filename,
        youtubeVideoId: upload.videoId,
        title: metadata.title,
        scheduledFor: upload.scheduledPublishTime,
        analytics: record.analytics,
      });

      result.uploaded += 1;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
      await recordVideoError(record.filename, errorMessage);
      result.failed += 1;
      result.errors.push(`${record.filename}: ${errorMessage}`);
      logger.error('Failed to upload video', { filename: record.filename, error: errorMessage });
    }
  }

  const pending = await listPendingUploads();
  await refreshAnalyticsForVideos(await listVideos(100));

  logger.info('Agent run complete', {
    scheduled: result.scheduled,
    uploaded: result.uploaded,
    failures: result.failed,
    pending: pending.length,
  });

  return result;
}
