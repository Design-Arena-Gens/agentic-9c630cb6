import 'server-only';

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { google, youtube_v3 } from 'googleapis';
import { getConfig } from './config';
import { VideoMetadata } from './metadata';
import { logger } from './logger';

let youtubeClient: youtube_v3.Youtube | null = null;

function buildYoutubeClient(): youtube_v3.Youtube {
  const config = getConfig();

  if (!config.youtubeClientId || !config.youtubeClientSecret || !config.youtubeRefreshToken) {
    throw new Error('Missing YouTube OAuth credentials');
  }

  const oauth2Client = new google.auth.OAuth2(
    config.youtubeClientId,
    config.youtubeClientSecret,
  );
  oauth2Client.setCredentials({
    refresh_token: config.youtubeRefreshToken,
  });

  return google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });
}

function getYoutubeClient(): youtube_v3.Youtube {
  if (!youtubeClient) {
    youtubeClient = buildYoutubeClient();
  }
  return youtubeClient;
}

function buildDescription(metadata: VideoMetadata): string {
  const tagLine =
    metadata.hashtags.length > 0 ? `\n\n${metadata.hashtags.join(' ')}` : '';
  return `${metadata.description.trim()}${tagLine}`;
}

export interface UploadParams {
  videoPath: string;
  thumbnailPath?: string | null;
  metadata: VideoMetadata;
  scheduleAt?: Date | null;
  notifySubscribers?: boolean;
  language?: string;
}

export interface UploadResult {
  videoId: string;
  scheduledPublishTime?: string;
}

export async function uploadShort(params: UploadParams): Promise<UploadResult> {
  const config = getConfig();
  const youtube = getYoutubeClient();

  const requestBody: youtube_v3.Schema$Video = {
    snippet: {
      title: params.metadata.title.trim().slice(0, 100),
      description: buildDescription(params.metadata),
      tags: params.metadata.tags,
      categoryId: config.youtubeCategoryId,
      defaultLanguage: params.language ?? params.metadata.language,
    },
    status: {
      privacyStatus: config.youtubePrivacyStatus,
      selfDeclaredMadeForKids: false,
      publishAt: params.scheduleAt ? params.scheduleAt.toISOString() : undefined,
    },
  };

  logger.info('Uploading video to YouTube', {
    filename: params.videoPath,
    scheduleAt: params.scheduleAt,
  });

  const insertResponse = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody,
    media: {
      body: createReadStream(params.videoPath),
    },
    notifySubscribers: params.notifySubscribers ?? false,
  });

  const videoId = insertResponse.data.id;
  if (!videoId) {
    throw new Error('YouTube API did not return a video ID');
  }

  if (params.thumbnailPath) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: {
          body: createReadStream(params.thumbnailPath),
        },
      });
    } catch (error) {
      logger.warn('Failed to set thumbnail', { error });
    }
  }

  if (params.thumbnailPath) {
    await fs.unlink(params.thumbnailPath).catch(() => {});
  }

  return {
    videoId,
    scheduledPublishTime: params.scheduleAt?.toISOString(),
  };
}

export interface VideoAnalytics {
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  publishedAt?: string;
  title?: string;
}

export async function fetchVideoAnalytics(videoId: string): Promise<VideoAnalytics | null> {
  const youtube = getYoutubeClient();
  const response = await youtube.videos.list({
    part: ['statistics', 'snippet'],
    id: [videoId],
  });
  const [video] = response.data.items ?? [];
  if (!video) return null;
  return {
    viewCount: Number(video.statistics?.viewCount ?? 0),
    likeCount: Number(video.statistics?.likeCount ?? 0),
    favoriteCount: Number(video.statistics?.favoriteCount ?? 0),
    commentCount: Number(video.statistics?.commentCount ?? 0),
    publishedAt: video.snippet?.publishedAt ?? undefined,
    title: video.snippet?.title ?? undefined,
  };
}
