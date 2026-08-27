/**
 * How a pointer event on an endpoint (socket, strip, output slot,
 * destination) becomes a hover or a pin.
 *
 * The schematic's primary interaction is hover: put the pointer on a socket,
 * see its whole route light up and its tooltip answer "where does this go".
 * A touch device has no hover, so on a tablet that interaction — the point
 * of the tool — would simply not exist. Tapping pins instead: the same
 * highlight, the same tooltip, held until the tech taps somewhere else. It
 * is the interaction the product spec anticipated ("click may optionally
 * pin/show route details"), and it composes with the mouse rather than
 * replacing it.
 *
 * The rules, one per pointer type:
 *
 * - **mouse** — hovering works exactly as it always has; a click additionally
 *   pins, so the route survives moving the mouse away to read the far end of
 *   the schematic. Clicking the pinned endpoint again unpins it, and since
 *   the mouse is still sitting on it, it stays hovered.
 * - **touch / pen** — the synthetic enter/leave events browsers emit around a
 *   tap are ignored outright (they are the reason a naive `onMouseEnter`
 *   handler leaves a tablet stuck showing the last thing touched), and the
 *   tap itself pins. Tapping the pinned endpoint again clears it completely:
 *   there is no finger left on it to keep it lit.
 *
 * Kept as a pure decision function so both halves are testable without a DOM
 * stack; the components map the result onto the two store actions.
 */

export type EndpointPointerPhase = "enter" | "leave" | "up";

export type EndpointPointerAction =
  /** Make this endpoint the hovered one (dropping any pin). */
  | "hover"
  /** The pointer left: clear the hover, unless it is pinned. */
  | "clear"
  /** Toggle the pin; unpinning leaves the endpoint hovered (mouse). */
  | "toggle-pin-keep-hover"
  /** Toggle the pin; unpinning leaves nothing highlighted (touch). */
  | "toggle-pin-clear"
  /** Not a meaningful signal — most often a tap's synthetic mouse event. */
  | "ignore";

/**
 * @param phase which pointer event fired.
 * @param pointerType the event's `pointerType`. Anything that is not
 *   `"mouse"` is treated as a device without hover: an unknown or empty
 *   value (some browsers report `""` for synthesised events) therefore gets
 *   the touch treatment, which degrades to "tap to pin" rather than to "no
 *   interaction at all".
 */
export function resolveEndpointPointerAction(
  phase: EndpointPointerPhase,
  pointerType: string,
): EndpointPointerAction {
  const hasHover = pointerType === "mouse";
  switch (phase) {
    case "enter":
      return hasHover ? "hover" : "ignore";
    case "leave":
      return hasHover ? "clear" : "ignore";
    case "up":
      return hasHover ? "toggle-pin-keep-hover" : "toggle-pin-clear";
  }
}
