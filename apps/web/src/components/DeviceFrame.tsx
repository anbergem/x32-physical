/**
 * Shared chrome for a device box: a caption line plus a grid of sockets.
 * Used by both `PhysicalInputPanel` and `Stagebox` so they stay visually
 * identical apart from what their sockets say.
 *
 * In edit mode (issue #27) the caption becomes the device's selection target:
 * the label turns into a button that opens the inspector. One place, so every
 * device kind that uses this frame is editable the same way and none of them
 * has to know editing exists. Outside edit mode the markup is exactly what it
 * always was — no button, no extra affordance on a read-only schematic.
 */

import type { DeviceId } from "@x32/domain";
import type { ReactNode } from "react";

import { selectEditMode, selectIsEditingDevice, selectSetEditingDevice } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function DeviceFrame({
  kind,
  deviceId,
  label,
  meta,
  children,
  outputs,
}: {
  kind: "panel" | "stagebox" | "console";
  /**
   * The device this frame draws. Only edit mode needs it — a frame without one
   * simply is not selectable, which keeps this prop optional for any future
   * caller that draws something with no device behind it.
   */
  deviceId?: DeviceId;
  label: string;
  /** Short static fact, e.g. socket count or the box's AES50 range. */
  meta: string;
  children: ReactNode;
  /**
   * A stagebox's outputs row (issue #11), rendered as its own labelled row
   * below the inputs grid — the box is one physical object with 16 in / 8
   * out, and the frame says so, rather than splitting outputs into a
   * separate area. `undefined` for a device with no outputs (every panel,
   * and a stagebox with none declared).
   */
  outputs?: ReactNode;
}) {
  const editMode = useAppStore(selectEditMode);
  const editing = useAppStore(selectIsEditingDevice(deviceId ?? NO_DEVICE));
  const setEditingDevice = useAppStore(selectSetEditingDevice);

  const editable = editMode && deviceId !== undefined;
  const classNames = ["device", `device--${kind}`];
  if (editable) classNames.push("device--editable");
  if (editing) classNames.push("device--editing");

  return (
    <section className={classNames.join(" ")}>
      <header className="device__header">
        {editable ? (
          <button
            type="button"
            className="device__label device__label--editable"
            onClick={() => setEditingDevice(deviceId)}
          >
            {label}
          </button>
        ) : (
          <span className="device__label">{label}</span>
        )}
        <span className="device__meta">{meta}</span>
      </header>
      <div className="device__ports">{children}</div>
      {outputs !== undefined && (
        <div className="device__outputs">
          <span className="device__outputs-label">OUT</span>
          <div className="device__ports">{outputs}</div>
        </div>
      )}
    </section>
  );
}

/**
 * A device the store cannot find. Since issue #22 the layout draws only what
 * `installation.yaml` declares, so nothing the schematic renders can reach
 * this — it is the honest last resort for a device id that came from
 * somewhere else (a deep link, a future layout source). Say so in place
 * rather than crashing or silently dropping part of the schematic: naming a
 * device we know nothing about is the one thing this tool must never do.
 */
export function MissingDevice({ deviceId }: { deviceId: DeviceId }) {
  return (
    <section className="device device--missing">
      <header className="device__header">
        <span className="device__label">{deviceId}</span>
        <span className="device__meta">not in installation.yaml</span>
      </header>
    </section>
  );
}

/**
 * The id a frame with no device stands in for. Device ids are kebab-case
 * (`@x32/domain`'s `deviceId`), so this can never collide with a real one, and
 * `selectIsEditingDevice` is a hook that must be called unconditionally.
 */
const NO_DEVICE = "" as DeviceId;

/** `1 … inputs`, the socket numbers as printed on the hardware. */
export function socketNumbers(inputs: number): number[] {
  if (!Number.isInteger(inputs) || inputs < 1) return [];
  return Array.from({ length: inputs }, (_, index) => index + 1);
}
