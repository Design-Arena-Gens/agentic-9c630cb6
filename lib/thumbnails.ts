import 'server-only';

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { getConfig } from './config';
import { VideoMetadata } from './metadata';
import { VideoFileDescriptor } from './fs-utils';
import { logger } from './logger';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface ThumbnailResult {
  thumbnailPath: string;
}

export async function generateThumbnail(
  video: VideoFileDescriptor,
  metadata: VideoMetadata,
): Promise<ThumbnailResult | null> {
  const { tempDir } = getConfig();
  await fs.mkdir(tempDir, { recursive: true });

  const outputPath = path.join(
    tempDir,
    `${path.basename(video.filename, path.extname(video.filename))}-thumb.jpg`,
  );

  await new Promise<void>((resolve, reject) => {
    ffmpeg(video.filepath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .frames(1)
      .setStartTime('00:00:02')
      .outputOptions([
        '-vf',
        `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280`,
        '-q:v',
        '2',
      ])
      .save(outputPath);
  });

  logger.info('Generated thumbnail', { video: video.filename, outputPath, title: metadata.title });

  return { thumbnailPath: outputPath };
}

