/**
 * The destinations area (issue #11): every powered speaker/zone, grouped
 * left/right/other to mirror the stage areas above it — the same
 * hard-coded-layout discipline `App.tsx` already applies to the stageboxes
 * (CLAUDE.md invariant 6: no coordinates, ever, and grouping is a layout
 * decision made here, not derived from `installation.yaml`).
 *
 * Membership matches docs/installation.md "Output topology" / the owner's
 * own spatial description of the room: left mirrors "Stage left", right
 * mirrors "Stage right", and the two console-fed zones (Sidesal, Vip Rom)
 * that aren't part of either side sit in their own group.
 */

import { deviceId } from "@x32/domain";
import type { DeviceId } from "@x32/domain";

import { Destination } from "./Destination";

const LEFT: DeviceId[] = [
  deviceId("front-venstre"),
  deviceId("piano-venstre"),
  deviceId("venstre-bak"),
  deviceId("sub"),
  deviceId("main-left"),
];

const RIGHT: DeviceId[] = [
  deviceId("front-hoyre"),
  deviceId("piano-hoyre"),
  deviceId("bak-hoyre"),
  deviceId("main-right"),
];

const OTHER: DeviceId[] = [deviceId("sidesal"), deviceId("vip-rom")];

function DestinationGroup({ title, devices }: { title: string; devices: DeviceId[] }) {
  return (
    <section className="destination-group">
      <h3 className="destination-group__title">{title}</h3>
      <div className="destination-group__items">
        {devices.map((id) => (
          <Destination key={id} deviceId={id} />
        ))}
      </div>
    </section>
  );
}

export function Destinations() {
  return (
    <section className="destinations">
      <DestinationGroup title="Left" devices={LEFT} />
      <DestinationGroup title="Right" devices={RIGHT} />
      <DestinationGroup title="Other" devices={OTHER} />
    </section>
  );
}
