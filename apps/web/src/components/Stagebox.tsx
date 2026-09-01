/**
 * A stagebox: 16 inputs, dual-labelled with the number printed on the box and
 * the AES50 channel the console sees them as (`7` · `A23`). Both numbers are on
 * screen because the X32's own routing screens speak AES50 channels while the
 * person on stage is looking at the box.
 *
 * The cascade arithmetic behind that second number belongs to the domain
 * (`aes50ChannelForInput`), not to this component: the same function derives
 * the graph edges, so a label can never disagree with a route.
 */

import { aes50ChannelForInput, endpointId, stageboxInput, stageboxOutput } from "@x32/domain";
import type { Device, DeviceId } from "@x32/domain";

import { aes50LabelsFor } from "../installation/aes50Labels";
import { physicalOutputDestinationsFor } from "../installation/outputCabling";
import { outputSlotsFor } from "../installation/outputLabels";
import { selectDevice, selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { DeviceFrame, MissingDevice, socketNumbers } from "./DeviceFrame";
import { socketAnnotationsFor } from "../installation/socketAnnotations";

import { InputPort } from "./InputPort";
import { OutputPort } from "./OutputPort";

/** `AES50-A 17–32`, or a warning when the device declares no AES50 mapping. */
function metaOf(device: Device): string {
  const first = aes50ChannelForInput(device, 1);
  const last = aes50ChannelForInput(device, device.inputs);
  if (first === undefined || last === undefined) return "no AES50 mapping";
  return `AES50-${first.bus} ${first.channel}–${last.channel}`;
}

export function Stagebox({ deviceId }: { deviceId: DeviceId }) {
  const device = useAppStore(selectDevice(deviceId));
  const installation = useAppStore(selectInstallation);
  const aes50Labels = aes50LabelsFor(installation);
  const socketAnnotations = socketAnnotationsFor(installation);
  const outputSlots = outputSlotsFor(installation);
  const outputDestinations = physicalOutputDestinationsFor(installation);

  if (device === undefined) return <MissingDevice deviceId={deviceId} />;

  const outputCount = device.outputs ?? 0;

  return (
    <DeviceFrame
      kind="stagebox"
      deviceId={device.id}
      label={device.label}
      meta={metaOf(device)}
      outputs={
        outputCount === 0
          ? undefined
          : socketNumbers(outputCount).map((socket) => {
              const endpoint = endpointId(stageboxOutput(device.id, socket));
              const slot = outputSlots.get(endpoint);
              return (
                <OutputPort
                  key={socket}
                  endpoint={endpoint}
                  label={String(socket)}
                  outSlotLabel={slot === undefined ? undefined : `Out ${slot}`}
                  cabled={outputDestinations.has(endpoint)}
                />
              );
            })
      }
    >
      {socketNumbers(device.inputs).map((socket) => {
        const endpoint = endpointId(stageboxInput(device.id, socket));
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
            // A stagebox input can be annotated too — the schema allows it on
            // any device with inputs, and the validator enforces it there.
            // Only panels ever rendered one before (issue #12 was a panel),
            // so a legal stagebox annotation was invisible until issue #28
            // made annotations editable everywhere.
            socketAnnotation={socketAnnotations.get(endpoint)}
          />
        );
      })}
    </DeviceFrame>
  );
}
