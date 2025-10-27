import 'server-only';

import nodemailer from 'nodemailer';
import { getConfig } from './config';
import { logger } from './logger';

export interface UploadSummary {
  filename: string;
  youtubeVideoId: string;
  title: string;
  scheduledFor?: string;
  publishedAt?: string;
  analytics?: Record<string, unknown> | null;
}

async function sendEmail(summary: UploadSummary) {
  const config = getConfig();
  if (!config.notificationEmail) {
    logger.warn('Notification email is not configured');
    return;
  }

  if (!config.notificationSmtpHost || !config.notificationSmtpUser || !config.notificationSmtpPassword) {
    logger.warn('SMTP configuration is incomplete, skipping email notification');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.notificationSmtpHost,
    port: config.notificationSmtpPort ?? 587,
    secure: false,
    auth: {
      user: config.notificationSmtpUser,
      pass: config.notificationSmtpPassword,
    },
  });

  const url = `https://youtube.com/shorts/${summary.youtubeVideoId}`;
  await transporter.sendMail({
    from: config.notificationSmtpUser,
    to: config.notificationEmail,
    subject: `YouTube Short uploaded: ${summary.title}`,
    text: `Uploaded ${summary.title}
Video ID: ${summary.youtubeVideoId}
Link: ${url}
Scheduled For: ${summary.scheduledFor ?? 'Published immediately'}
Published At: ${summary.publishedAt ?? 'Pending'}

Analytics: ${JSON.stringify(summary.analytics ?? {}, null, 2)}
    `,
  });
}

async function sendDiscord(summary: UploadSummary) {
  const { notificationDiscordWebhook } = getConfig();
  if (!notificationDiscordWebhook) return;

  await fetch(notificationDiscordWebhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: [
        `🎬 **New Short uploaded**`,
        `**Title:** ${summary.title}`,
        `**Video:** https://youtube.com/shorts/${summary.youtubeVideoId}`,
        summary.scheduledFor ? `**Scheduled for:** ${summary.scheduledFor}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    }),
  });
}

async function sendTelegram(summary: UploadSummary) {
  const { notificationTelegramBotToken, notificationTelegramChatId } = getConfig();
  if (!notificationTelegramBotToken || !notificationTelegramChatId) return;

  const url = `https://api.telegram.org/bot${notificationTelegramBotToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: notificationTelegramChatId,
      text: `🎬 New Short uploaded\nTitle: ${summary.title}\nhttps://youtube.com/shorts/${summary.youtubeVideoId}`,
    }),
  });
}

export async function sendUploadNotification(summary: UploadSummary) {
  const config = getConfig();
  const channel = config.notificationChannel;

  try {
    if (channel === 'email') {
      await sendEmail(summary);
    } else if (channel === 'discord') {
      await sendDiscord(summary);
    } else if (channel === 'telegram') {
      await sendTelegram(summary);
    }
  } catch (error) {
    logger.warn('Failed to send notification', { error });
  }
}

