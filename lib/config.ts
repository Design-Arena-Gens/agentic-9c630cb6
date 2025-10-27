import 'server-only';

import path from 'path';
import { z } from 'zod';

const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const PRIVACY_STATUSES = ['private', 'public', 'unlisted'] as const;
const NOTIFICATION_CHANNELS = ['email', 'discord', 'telegram', 'none'] as const;

type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];
type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];
type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

const watermarkPositionEnv = (process.env.WATERMARK_POSITION ?? '').toLowerCase();
const defaultWatermarkPosition: WatermarkPosition = WATERMARK_POSITIONS.includes(
  watermarkPositionEnv as WatermarkPosition,
)
  ? (watermarkPositionEnv as WatermarkPosition)
  : 'bottom-right';

const privacyStatusEnv = (process.env.YOUTUBE_PRIVACY_STATUS ?? '').toLowerCase();
const defaultPrivacyStatus: PrivacyStatus = PRIVACY_STATUSES.includes(
  privacyStatusEnv as PrivacyStatus,
)
  ? (privacyStatusEnv as PrivacyStatus)
  : 'private';

const notificationChannelEnv = (process.env.NOTIFICATION_CHANNEL ?? '').toLowerCase();
const defaultNotificationChannel: NotificationChannel = NOTIFICATION_CHANNELS.includes(
  notificationChannelEnv as NotificationChannel,
)
  ? (notificationChannelEnv as NotificationChannel)
  : 'none';

const defaultTempDir = process.env.AGENT_TEMP_DIR
  ?? (process.env.VERCEL ? path.join('/tmp', 'agent-temp') : path.join(process.cwd(), '.agent-temp'));

const defaultDataStore = process.env.AGENT_DATA_STORE
  ?? (process.env.VERCEL ? path.join('/tmp', 'agent-data.json') : path.join(process.cwd(), '.agent-data.json'));

const configSchema = z.object({
  contentDir: z
    .string()
    .default(path.join(process.cwd(), 'content', 'videos')),
  metadataDir: z
    .string()
    .default(path.join(process.cwd(), 'content', 'metadata')),
  tempDir: z
    .string()
    .default(defaultTempDir),
  dataStore: z
    .string()
    .default(defaultDataStore),
  youtubeClientId: z.string().optional(),
  youtubeClientSecret: z.string().optional(),
  youtubeRefreshToken: z.string().optional(),
  youtubeChannelId: z.string().optional(),
  openAiApiKey: z.string().optional(),
  notificationEmail: z.string().email().optional(),
  notificationSmtpHost: z.string().optional(),
  notificationSmtpPort: z.coerce.number().optional(),
  notificationSmtpUser: z.string().optional(),
  notificationSmtpPassword: z.string().optional(),
  notificationDiscordWebhook: z.string().optional(),
  notificationTelegramBotToken: z.string().optional(),
  notificationTelegramChatId: z.string().optional(),
  timezone: z.string().default(process.env.TZ ?? 'UTC'),
  uploadWindows: z
    .string()
    .default(process.env.UPLOAD_WINDOWS ?? '09:00,12:00,18:00'),
  maxDailyUploads: z.coerce.number().default(Number(process.env.MAX_DAILY_UPLOADS ?? 3)),
  watermarkImage: z.string().optional(),
  watermarkPosition: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    .default(defaultWatermarkPosition),
  enableWatermark: z.coerce
    .boolean()
    .default(process.env.ENABLE_WATERMARK === 'true'),
  enableTranslations: z.coerce
    .boolean()
    .default(process.env.ENABLE_TRANSLATIONS === 'true'),
  translationLanguages: z
    .string()
    .default(process.env.TRANSLATION_LANGUAGES ?? 'es,fr,de'),
  analyticsLookbackDays: z
    .coerce
    .number()
    .default(Number(process.env.ANALYTICS_LOOKBACK_DAYS ?? 14)),
  analyticsSuggestImprovements: z.coerce
    .boolean()
    .default(process.env.ANALYTICS_SUGGEST_IMPROVEMENTS !== 'false'),
  youtubeCategoryId: z.string().default(process.env.YOUTUBE_CATEGORY_ID ?? '22'),
  youtubePrivacyStatus: z
    .enum(['private', 'public', 'unlisted'])
    .default(defaultPrivacyStatus),
  notificationChannel: z
    .enum(['email', 'discord', 'telegram', 'none'])
    .default(defaultNotificationChannel),
  youtubePlaylistId: z.string().optional(),
});

export type AgentConfig = z.infer<typeof configSchema>;

let cachedConfig: AgentConfig | null = null;

export function getConfig(): AgentConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = configSchema.safeParse({
    contentDir: process.env.CONTENT_DIR,
    metadataDir: process.env.METADATA_DIR,
    youtubeClientId: process.env.YOUTUBE_CLIENT_ID,
    youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID,
    openAiApiKey: process.env.OPENAI_API_KEY,
    notificationEmail: process.env.NOTIFICATION_EMAIL,
    notificationSmtpHost: process.env.NOTIFICATION_SMTP_HOST,
    notificationSmtpPort: process.env.NOTIFICATION_SMTP_PORT,
    notificationSmtpUser: process.env.NOTIFICATION_SMTP_USER,
    notificationSmtpPassword: process.env.NOTIFICATION_SMTP_PASSWORD,
    notificationDiscordWebhook: process.env.NOTIFICATION_DISCORD_WEBHOOK,
    notificationTelegramBotToken: process.env.NOTIFICATION_TELEGRAM_BOT_TOKEN,
    notificationTelegramChatId: process.env.NOTIFICATION_TELEGRAM_CHAT_ID,
    timezone: process.env.TIMEZONE ?? process.env.TZ,
    uploadWindows: process.env.UPLOAD_WINDOWS,
    maxDailyUploads: process.env.MAX_DAILY_UPLOADS,
    watermarkImage: process.env.WATERMARK_IMAGE,
    enableWatermark: process.env.ENABLE_WATERMARK,
    watermarkPosition: process.env.WATERMARK_POSITION,
    enableTranslations: process.env.ENABLE_TRANSLATIONS,
    translationLanguages: process.env.TRANSLATION_LANGUAGES,
    analyticsLookbackDays: process.env.ANALYTICS_LOOKBACK_DAYS,
    analyticsSuggestImprovements: process.env.ANALYTICS_SUGGEST_IMPROVEMENTS,
    youtubeCategoryId: process.env.YOUTUBE_CATEGORY_ID,
    youtubePrivacyStatus: process.env.YOUTUBE_PRIVACY_STATUS,
    notificationChannel: process.env.NOTIFICATION_CHANNEL,
    youtubePlaylistId: process.env.YOUTUBE_PLAYLIST_ID,
    tempDir: process.env.AGENT_TEMP_DIR,
    dataStore: process.env.AGENT_DATA_STORE,
  });

  if (!parsed.success) {
    throw new Error(`Invalid agent configuration: ${parsed.error.message}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function getUploadWindowSlots(): string[] {
  const config = getConfig();
  return config.uploadWindows
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const SUPPORTED_TRANSLATION_LANGS = () =>
  getConfig()
    .translationLanguages.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
