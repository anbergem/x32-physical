/**
 * A destination: a powered speaker or zone (issue #11) — a device-level
 * endpoint with no socket number of its own (architecture.md §3
 * `DestinationRef`). Hovering it highlights the whole output route that
 * feeds it, same as any other endpoint.
 *
 * In edit mode (issue #27) a click selects the device for the inspector
 * instead of pinning its route. Hover is untouched, so the route still lights
 * as the pointer passes over — what changes is only what a *deliberate* click
 * means, which is exactly the ambiguity edit mode exists to remove.
 */

import type { DeviceId } from "@x32/domain";
import { destination, endpointId } from "@x32/domain";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  selectDevice,
  selectEditMode,
  selectHoverStatus,
  selectIsEditingDevice,
  selectSetEditingDevice,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { MissingDevice } from "./DeviceFrame";
import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier, isHoveredEndpoint } from "./highlight";
import { useEndpointPointer } from "./useEndpointPointer";

export function Destination({ deviceId }: { deviceId: DeviceId }) {
  const device = useAppStore(selectDevice(deviceId));
  const endpoint = endpointId(destination(deviceId));
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const pointer = useEndpointPointer(endpoint);
  const editMode = useAppStore(selectEditMode);
  const editing = useAppStore(selectIsEditingDevice(deviceId));
  const setEditingDevice = useAppStore(selectSetEditingDevice);

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  const classNames = ["destination"];
  const hoverClass = hoverModifier("destination", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);
  if (editMode) classNames.push("destination--editable");
  if (editing) classNames.push("destination--editing");

  function handleEditPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    // Stops `App`'s background handler from reading this as a tap on nothing.
    event.stopPropagation();
    setEditingDevice(deviceId);
  }

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      {...pointer}
      {...(editMode ? { onPointerUp: handleEditPointerUp } : {})}
    >
      <span className="destination__label">{device.label}</span>
      {isHoveredEndpoint(hoverStatus) && (
        <EndpointTooltip endpoint={endpoint} pinned={hoverStatus === "pinned"} />
      )}
    </div>
  );
}
