/**
 * The inspector for the device selected in edit mode (issue #27).
 *
 * One field for now — the label — because this step is the vertical slice that
 * proves the write pipe and the feel of editing, not the editor itself; groups,
 * socket annotations, cabling and destinations follow in step 3 and slot in
 * beside it.
 *
 * **Committed on blur or Enter, never per keystroke.** The draft lives in
 * component state and only leaves it when the operator is finished with the
 * field; writing on every keystroke would produce a storm of operations and
 * churn the `.bak` — the one copy of the last-known-good file — into
 * uselessness. Escape abandons the draft and restores what the installation
 * actually says.
 *
 * A rejection is a normal outcome and is shown here, inline, in the words the
 * bridge (or, in mock mode, the same pipeline running locally) used — never
 * swallowed, never retried behind the operator's back.
 */

import type { Device, DeviceId } from "@x32/domain";
import { useEffect, useRef, useState } from "react";

import type { GatewayMode, MixerGateway } from "../gateway/mixerGateway";
import { commitDeviceLabel } from "../installation/labelEdit";
import {
  selectDevice,
  selectEditingDevice,
  selectInstallationEditError,
  selectInstallationVersion,
  selectSetEditingDevice,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

const KIND_LABELS: Record<Device["kind"], string> = {
  stagebox: "Stagebox",
  "passive-panel": "Passive panel",
  console: "Console",
  destination: "Destination",
};

export function DeviceInspector({
  gateway,
  mode,
}: {
  gateway: MixerGateway;
  mode: GatewayMode;
}) {
  const editingDevice = useAppStore(selectEditingDevice);

  if (editingDevice === null) return null;

  // Keyed on the device id so selecting a different device remounts the
  // field with that device's label, instead of carrying a half-typed draft
  // across to a box it was never meant for.
  return (
    <DeviceInspectorPanel
      key={editingDevice}
      deviceId={editingDevice}
      gateway={gateway}
      mode={mode}
    />
  );
}

function DeviceInspectorPanel({
  deviceId,
  gateway,
  mode,
}: {
  deviceId: DeviceId;
  gateway: MixerGateway;
  mode: GatewayMode;
}) {
  const device = useAppStore(selectDevice(deviceId));
  const version = useAppStore(selectInstallationVersion);
  const editError = useAppStore(selectInstallationEditError);
  const setEditingDevice = useAppStore(selectSetEditingDevice);

  const storedLabel = device?.label;
  const [draft, setDraft] = useState(storedLabel ?? "");
  const labelRef = useRef<HTMLInputElement>(null);

  // The installation itself changed under us — this edit landing, or someone
  // else's arriving over the socket. The field follows the file: it shows what
  // is stored, it is not a document of its own.
  useEffect(() => {
    if (storedLabel !== undefined) setDraft(storedLabel);
  }, [storedLabel]);

  useEffect(() => {
    labelRef.current?.select();
  }, []);

  if (device === undefined) {
    return (
      <aside className="inspector" aria-label="Edit device">
        <header className="inspector__header">
          <span className="inspector__title">Unknown device</span>
          <button
            type="button"
            className="inspector__close"
            aria-label="Close inspector"
            onClick={() => setEditingDevice(null)}
          >
            ×
          </button>
        </header>
        <p className="inspector__id">{deviceId}</p>
        <p className="inspector__error">
          This device is no longer in the installation.
        </p>
      </aside>
    );
  }

  function commit(): void {
    if (device === undefined) return;
    commitDeviceLabel(gateway, version, deviceId, device.label, draft);
  }

  return (
    <aside className="inspector" aria-label={`Edit ${device.label}`}>
      <header className="inspector__header">
        <span className="inspector__title">{KIND_LABELS[device.kind]}</span>
        <button
          type="button"
          className="inspector__close"
          aria-label="Close inspector"
          onClick={() => setEditingDevice(null)}
        >
          ×
        </button>
      </header>

      <p className="inspector__id">{deviceId}</p>

      <label className="inspector__field">
        <span className="inspector__field-name">Label</span>
        <input
          ref={labelRef}
          type="text"
          autoFocus
          className="inspector__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              return;
            }
            if (event.key === "Escape") {
              // Stops the app-wide Escape handler from also dropping a pinned
              // route: in here, Escape means "abandon this draft".
              event.stopPropagation();
              setDraft(device.label);
            }
          }}
        />
      </label>

      {editError !== null && <p className="inspector__error">{editError}</p>}

      {mode === "mock" && (
        <p className="inspector__note">
          Simulated data: edits stay in this tab and are never written to
          installation.yaml.
        </p>
      )}
    </aside>
  );
}
