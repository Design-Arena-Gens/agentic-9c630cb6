import 'server-only';

import { OpenAI } from 'openai';
import { getConfig } from './config';
import { VideoMetadata } from './metadata';
import { logger } from './logger';

const client = (() => {
  const { openAiApiKey } = getConfig();
  if (!openAiApiKey) return null;
  return new OpenAI({ apiKey: openAiApiKey });
})();

export async function augmentMetadataWithTrending(metadata: VideoMetadata): Promise<VideoMetadata> {
  if (!client) return metadata;

  try {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: `Provide 10 trending YouTube Shorts keywords relevant to this video title and description. Return as a comma separated list.\nTitle: ${metadata.title}\nDescription: ${metadata.description}`,
    });
    const text = response.output_text?.[0];
    if (!text) return metadata;
    const keywords = text
      .split(/[,#\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const deduped = Array.from(new Set([...metadata.tags, ...keywords]));
    const dedupedHashtags = Array.from(
      new Set([...metadata.hashtags, ...keywords.map((k) => `#${k.replace(/\s+/g, '')}`)]),
    );

    return {
      ...metadata,
      tags: deduped.slice(0, 500),
      hashtags: dedupedHashtags.slice(0, 20),
    };
  } catch (error) {
    logger.warn('Failed to fetch trending keywords', { error });
    return metadata;
  }
}
