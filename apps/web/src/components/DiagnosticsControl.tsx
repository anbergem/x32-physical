/**
 * Header diagnostics (architecture.md §3 "Routing diff", §7): an unobtrusive
 * discrepancy count next to `ConnectionStatus`, and the one "Save as correct"
 * action that blesses the current live state as the new baseline.
 *
 * With no baseline the count never renders and the button reads plainly —
 * the UI is otherwise unchanged from MVP (plan step 14, item 3). `name-mismatch`
 * is informational only (tooltip-only, architecture.md §3) and never counted
 * here, matching the strips it never badges.
 */

import { useEffect, useState } from "react";

import type { MixerGateway } from "../gateway/mixerGateway";
import {
  selectBaseline,
  selectBaselineSaveError,
  selectConnection,
  selectDiscrepancies,
  selectSetBaselineSaveError,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

/** Long enough to read, short enough not to linger as stale chrome. */
const ERROR_AUTOCLEAR_MS = 6000;

export function DiagnosticsControl({ gateway }: { gateway: MixerGateway }) {
  const baseline = useAppStore(selectBaseline);
  const discrepancies = useAppStore(selectDiscrepancies);
  const connection = useAppStore(selectConnection);
  const saveError = useAppStore(selectBaselineSaveError);
  const setSaveError = useAppStore(selectSetBaselineSaveError);
  const [confirming, setConfirming] = useState(false);

  // A brief inline error, not a permanent fixture — clears itself.
  useEffect(() => {
    if (saveError === null) return;
    const timer = setTimeout(() => setSaveError(null), ERROR_AUTOCLEAR_MS);
    return () => clearTimeout(timer);
  }, [saveError, setSaveError]);

  // The disabled state below already covers a drop mid-confirm, but reset the
  // two-step state explicitly so a stale "Replace baseline?" never lingers
  // through a reconnect.
  useEffect(() => {
    if (connection !== "connected") setConfirming(false);
  }, [connection]);

  const issueCount = discrepancies.filter(
    (discrepancy) => discrepancy.kind !== "name-mismatch",
  ).length;

  function handleClick(): void {
    if (baseline !== null && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    gateway.saveBaseline();
  }

  return (
    <div className="diagnostics">
      {baseline !== null && issueCount > 0 && (
        <span className="diagnostics__count">
          {issueCount} routing issue{issueCount === 1 ? "" : "s"}
        </span>
      )}
      {saveError !== null && <span className="diagnostics__error">{saveError}</span>}
      <button
        type="button"
        className="diagnostics__save"
        disabled={connection !== "connected"}
        onClick={handleClick}
      >
        {confirming ? "Replace baseline?" : "Save as correct"}
      </button>
    </div>
  );
}
