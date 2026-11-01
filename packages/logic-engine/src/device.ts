/**
 * Device classification for device rules and reporting. Uses the user agent plus what the browser
 * reports about itself (touch support, screen width), because iPads identify as Macs.
 * Nothing here fingerprints the respondent; only the resulting type is stored.
 */
import type { DeviceType } from '@zapx/survey-schema';

export interface DeviceHints {
  /** navigator.maxTouchPoints > 0 */
  touch?: boolean;
  /** Smaller of screen width and height, in CSS pixels. */
  screenShortSide?: number;
}

export function classifyDevice(userAgent: string | undefined, hints: DeviceHints = {}): DeviceType {
  const ua = userAgent ?? '';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  if (/iPhone|iPod|Windows Phone|Mobi|BlackBerry|Opera Mini/i.test(ua)) return 'mobile';
  // iPadOS 13+ reports a desktop Safari user agent; touch support gives it away.
  if (/Macintosh/i.test(ua) && hints.touch) return 'tablet';
  if (hints.touch && hints.screenShortSide !== undefined) {
    if (hints.screenShortSide < 600) return 'mobile';
    if (hints.screenShortSide < 1000 && !/Windows NT|X11|CrOS/i.test(ua)) return 'tablet';
  }
  return 'desktop';
}
