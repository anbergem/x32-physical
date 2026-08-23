/**
 * A stagebox: 16 inputs, dual-labelled with the number printed on the box and
 * the AES50 channel the console sees them as (`7` · `A23`). Both numbers are on
 * screen because the X32's own routing screens speak AES50 channels while the
 * person on stage is looking at the box.
 *
 * The AES50 number is arithmetic on static installation data (`aes50.offset`,
 * box input *n* → bus channel *offset + n*), not a route lookup: no topology
 * tracing happens in components (architecture.md §5).
 */

import { endpointId, stageboxInput } from "@x32/domain";
import type { Device } from "@x32/domain";

import { selectDevice } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { DeviceFrame, MissingDevice, socketNumbers } from "./DeviceFrame";
import { InputPort } from "./InputPort";

/** `AES50-A 17–32`, or a warning when the device declares no AES50 mapping. */
function metaOf(device: Device): string {
  if (device.aes50 === undefined) return "no AES50 mapping";
  const { bus, offset } = device.aes50;
  return `AES50-${bus} ${offset + 1}–${offset + device.inputs}`;
}

export function Stagebox({ deviceId }: { deviceId: string }) {
  const device = useAppStore(selectDevice(deviceId));

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  const aes50 = device.aes50;

  return (
    <DeviceFrame kind="stagebox" label={device.label} meta={metaOf(device)}>
      {socketNumbers(device.inputs).map((socket) => (
        <InputPort
          key={socket}
          endpoint={endpointId(stageboxInput(device.id, socket))}
          label={String(socket)}
          aes50Label={
            aes50 === undefined
              ? undefined
              : `${aes50.bus}${aes50.offset + socket}`
          }
        />
      ))}
    </DeviceFrame>
  );
}
