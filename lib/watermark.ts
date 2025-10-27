import 'server-only';

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { getConfig } from './config';
import { VideoFileDescriptor } from './fs-utils';
import { logger } from './logger';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function overlayPosition(position: string) {
  switch (position) {
    case 'top-left':
      return '10:10';
    case 'top-right':
      return 'main_w-overlay_w-10:10';
    case 'bottom-left':
      return '10:main_h-overlay_h-10';
    default:
      return 'main_w-overlay_w-10:main_h-overlay_h-10';
  }
}

export async function applyWatermark(video: VideoFileDescriptor): Promise<string> {
  const config = getConfig();
  if (!config.enableWatermark || !config.watermarkImage) {
    return video.filepath;
  }

  const watermarkPath = path.isAbsolute(config.watermarkImage)
    ? config.watermarkImage
    : path.join(process.cwd(), config.watermarkImage);

  try {
    await fs.access(watermarkPath);
  } catch {
    logger.warn('Watermark image not found, skipping', { watermarkPath });
    return video.filepath;
  }

  const { tempDir } = config;
  await fs.mkdir(tempDir, { recursive: true });

  const outputPath = path.join(
    tempDir,
    `${path.basename(video.filename, path.extname(video.filename))}-watermarked${path.extname(
      video.filename,
    )}`,
  );

  await new Promise<void>((resolve, reject) => {
    ffmpeg(video.filepath)
      .addInput(watermarkPath)
      .complexFilter([
        {
          filter: 'overlay',
          options: overlayPosition(config.watermarkPosition),
        },
      ])
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .save(outputPath);
  });

  logger.info('Watermark applied', { video: video.filename, outputPath });

  return outputPath;
}

