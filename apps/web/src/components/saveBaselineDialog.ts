/**
 * Pure open/confirm/cancel logic for the "Save as correct" confirmation
 * dialog (`DiagnosticsControl`), factored out so it's testable without a DOM
 * stack (architecture.md's dialog is local component state, never store
 * state — this module has no store dependency either).
 */

import type { MixerConnectionState } from "@x32/mixer-contracts";

export interface SaveBaselineDialogState {
  readonly open: boolean;
}

export const closedSaveBaselineDialog: SaveBaselineDialogState = { open: false };

/**
 * The trigger button click. Refuses to open while disconnected — the button
 * is already `disabled` in that state, but the handler enforces it too
 * rather than trusting the DOM alone.
 */
export function openSaveBaselineDialog(
  connection: MixerConnectionState,
): SaveBaselineDialogState {
  if (connection !== "connected") return closedSaveBaselineDialog;
  return { open: true };
}

/** Confirming in the dialog: commits the save exactly once, then closes. */
export function confirmSaveBaselineDialog(
  saveBaseline: () => void,
): SaveBaselineDialogState {
  saveBaseline();
  return closedSaveBaselineDialog;
}

/** Cancel, Escape, or a backdrop click: closes without saving. */
export function cancelSaveBaselineDialog(): SaveBaselineDialogState {
  return closedSaveBaselineDialog;
}
