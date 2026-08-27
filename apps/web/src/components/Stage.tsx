/**
 * The stage section: every `stagebox` and `passive-panel` the installation
 * declares, partitioned into areas by the devices' `group` (issue #22).
 *
 * Nothing here names a device. An area's membership, its title, and the order
 * of the boxes inside it all come from the file: group order is first
 * appearance, device order is declaration order — which is what draws a
 * stagebox above the panel cabled into it, without `installation.yaml` ever
 * carrying a position (CLAUDE.md invariant 6). Where the section sits on the
 * page, and that an area is a bordered box with a caption, remain layout
 * decisions made in JSX.
 *
 * The cabling between the boxes of one area is drawn as a single line between
 * consecutive devices, exactly as before: which socket goes where is answered
 * by highlighting a route, not by drawing sixteen wires. A one-device area
 * therefore has no line, which is the truthful picture.
 *
 * Renders nothing at all — no empty frame, no bus bar — when an installation
 * declares no stage devices.
 */

import type { Device } from "@x32/domain";
import { Fragment } from "react";

import {
  aes50BusesInUse,
  deviceGroupsFor,
} from "../installation/deviceGroups";
import { selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { PhysicalInputPanel } from "./PhysicalInputPanel";
import { Stagebox } from "./Stagebox";

/** The kinds that live on stage, in the sense of "not the desk, not a speaker". */
const STAGE_KINDS = ["stagebox", "passive-panel"] as const;

function StageDevice({ device }: { device: Device }) {
  return device.kind === "stagebox" ? (
    <Stagebox deviceId={device.id} />
  ) : (
    <PhysicalInputPanel deviceId={device.id} />
  );
}

export function Stage() {
  const installation = useAppStore(selectInstallation);
  const groups = deviceGroupsFor(installation, STAGE_KINDS);
  const buses = aes50BusesInUse(installation);

  if (groups.length === 0) return null;

  return (
    <>
      <div className="stage">
        {groups.map((group) => (
          <section className="stage-area" key={group.title ?? ""}>
            {group.title !== null && (
              <h2 className="stage-area__title">{group.title}</h2>
            )}
            {group.devices.map((device, index) => (
              <Fragment key={device.id}>
                {index > 0 && <div className="cable" aria-hidden="true" />}
                <StageDevice device={device} />
              </Fragment>
            ))}
          </section>
        ))}
      </div>

      {/* Named from the buses the stageboxes actually declare, so a rig on
          AES50-B — or on both — is labelled truthfully rather than with this
          venue's single bus. No stagebox at all, no bar. */}
      {buses.length > 0 && (
        <div className="bus" aria-hidden="true">
          <span className="bus__label">
            {buses.map((bus) => `AES50-${bus}`).join(" · ")}
          </span>
        </div>
      )}
    </>
  );
}
