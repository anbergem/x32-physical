/**
 * Highlight state → CSS modifier class.
 *
 * Highlighting is built as independent layers, one class per layer, each
 * painting *different* CSS properties: hover (`hoverModifier`) works on
 * border and text colour; selection (`selectionModifier`, plan step 8) works
 * on fill/background. An endpoint that is on the selected route and on the
 * hovered route at once therefore shows both at once — no combined
 * "selected-and-hovered" states to enumerate.
 */

import type { HoverStatus, SelectionStatus } from "../state/selectors";

/**
 * @param base the block class of the element, `port` or `strip`.
 * @returns the modifier to add, or `null` for an unhighlighted element.
 */
export function hoverModifier(base: string, status: HoverStatus): string | null {
  switch (status) {
    case "hovered":
      return `${base}--hovered`;
    case "on-route":
      return `${base}--on-hovered-route`;
    case "none":
      return null;
  }
}

/**
 * @param base the block class of the element, `port` or `strip`.
 * @returns the modifier to add, or `null` for an unhighlighted element. In
 *   practice only a `strip` ever reaches `selected` — a port is never itself
 *   the endpoint the console selected, only ever on its route — but the
 *   function stays generic across both bases like `hoverModifier` above.
 */
export function selectionModifier(
  base: string,
  status: SelectionStatus,
): string | null {
  switch (status) {
    case "selected":
      return `${base}--selected`;
    case "on-selected-route":
      return `${base}--on-selected-route`;
    case "none":
      return null;
  }
}
