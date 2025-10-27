import 'server-only';

import fs from 'fs/promises';
import path from 'path';
import { OpenAI } from 'openai';
import { getConfig, SUPPORTED_TRANSLATION_LANGS } from './config';
import { findMetadataFile, readMetadataFile, VideoFileDescriptor } from './fs-utils';
import { logger } from './logger';

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  language: string;
  scheduleHint?: string;
  thumbnailText?: string;
  translatedDescriptions?: Record<string, string>;
  generatedByAi?: boolean;
  sourceMetadataPath?: string | null;
}

const openAiClient = (() => {
  const { openAiApiKey } = getConfig();
  if (!openAiApiKey) return null;
  return new OpenAI({ apiKey: openAiApiKey });
})();

async function generateMetadataWithAI(
  video: VideoFileDescriptor,
  baseMetadata: Record<string, unknown> | null,
): Promise<Partial<VideoMetadata>> {
  if (!openAiClient) return {};

  const promptPieces: string[] = [];
  promptPieces.push(
    `You are an experienced YouTube Shorts strategist. Generate optimized metadata for a YouTube Short given the available information.`,
  );
  promptPieces.push(`Video filename: ${video.filename}`);
  if (video.durationSeconds) {
    promptPieces.push(`Video duration (seconds): ${video.durationSeconds}`);
  }
  if (baseMetadata) {
    promptPieces.push(`Existing metadata (JSON): ${JSON.stringify(baseMetadata)}`);
  }
  promptPieces.push(
    `Return a valid JSON object with the keys: title, description, tags (array), hashtags (array of hashtag strings like #example), language (ISO language code), scheduleHint (string), thumbnailText (string).`,
  );

  const response = await openAiClient.responses.create({
    model: 'gpt-4.1-mini',
    input: promptPieces.join('\n'),
  });

  const text = response.output_text?.[0];
  if (text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      logger.error('Failed to parse metadata JSON from OpenAI', { error });
    }
  }

  return {};
}

async function translateDescriptionWithAI(
  description: string,
  languages: string[],
): Promise<Record<string, string>> {
  if (!openAiClient) return {};
  const translations: Record<string, string> = {};
  for (const lang of languages) {
    const response = await openAiClient.responses.create({
      model: 'gpt-4.1-mini',
      input: `Translate the following YouTube Shorts description into ${lang}. Retain hashtags and calls to action.\n\n${description}`,
    });
    const text = response.output_text?.[0];
    if (text) {
      translations[lang] = text.trim();
    }
  }
  return translations;
}

function normalizeTags(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((v) => `${v}`.trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,#]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeHashtags(input: unknown): string[] {
  const tags = normalizeTags(input);
  return tags.map((tag) => {
    const clean = tag.replace(/^#/, '').replace(/\s+/g, '');
    return `#${clean}`;
  });
}

export async function buildVideoMetadata(video: VideoFileDescriptor): Promise<VideoMetadata> {
  const config = getConfig();

  const metadataPath = await findMetadataFile(video.filepath);
  let fileMetadata: Record<string, unknown> | null = null;
  if (metadataPath) {
    fileMetadata = await readMetadataFile(metadataPath);
    logger.info('Loaded metadata file', { video: video.filename, metadataPath });
  }

  const aiMetadata = await generateMetadataWithAI(video, fileMetadata);

  const title =
    (fileMetadata?.title as string | undefined) ??
    (aiMetadata.title as string | undefined) ??
    path.basename(video.filename, path.extname(video.filename));

  const description =
    (fileMetadata?.description as string | undefined) ??
    (aiMetadata.description as string | undefined) ??
    `Check out this new Short!`;

  const tags = normalizeTags(fileMetadata?.tags ?? aiMetadata.tags);
  const hashtags = normalizeHashtags(
    fileMetadata?.hashtags ?? fileMetadata?.tags ?? aiMetadata.hashtags ?? aiMetadata.tags,
  );

  const metadata: VideoMetadata = {
    title,
    description,
    tags,
    hashtags,
    language:
      (fileMetadata?.language as string | undefined) ??
      (aiMetadata.language as string | undefined) ??
      'en',
    scheduleHint:
      (fileMetadata?.scheduleHint as string | undefined) ??
      (aiMetadata.scheduleHint as string | undefined),
    thumbnailText:
      (fileMetadata?.thumbnailText as string | undefined) ??
      (aiMetadata.thumbnailText as string | undefined),
    generatedByAi: !fileMetadata,
    sourceMetadataPath: metadataPath,
  };

  if (config.enableTranslations) {
    const languages = SUPPORTED_TRANSLATION_LANGS();
    if (languages.length > 0) {
      metadata.translatedDescriptions = await translateDescriptionWithAI(
        metadata.description,
        languages,
      );
    }
  }

  return metadata;
}

export async function persistMetadataSnapshot(
  video: VideoFileDescriptor,
  metadata: VideoMetadata,
) {
  const { metadataDir } = getConfig();
  await fs.mkdir(metadataDir, { recursive: true });
  const outputPath = path.join(
    metadataDir,
    `${path.basename(video.filename, path.extname(video.filename))}.metadata.json`,
  );

  await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2), 'utf-8');
}
