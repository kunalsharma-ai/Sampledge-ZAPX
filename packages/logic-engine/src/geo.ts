/**
 * Geofences for face-to-face interviews (blueprint phase 3). Plain great-circle distance: precise to
 * well under a metre at survey scales, and the same on the device and the server.
 */
import type { Geofence } from '@zapx/survey-schema';

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceCheck {
  /** No areas are set: every place is allowed. */
  open: boolean;
  inside: boolean;
  /** The nearest area and how far the point is from its edge (0 when inside). */
  nearest: { label: string; distanceM: number } | null;
}

/**
 * Is the point inside one of the areas? The location's accuracy counts in the interviewer's favour:
 * a point whose accuracy circle touches an area is inside, so a weak GPS fix is not called fraud.
 * Accuracy is capped at 1 km so a useless fix cannot cover a whole city.
 */
export function checkGeofence(
  point: { lat: number; lon: number; accuracy?: number | null } | null | undefined,
  fences: readonly Geofence[],
): GeofenceCheck {
  if (!fences.length) return { open: true, inside: true, nearest: null };
  if (!point) return { open: false, inside: false, nearest: null };
  const slack = Math.min(1000, Math.max(0, point.accuracy ?? 0));
  let nearest: { label: string; distanceM: number } | null = null;
  for (const f of fences) {
    const edge = Math.max(0, distanceM(point, f) - f.radiusM - slack);
    if (!nearest || edge < nearest.distanceM) nearest = { label: f.label, distanceM: Math.round(edge) };
  }
  return { open: false, inside: nearest!.distanceM === 0, nearest };
}
