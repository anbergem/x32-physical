/**
 * Adding a stagebox, panel or console (issue #29).
 *
 * Mounted in the edit bar rather than inside a section, because it has to be
 * reachable when there are **no sections at all**. An installation with no
 * devices is a perfectly valid one — it is the ordinary case with nothing in
 * it yet, not a special mode — so the path from a blank file to a working
 * topology starts here.
 *
 * A stagebox asks for its AES50 mapping up front. That is not a UI
 * preference: the pipeline validates after every operation, and a stagebox
 * without `aes50` fails `missing-aes50`, so there is no valid
 * "add it now, map it later" sequence to offer. The offset's consequence is
 * spelled out live for the reason `StructuralFields` explains at length —
 * it is one of the two values whose failure is silent and total.
 */

import type { Aes50Bus } from "@x32/domain";
import { useState } from "react";

import type { MixerGateway } from "../gateway/mixerGateway";
import { addDeviceOperation } from "../installation/edits";
import {
  aes50Collision,
  aes50RangeOverruns,
  describeAes50Range,
} from "../installation/structuralEdit";
import { selectInstallation, selectInstallationVersion } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

type NewDeviceKind = "stagebox" | "passive-panel" | "console";

const KIND_NAMES: Record<NewDeviceKind, string> = {
  stagebox: "Stagebox",
  "passive-panel": "Panel",
  console: "Console",
};

export function AddDeviceControl({ gateway }: { gateway: MixerGateway }) {
  const installation = useAppStore(selectInstallation);
  const version = useAppStore(selectInstallationVersion);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NewDeviceKind>("stagebox");
  const [label, setLabel] = useState("");
  const [inputs, setInputs] = useState("16");
  const [bus, setBus] = useState<Aes50Bus>("A");
  const [offset, setOffset] = useState("0");

  const inputCount = Number(inputs);
  const offsetValue = Number(offset);
  const countsValid = Number.isInteger(inputCount) && inputCount >= 1;
  const offsetValid = Number.isInteger(offsetValue) && offsetValue >= 0;

  const collision =
    kind === "stagebox" && countsValid && offsetValid
      ? aes50Collision(installation, bus, offsetValue, inputCount)
      : null;
  const overruns =
    kind === "stagebox" && countsValid && offsetValid
      ? aes50RangeOverruns(offsetValue, inputCount)
      : false;

  function add(): void {
    if (version === null) return;
    const operation = addDeviceOperation(
      kind,
      label,
      inputCount,
      installation.devices.map((device) => device.id),
      kind === "stagebox" ? { bus, offset: offsetValue } : undefined,
    );
    if (operation === null) return;

    gateway.applyInstallationEdit(version, operation);
    setLabel("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="inspector__action" onClick={() => setOpen(true)}>
        Add device
      </button>
    );
  }

  return (
    <div className="add-device">
      <div className="inspector__choices">
        {(Object.keys(KIND_NAMES) as NewDeviceKind[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={kind === candidate}
            onClick={() => setKind(candidate)}
          >
            {KIND_NAMES[candidate]}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="inspector__input"
        placeholder="Name, e.g. Stagebox V"
        value={label}
        autoFocus
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />

      <label className="inspector__field">
        <span className="inspector__field-name">Inputs</span>
        <input
          type="number"
          min={1}
          className="inspector__input"
          value={inputs}
          onChange={(event) => setInputs(event.target.value)}
        />
      </label>

      {kind === "stagebox" && (
        <>
          <div className="inspector__choices">
            {(["A", "B"] as Aes50Bus[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={bus === candidate}
                onClick={() => setBus(candidate)}
              >
                AES50-{candidate}
              </button>
            ))}
          </div>

          <label className="inspector__field">
            <span className="inspector__field-name">AES50 offset</span>
            <input
              type="number"
              min={0}
              className="inspector__input"
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
            />
            <p className="inspector__hint">
              Set on the box itself — the channel its first input lands on, minus one.
            </p>
          </label>

          {overruns ? (
            <p className="inspector__warning">
              That runs past AES50 channel 48 — a bus carries 48.
            </p>
          ) : collision !== null ? (
            <p className="inspector__warning">
              Those channels are already claimed by {collision.label} — both boxes would
              be wrong.
            </p>
          ) : (
            countsValid &&
            offsetValid && (
              <p className="inspector__preview">
                {describeAes50Range(bus, offsetValue, inputCount)}
              </p>
            )
          )}
        </>
      )}

      <div className="inspector__confirm-buttons">
        <button type="button" className="inspector__action" onClick={add}>
          Add
        </button>
        <button type="button" className="inspector__action" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
