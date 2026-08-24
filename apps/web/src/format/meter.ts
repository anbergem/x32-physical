/**
 * Linear meter level → visual bar height (plan step 15).
 *
 * A plain linear mapping makes quiet material nearly invisible and loud
 * material indistinguishable near the top — levels read logarithmically to
 * the eye, same as to the ear. `Math.sqrt` is a cheap, monotonic perceptual
 * compromise (steeper at the low end, flatter near the top) without pulling
 * in a full dB conversion this debugging-tool strip doesn't need.
 */
export function meterBarHeightPercent(level: number): number {
  const clamped = Math.min(1, Math.max(0, level));
  return Math.sqrt(clamped) * 100;
}

/** Above this bar height, the strip meter switches to the "hot" colour. */
export const METER_HOT_THRESHOLD_PERCENT = 85;

export function isMeterHot(heightPercent: number): boolean {
  return heightPercent >= METER_HOT_THRESHOLD_PERCENT;
}
