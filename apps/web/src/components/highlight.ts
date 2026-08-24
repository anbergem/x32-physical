/**
 * Highlight state → CSS modifier class.
 *
 * Highlighting is built as independent layers, one class per layer, each
 * painting *different* CSS properties: hover (`hoverModifier`) works on
 * border and text colour; selection (`selectionModifier`, plan step 8) works
 * on fill/background; diagnostics (`diagnosticModifier`, plan step 14) paints
 * a small corner badge, deliberately not another fill wash, so an endpoint
 * that is hovered, selected, *and* flagged by the baseline diff shows all
 * three at once with nothing overwriting anything else.
 */

import type {
  DiagnosticStatus,
  HoverStatus,
  SelectionStatus,
} from "../state/selectors";

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

/**
 * @param base the block class of the element, `port` or `strip`.
 * @returns the modifier to add, or `null` for an unflagged element. In
 *   practice `source-mismatch`/`shared-source` only ever reach a `strip` and
 *   `expected-source` only ever reaches a `port` (`selectDiagnosticStatus`
 *   never mixes them), but the function stays generic like the two above.
 */
export function diagnosticModifier(
  base: string,
  status: DiagnosticStatus,
): string | null {
  switch (status) {
    case "source-mismatch":
      return `${base}--source-mismatch`;
    case "shared-source":
      return `${base}--shared-source`;
    case "expected-source":
      return `${base}--expected-source`;
    case "none":
      return null;
  }
}
