import 'server-only';

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfig } from './config';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);
const METADATA_EXTENSIONS = ['.json', '.txt', '.md'];

export interface VideoFileDescriptor {
  filepath: string;
  filename: string;
  hash: string | null;
  size: number;
  durationSeconds: number | null;
}

async function computeFileHash(filepath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const file = await fs.open(filepath, 'r');
  try {
    const stream = file.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

async function probeDuration(): Promise<number | null> {
  // Implementing a lightweight probe using fluent-ffmpeg would add native deps.
  // Instead, we defer detailed duration inspection until ffmpeg is available.
  return null;
}

export async function listVideoFiles(): Promise<VideoFileDescriptor[]> {
  const { contentDir } = getConfig();
  const entries = await fs.readdir(contentDir).catch(async (error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        await fs.mkdir(contentDir, { recursive: true });
        return [];
      }
    }
    throw error;
  });

  const videos: VideoFileDescriptor[] = [];

  for (const entry of entries) {
    const filepath = path.join(contentDir, entry);
    const stat = await fs.stat(filepath);
    if (stat.isDirectory()) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    const hash = await computeFileHash(filepath);
    const durationSeconds = await probeDuration();

    videos.push({
      filepath,
      filename: entry,
      hash,
      size: stat.size,
      durationSeconds,
    });
  }

  return videos;
}

export async function findMetadataFile(videoPath: string): Promise<string | null> {
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const dir = path.dirname(videoPath);

  for (const ext of METADATA_EXTENSIONS) {
    const candidate = path.join(dir, `${baseName}${ext}`);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOENT') continue;
      }
      throw error;
    }
  }

  return null;
}

export async function readMetadataFile(filepath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    if (filepath.endsWith('.json')) {
      return JSON.parse(content);
    }
    if (filepath.endsWith('.txt') || filepath.endsWith('.md')) {
      const lines = content.split('\n').map((line) => line.trim());
      const metadata: Record<string, unknown> = {};
      for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const [key, ...rest] = line.split(':');
        if (!key || rest.length === 0) continue;
        metadata[key.trim().toLowerCase()] = rest.join(':').trim();
      }
      return metadata;
    }
    return null;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') {
        return null;
      }
    }
    throw error;
  }
}
