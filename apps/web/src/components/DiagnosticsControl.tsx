/**
 * Header diagnostics (architecture.md §3 "Routing diff", §7): an unobtrusive
 * discrepancy count next to `ConnectionStatus`, and the one "Save as correct"
 * action that blesses the current live state as the new baseline.
 *
 * With no baseline the count never renders and the button reads plainly —
 * the UI is otherwise unchanged from MVP (plan step 14, item 3). `name-mismatch`
 * is informational only (tooltip-only, architecture.md §3) and never counted
 * here, matching the strips it never badges.
 *
 * The save itself is gated behind a hand-rolled confirmation dialog (#15) —
 * blessing a baseline is a meaningful, hard-to-undo act, so both the first
 * save and a replacement get a beat and explicit copy rather than a second,
 * easy-to-miss click. `window.confirm` is deliberately not used: it can't be
 * styled to match the rest of the app and is suppressed in some embedded
 * contexts.
 */

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { MixerGateway } from "../gateway/mixerGateway";
import {
  selectBaseline,
  selectBaselineSaveError,
  selectConnection,
  selectDiscrepancies,
  selectSetBaselineSaveError,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import type { SaveBaselineDialogState } from "./saveBaselineDialog";
import {
  cancelSaveBaselineDialog,
  closedSaveBaselineDialog,
  confirmSaveBaselineDialog,
  openSaveBaselineDialog,
} from "./saveBaselineDialog";

/** Long enough to read, short enough not to linger as stale chrome. */
const ERROR_AUTOCLEAR_MS = 6000;

export function DiagnosticsControl({ gateway }: { gateway: MixerGateway }) {
  const baseline = useAppStore(selectBaseline);
  const discrepancies = useAppStore(selectDiscrepancies);
  const connection = useAppStore(selectConnection);
  const saveError = useAppStore(selectBaselineSaveError);
  const setSaveError = useAppStore(selectSetBaselineSaveError);
  const [dialog, setDialog] = useState<SaveBaselineDialogState>(closedSaveBaselineDialog);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // A brief inline error, not a permanent fixture — clears itself.
  useEffect(() => {
    if (saveError === null) return;
    const timer = setTimeout(() => setSaveError(null), ERROR_AUTOCLEAR_MS);
    return () => clearTimeout(timer);
  }, [saveError, setSaveError]);

  // The disabled state below already covers a drop mid-confirm, but reset
  // the dialog explicitly so it never lingers open through a reconnect.
  useEffect(() => {
    if (connection !== "connected") setDialog(closedSaveBaselineDialog);
  }, [connection]);

  // Focus moves to the confirm button on open, and back to the trigger on
  // close — a normal modal focus contract, hand-rolled since there's no
  // dialog library in the stack.
  useEffect(() => {
    if (dialog.open) {
      confirmRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [dialog.open]);

  function handleConfirm(): void {
    setDialog(confirmSaveBaselineDialog(() => gateway.saveBaseline()));
  }

  function handleCancel(): void {
    setDialog(cancelSaveBaselineDialog());
  }

  const issueCount = discrepancies.filter(
    (discrepancy) => discrepancy.kind !== "name-mismatch",
  ).length;

  return (
    <div className="diagnostics">
      {baseline !== null && issueCount > 0 && (
        <span className="diagnostics__count">
          {issueCount} routing issue{issueCount === 1 ? "" : "s"}
        </span>
      )}
      {saveError !== null && <span className="diagnostics__error">{saveError}</span>}
      <button
        ref={triggerRef}
        type="button"
        className="diagnostics__save"
        disabled={connection !== "connected"}
        onClick={() => setDialog(openSaveBaselineDialog(connection))}
      >
        Save as correct
      </button>
      {dialog.open && (
        <SaveBaselineDialog
          replacing={baseline !== null}
          confirmRef={confirmRef}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

function SaveBaselineDialog({
  replacing,
  confirmRef,
  onConfirm,
  onCancel,
}: {
  replacing: boolean;
  confirmRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-baseline-dialog-title"
        aria-describedby="save-baseline-dialog-body"
        // Stop the click from bubbling to the backdrop, which would cancel.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="save-baseline-dialog-title" className="dialog__title">
          {replacing ? "Replace the existing baseline?" : "Save this routing as correct?"}
        </h2>
        <p id="save-baseline-dialog-body" className="dialog__body">
          {replacing
            ? "The existing baseline will be discarded. The current routing becomes the new reference this app compares against."
            : "The current routing becomes the reference this app compares against, so future drift shows up as a routing issue."}
        </p>
        <div className="dialog__actions">
          <button type="button" className="dialog__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="dialog__confirm"
            onClick={onConfirm}
          >
            Save as correct
          </button>
        </div>
      </div>
    </div>
  );
}
