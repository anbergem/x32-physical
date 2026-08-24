/**
 * A passive wall/floor panel: numbered sockets, cabled onward to a stagebox.
 *
 * It identifies itself by device id and renders only what the installation
 * declares about that device. The cabling itself is not drawn per socket — the
 * route highlighting of plan steps 7–8 is what shows where a socket goes.
 */

import { endpointId, panelInput } from "@x32/domain";
import type { DeviceId } from "@x32/domain";

import { aes50LabelsFor } from "../installation/aes50Labels";
import { selectDevice, selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { DeviceFrame, MissingDevice, socketNumbers } from "./DeviceFrame";
import { InputPort } from "./InputPort";

export function PhysicalInputPanel({ deviceId }: { deviceId: DeviceId }) {
  const device = useAppStore(selectDevice(deviceId));
  const installation = useAppStore(selectInstallation);
  const aes50Labels = aes50LabelsFor(installation);

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  return (
    <DeviceFrame kind="panel" label={device.label} meta={`${device.inputs} in`}>
      {socketNumbers(device.inputs).map((socket) => {
        const endpoint = endpointId(panelInput(device.id, socket));
        // Follows the venue's actual cabling, never the socket index — the
        // real installation's right-side panel is cabled offset by one
        // (docs/installation.md "Real panel wiring"), which is exactly the
        // case an index-derived label would get wrong.
        const busChannel = aes50Labels.get(endpoint);
        return (
          <InputPort
            key={socket}
            endpoint={endpoint}
            label={String(socket)}
            aes50Label={
              busChannel === undefined
                ? undefined
                : `${busChannel.bus}${busChannel.channel}`
            }
          />
        );
      })}
    </DeviceFrame>
  );
}
