/**
 * Highlight state → CSS modifier class.
 *
 * Highlighting is built as independent layers, one class per layer, each
 * painting *different* CSS properties (hover works on border and text colour;
 * plan step 8's selection works on fill). An endpoint that is on the selected
 * route and on the hovered route at once therefore shows both at once — no
 * combined "selected-and-hovered" states to enumerate.
 */

import type { HoverStatus } from "../state/selectors";

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
