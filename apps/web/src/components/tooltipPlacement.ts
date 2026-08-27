/**
 * Where an endpoint's tooltip goes.
 *
 * The tooltip is anchored inside its own socket or strip and centred above
 * it, which is right almost everywhere and wrong in exactly two places: a
 * socket near the left or right edge of the screen pushes the tooltip off
 * it, and a socket in the topmost row pushes it up under the sticky header.
 * Both got worse on a tablet — less screen, and no way to nudge the pointer
 * somewhere friendlier.
 *
 * So the placement is computed from the anchor's own box rather than
 * measured back off the tooltip: given where the socket is and how big the
 * tooltip is, this returns the horizontal correction to apply to the
 * centred position and whether to flip below. Deterministic — the result
 * never depends on a previously applied correction, so there is no
 * measure/apply feedback loop, and it is pure, so it is tested without a DOM.
 *
 * Above is preferred over below on purpose, touch included: the tooltip
 * appears when the finger lifts, and the space above a socket is the space a
 * hand reaching from below is *not* covering.
 */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TooltipPlacementInput {
  /** Viewport-relative box of the socket/strip the tooltip belongs to. */
  anchor: Box;
  /** The tooltip's own rendered size. */
  tooltip: { width: number; height: number };
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /**
   * The lowest y a tooltip may occupy — the bottom of the sticky header,
   * effectively. Above it the tooltip would be hidden behind the header.
   */
  safeTop: number;
  /** Gap between anchor and tooltip, matching the CSS. */
  gap: number;
  /** Minimum distance to keep from the left and right viewport edges. */
  margin: number;
}

export interface TooltipPlacement {
  /**
   * Pixels to add to the CSS-centred position. `0` whenever the centred
   * tooltip already fits, which is the overwhelmingly common case — a
   * desktop tooltip in the middle of the schematic is untouched.
   */
  shiftX: number;
  /** Put the tooltip below the anchor instead of above it. */
  below: boolean;
}

export function placeTooltip({
  anchor,
  tooltip,
  viewportWidth,
  safeTop,
  gap,
  margin,
}: TooltipPlacementInput): TooltipPlacement {
  const centre = (anchor.left + anchor.right) / 2;
  const naturalLeft = centre - tooltip.width / 2;

  // A tooltip wider than the space between the margins can't satisfy both
  // edges; pin it to the left one so its start — the title — stays readable.
  const maxLeft = Math.max(margin, viewportWidth - margin - tooltip.width);
  const clampedLeft = Math.min(Math.max(naturalLeft, margin), maxLeft);

  return {
    shiftX: Math.round(clampedLeft - naturalLeft),
    below: anchor.top - gap - tooltip.height < safeTop,
  };
}
