/**
 * A destination: a powered speaker or zone (issue #11) — a device-level
 * endpoint with no socket number of its own (architecture.md §3
 * `DestinationRef`). Hovering it highlights the whole output route that
 * feeds it, same as any other endpoint.
 */

import type { DeviceId } from "@x32/domain";
import { destination, endpointId } from "@x32/domain";

import { selectDevice, selectHoverStatus } from "../state/selectors";
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

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  const classNames = ["destination"];
  const hoverClass = hoverModifier("destination", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      {...pointer}
    >
      <span className="destination__label">{device.label}</span>
      {isHoveredEndpoint(hoverStatus) && (
        <EndpointTooltip endpoint={endpoint} pinned={hoverStatus === "pinned"} />
      )}
    </div>
  );
}
