import 'server-only';

import { DateTime } from 'luxon';
import { getConfig, getUploadWindowSlots } from './config';
import { VideoRecord } from './db';

export function computeNextSchedule(videos: VideoRecord[], now = new Date()): Date | null {
  const config = getConfig();
  const timeZone = config.timezone;
  const slots = getUploadWindowSlots().map((slot) => slot.trim()).filter(Boolean);
  if (slots.length === 0) return null;

  const nowInZone = DateTime.fromJSDate(now).setZone(timeZone);
  const futureVideos = videos.filter(
    (video) => video.scheduledAt && DateTime.fromJSDate(video.scheduledAt).setZone(timeZone) > nowInZone,
  );

  const dayCounts = new Map<string, number>();
  for (const video of futureVideos) {
    if (!video.scheduledAt) continue;
    const key = DateTime.fromJSDate(video.scheduledAt).setZone(timeZone).toFormat('yyyy-LL-dd');
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const baseDay = nowInZone.plus({ days: dayOffset }).startOf('day');
    const dayKey = baseDay.toFormat('yyyy-LL-dd');
    const uploadsForDay = dayCounts.get(dayKey) ?? 0;
    if (uploadsForDay >= config.maxDailyUploads) continue;

    for (const slot of slots) {
      const [hour, minute] = slot.split(':').map((part) => Number(part));
      const candidate = baseDay.set({ hour, minute, second: 0, millisecond: 0 });
      if (dayOffset === 0 && candidate <= nowInZone.plus({ minutes: 1 })) {
        continue;
      }
      const slotTaken = futureVideos.some((video) => {
        if (!video.scheduledAt) return false;
        const scheduled = DateTime.fromJSDate(video.scheduledAt).setZone(timeZone);
        return Math.abs(scheduled.diff(candidate, 'minutes').minutes ?? 0) < 1;
      });
      if (slotTaken) continue;
      return candidate.toJSDate();
    }
  }

  return null;
}

