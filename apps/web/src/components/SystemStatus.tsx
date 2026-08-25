/**
 * AES50 link/chain status (issue #17), rendered beside `ConnectionStatus`.
 *
 * Two independent warnings, both hidden when there is nothing to report:
 *
 * - A prominent link-error warning when the console reports an AES50 audio
 *   error on a bus the installation actually declares stageboxes on — the
 *   headline case this issue exists for: a dead AES50 snake otherwise looks
 *   identical to "nobody is talking into the mics" (sources still display,
 *   meters just read zero).
 * - A quieter chain-mismatch warning when the detected box chain disagrees
 *   with `installation.yaml`, with the specifics on hover via `title`
 *   (matching `DiagnosticsControl`'s existing hover-detail convention).
 *
 * An error on a bus nothing is declared on (this venue's AES50-B) never
 * warns — see `selectAes50LinkWarningBus`.
 */

import { formatAes50ChainDetail, formatAes50ChainWarning, formatAes50LinkWarning } from "../format/aes50";
import {
  selectAes50ChainDiscrepancies,
  selectAes50ChainWarning,
  selectAes50LinkWarningBus,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function SystemStatus() {
  const linkWarningBus = useAppStore(selectAes50LinkWarningBus);
  const chainWarning = useAppStore(selectAes50ChainWarning);
  const chainDiscrepancies = useAppStore(selectAes50ChainDiscrepancies);

  if (linkWarningBus === null && !chainWarning) return null;

  return (
    <div className="system-status">
      {linkWarningBus !== null && (
        <span className="system-status__link-error" role="alert">
          {formatAes50LinkWarning(linkWarningBus)}
        </span>
      )}
      {chainWarning && (
        <span
          className="system-status__chain-warning"
          title={chainDiscrepancies.map(formatAes50ChainDetail).join("\n")}
        >
          {formatAes50ChainWarning()}
        </span>
      )}
    </div>
  );
}
