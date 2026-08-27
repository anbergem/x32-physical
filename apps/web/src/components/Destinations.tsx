/**
 * The destinations area (issue #11): every powered speaker/zone the
 * installation declares, partitioned into areas by the devices' `group`
 * (issue #22) — the same data-driven rule the stage section uses, so the two
 * halves of the schematic mirror each other however a venue names its parts.
 *
 * No device id appears here. Group order is order of first appearance in
 * `installation.yaml`, device order inside a group is declaration order, and
 * devices with no group collect into a final, untitled area. Arrangement —
 * that the areas sit in one row, and where the section falls on the page —
 * stays a layout decision (CLAUDE.md invariant 6: `group` is a name, never a
 * position).
 *
 * An installation with no destinations renders nothing at all, not an empty
 * bordered frame: plenty of rigs have no output cabling worth drawing.
 */

import type { DeviceGroup } from "../installation/deviceGroups";
import { deviceGroupsFor } from "../installation/deviceGroups";
import { selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { Destination } from "./Destination";

const DESTINATION_KINDS = ["destination"] as const;

function DestinationGroup({ group }: { group: DeviceGroup }) {
  return (
    <section className="destination-group">
      {group.title !== null && (
        <h3 className="destination-group__title">{group.title}</h3>
      )}
      <div className="destination-group__items">
        {group.devices.map((device) => (
          <Destination key={device.id} deviceId={device.id} />
        ))}
      </div>
    </section>
  );
}

export function Destinations() {
  const installation = useAppStore(selectInstallation);
  const groups = deviceGroupsFor(installation, DESTINATION_KINDS);

  if (groups.length === 0) return null;

  return (
    <section className="destinations">
      {groups.map((group) => (
        <DestinationGroup key={group.title ?? ""} group={group} />
      ))}
    </section>
  );
}
