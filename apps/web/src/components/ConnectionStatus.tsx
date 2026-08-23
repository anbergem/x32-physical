/**
 * Unobtrusive connection indicator — a dot, a word, and (in mock mode) an
 * unmissable "MOCK DATA" tag.
 *
 * The tag matters more than the dot: everything on screen looks equally real,
 * and nobody should ever debug a patch against simulated data by accident.
 */

import type { MixerConnectionState } from "@x32/mixer-contracts";

import { selectConnection } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

const LABELS: Record<MixerConnectionState, string> = {
  connected: "connected",
  connecting: "connecting",
  disconnected: "disconnected",
};

export function ConnectionStatus({ mockData }: { mockData: boolean }) {
  const connection = useAppStore(selectConnection);

  return (
    <div className="status">
      {mockData && <span className="status__mock">MOCK DATA</span>}
      <span
        className={`status__dot status__dot--${connection}`}
        aria-hidden="true"
      />
      <span className="status__text">{LABELS[connection]}</span>
    </div>
  );
}
