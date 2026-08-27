/**
 * The console's own local XLR inputs (issue #2) — physically at FOH,
 * alongside the mixer section rather than on stage with the stage panels
 * (docs/installation.md "Real panel wiring": the venue's IN 1–3 are in
 * use). Rendered as two rows of 16, like the hardware, and styled more
 * subtly than the stage panels since most of the 32 sockets are unused.
 *
 * No AES50 dual label: a console local input never reaches an AES50 bus
 * (`aes50ChannelsByEndpoint` skips console devices), so there is nothing to
 * dual-label it with.
 *
 * Mirrors `PhysicalInputPanel`: it knows only the device id, reads what the
 * installation declares, and leaves hover/selection/diagnostics highlighting
 * to `InputPort` and the route index — no topology walking here.
 */

import { endpointId, localInput } from "@x32/domain";
import type { DeviceId } from "@x32/domain";

import { selectDevice } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { DeviceFrame, MissingDevice, socketNumbers } from "./DeviceFrame";
import { InputPort } from "./InputPort";

export function ConsoleInputs({ deviceId }: { deviceId: DeviceId }) {
  const device = useAppStore(selectDevice(deviceId));

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  return (
    <DeviceFrame kind="console" label={device.label} meta={`${device.inputs} in`}>
      {socketNumbers(device.inputs).map((socket) => (
        <InputPort
          key={socket}
          endpoint={endpointId(localInput(device.id, socket))}
          label={String(socket)}
        />
      ))}
    </DeviceFrame>
  );
}
