import 'server-only';

import { OpenAI } from 'openai';
import { getConfig } from './config';
import { storeAnalytics, VideoRecord } from './db';
import { fetchVideoAnalytics } from './youtube';
import { logger } from './logger';

const client = (() => {
  const { openAiApiKey } = getConfig();
  if (!openAiApiKey) return null;
  return new OpenAI({ apiKey: openAiApiKey });
})();

async function generateSuggestions(analytics: Record<string, unknown>): Promise<string | null> {
  const config = getConfig();
  if (!config.analyticsSuggestImprovements || !client) return null;
  try {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: `Provide concise, actionable suggestions (max 3 bullet points) to improve the performance of this YouTube Short based on its metrics.\nMetrics JSON: ${JSON.stringify(
        analytics,
      )}`,
    });
    const text = response.output_text?.[0];
    if (!text) return null;
    return text.trim();
  } catch (error) {
    logger.warn('Failed to generate improvement suggestions', { error });
    return null;
  }
}

export async function refreshAnalyticsForVideos(videos: VideoRecord[]) {
  const eligible = videos.filter((video) => video.youtubeVideoId);
  for (const video of eligible) {
    try {
      const analytics = await fetchVideoAnalytics(video.youtubeVideoId!);
      if (!analytics) continue;
      const data: Record<string, unknown> = { ...analytics };
      const suggestions = await generateSuggestions({
        ...analytics,
        title: video.metadata?.title,
      });
      if (suggestions) {
        data.suggestions = suggestions;
      }
      await storeAnalytics(video.id, data);
    } catch (error) {
      logger.warn('Failed to refresh analytics', { video: video.youtubeVideoId, error });
    }
  }
}
