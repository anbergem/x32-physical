/**
 * A passive wall/floor panel: numbered sockets, cabled onward to a stagebox.
 *
 * It identifies itself by device id and renders only what the installation
 * declares about that device. The cabling itself is not drawn per socket — the
 * route highlighting of plan steps 7–8 is what shows where a socket goes.
 */

import { endpointId, panelInput } from "@x32/domain";
import type { DeviceId } from "@x32/domain";

import { selectDevice } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { DeviceFrame, MissingDevice, socketNumbers } from "./DeviceFrame";
import { InputPort } from "./InputPort";

export function PhysicalInputPanel({ deviceId }: { deviceId: DeviceId }) {
  const device = useAppStore(selectDevice(deviceId));

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  return (
    <DeviceFrame kind="panel" label={device.label} meta={`${device.inputs} in`}>
      {socketNumbers(device.inputs).map((socket) => (
        <InputPort
          key={socket}
          endpoint={endpointId(panelInput(device.id, socket))}
          label={String(socket)}
        />
      ))}
    </DeviceFrame>
  );
}
