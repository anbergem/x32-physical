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
import { formatAes50ChainDetail } from "../format/aes50";
import { describeRemoval } from "../installation/structuralEdit";
import { deviceGroupOperation, removeDeviceOperation } from "../installation/edits";
import { commitDeviceLabel } from "../installation/labelEdit";

import { StructuralFields } from "./StructuralFields";
import {
  selectDevice,
  selectEditingDevice,
  selectAes50ChainDiscrepancies,
  selectInstallation,
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
  const storedGroup = device?.group;
  const [draft, setDraft] = useState(storedLabel ?? "");
  const [groupDraft, setGroupDraft] = useState(storedGroup ?? "");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const installation = useAppStore(selectInstallation);
  const chainDiscrepancies = useAppStore(selectAes50ChainDiscrepancies);

  // The installation itself changed under us — this edit landing, or someone
  // else's arriving over the socket. The field follows the file: it shows what
  // is stored, it is not a document of its own.
  useEffect(() => {
    if (storedLabel !== undefined) setDraft(storedLabel);
  }, [storedLabel]);

  useEffect(() => {
    setGroupDraft(storedGroup ?? "");
  }, [storedGroup]);

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

  function commitGroup(): void {
    if (device === undefined || version === null) return;
    const operation = deviceGroupOperation(deviceId, device.group, groupDraft);
    if (operation === null) return;
    gateway.applyInstallationEdit(version, operation);
  }

  function removeDevice(): void {
    if (version === null) return;
    gateway.applyInstallationEdit(version, removeDeviceOperation(deviceId));
    setEditingDevice(null);
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

      <label className="inspector__field">
        <span className="inspector__field-name">Group</span>
        <input
          type="text"
          className="inspector__input"
          placeholder="Ungrouped"
          value={groupDraft}
          onChange={(event) => setGroupDraft(event.target.value)}
          onBlur={commitGroup}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitGroup();
              return;
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              setGroupDraft(device?.group ?? "");
            }
          }}
        />
      </label>

      {/* Structural fields — counts, the AES50 mapping, the output block.
          Nothing for a destination, which has no sockets of its own. */}
      <StructuralFields device={device} gateway={gateway} />

      {/* The console's own view of the AES50 chain, shown exactly where boxes
          are declared (issue #29). It is the only independent confirmation
          this tool has, and it is most useful at the moment someone is
          typing what they believe the rig to be. */}
      {device.kind === "stagebox" && chainDiscrepancies.length > 0 && (
        <p className="inspector__warning">
          The console reports a different set of stage boxes:{" "}
          {chainDiscrepancies.map(formatAes50ChainDetail).join("; ")}
        </p>
      )}

      {/* Any kind may be removed since issue #29 — but removing a stagebox
          strands every socket that fed it, so the confirmation counts the
          real cost first. */}
      <div className="inspector__actions">
        {confirmingRemove ? (
          <div className="inspector__confirm">
            <p className="inspector__confirm-text">
              {describeRemoval(installation, deviceId)}
            </p>
            <div className="inspector__confirm-buttons">
              <button type="button" className="inspector__danger" onClick={removeDevice}>
                Remove
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="inspector__danger"
            onClick={() => setConfirmingRemove(true)}
          >
            Remove {KIND_LABELS[device.kind].toLowerCase()}
          </button>
        )}
      </div>

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
