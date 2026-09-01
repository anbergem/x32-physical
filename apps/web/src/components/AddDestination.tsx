/**
 * The "add a destination" control, shown in edit mode beneath the
 * destinations section (issue #28).
 *
 * It asks for a **label and a group** and nothing else. A destination's device
 * id is derived from its label (`uniqueDeviceId`), because ids are an
 * implementation detail of `installation.yaml` — making a technician invent a
 * unique slug would be exactly the schema knowledge this editor exists to
 * hide. `inputs: 0` is likewise never asked for: the loader supplies it.
 */

import { useState } from "react";

import type { MixerGateway } from "../gateway/mixerGateway";
import { addDestinationOperation } from "../installation/edits";
import {
  selectInstallation,
  selectInstallationEditError,
  selectInstallationVersion,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function AddDestination({ gateway }: { gateway: MixerGateway }) {
  const installation = useAppStore(selectInstallation);
  const version = useAppStore(selectInstallationVersion);
  const editError = useAppStore(selectInstallationEditError);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");

  function add(): void {
    const operation = addDestinationOperation(
      label,
      group,
      installation.devices.map((device) => device.id),
    );
    // A blank label sends nothing: an unnamed box on the schematic helps
    // nobody, and a blank field is nearly always a slip.
    if (operation === null || version === null) return;

    gateway.applyInstallationEdit(version, operation);
    setLabel("");
    setGroup("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="add-destination">
        <button type="button" className="inspector__action" onClick={() => setOpen(true)}>
          Add destination
        </button>
      </div>
    );
  }

  return (
    <div className="add-destination add-destination--open">
      <input
        type="text"
        className="inspector__input"
        placeholder="Name, e.g. Balcony Fill"
        value={label}
        autoFocus
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <input
        type="text"
        className="inspector__input"
        placeholder="Group (optional)"
        value={group}
        onChange={(event) => setGroup(event.target.value)}
      />
      <div className="inspector__confirm-buttons">
        <button type="button" className="inspector__action" onClick={add}>
          Add
        </button>
        <button type="button" className="inspector__action" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {editError !== null && <p className="inspector__error">{editError}</p>}
    </div>
  );
}
