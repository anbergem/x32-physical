/**
 * Linear meter level → visual bar height (docs/x32-protocol.md §Meters).
 *
 * `/meters/1` floats are linear amplitude in 0.0–1.0 (1.0 = full scale),
 * verified against the real console (fw 4.06, 2026-08-24). Levels read
 * logarithmically to the eye and ear, so this maps to dB with a -60 dBFS
 * floor — matching how console meters behave — rather than a tuned power
 * curve. A live mic in a quiet room (~0.001-0.004 linear) still shows a
 * small but visible bar, distinguishing "quiet signal" from "no signal".
 */
export function meterBarHeightPercent(level: number): number {
  if (level <= 0) return 0;
  const clampedLevel = Math.min(1, level);
  const dB = 20 * Math.log10(clampedLevel);
  const clampedDb = Math.max(-60, Math.min(0, dB));
  const fraction = (clampedDb + 60) / 60;
  return fraction * 100;
}

/** Above this bar height, the strip meter switches to the "hot" colour. */
export const METER_HOT_THRESHOLD_PERCENT = 85;

export function isMeterHot(heightPercent: number): boolean {
  return heightPercent >= METER_HOT_THRESHOLD_PERCENT;
}
