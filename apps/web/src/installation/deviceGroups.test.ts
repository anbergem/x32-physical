/**
 * The data-driven layout rules (issue #22). These are the tests that stand in
 * for a DOM harness the repo deliberately does not have: the components are
 * thin over these helpers, so what is asserted here is what the schematic
 * draws — membership, group order, device order, and every degenerate shape a
 * foreign `installation.yaml` can take.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Device, DeviceId, Installation } from "@x32/domain";
import { parseInstallationYaml } from "@x32/installation";
import { describe, expect, it } from "vitest";

import {
  aes50BusesInUse,
  consoleDeviceFor,
  deviceGroupsFor,
  devicesOfKind,
  groupDevices,
} from "./deviceGroups";

const STAGE_KINDS = ["stagebox", "passive-panel"] as const;
const DESTINATION_KINDS = ["destination"] as const;

/** The repo's real venue file — the layout this app renders today. */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../../config/installation.yaml", import.meta.url),
);

/** An entirely invented rig: different ids, two panels, one stagebox, no console. */
const EXAMPLE_CONFIG = fileURLToPath(
  new URL("../__fixtures__/example-installation.yaml", import.meta.url),
);

function load(path: string): Installation {
  return parseInstallationYaml(readFileSync(path, "utf8"), path);
}

/** A minimal device, only the fields grouping cares about. */
function device(id: string, group?: string): Device {
  return {
    id: id as DeviceId,
    kind: "passive-panel",
    label: id,
    inputs: 1,
    ...(group === undefined ? {} : { group }),
  };
}

/** `[["Title", ["id", …]], …]`, with `null` for the untitled group. */
function shape(groups: readonly { title: string | null; devices: readonly Device[] }[]) {
  return groups.map((group) => [group.title, group.devices.map((d) => d.id)]);
}

describe("groupDevices", () => {
  it("orders groups by first appearance and devices by declaration order", () => {
    expect(
      shape(
        groupDevices([
          device("a", "Right"),
          device("b", "Left"),
          device("c", "Right"),
          device("d", "Left"),
          device("e", "Right"),
        ]),
      ),
    ).toEqual([
      ["Right", ["a", "c", "e"]],
      ["Left", ["b", "d"]],
    ]);
  });

  it("collects ungrouped devices into one trailing untitled group", () => {
    expect(
      shape(
        groupDevices([
          device("loose-1"),
          device("a", "Stage"),
          device("loose-2"),
          device("b", "Stage"),
        ]),
      ),
    ).toEqual([
      ["Stage", ["a", "b"]],
      [null, ["loose-1", "loose-2"]],
    ]);
  });

  it("puts every device in one untitled group when nothing is grouped", () => {
    expect(shape(groupDevices([device("a"), device("b")]))).toEqual([
      [null, ["a", "b"]],
    ]);
  });

  it("keeps a group holding a single device", () => {
    expect(shape(groupDevices([device("only", "Balcony")]))).toEqual([
      ["Balcony", ["only"]],
    ]);
  });

  it("returns no groups at all for no devices — never an empty untitled one", () => {
    expect(groupDevices([])).toEqual([]);
  });
});

describe("the venue's own installation", () => {
  const venue = load(VENUE_CONFIG);

  it("yields today's stage areas, in today's order", () => {
    expect(shape(deviceGroupsFor(venue, STAGE_KINDS))).toEqual([
      ["Stage left", ["stagebox-1", "front-left"]],
      ["Stage right", ["stagebox-2", "front-right"]],
    ]);
  });

  it("yields today's destination groups, in today's order", () => {
    expect(shape(deviceGroupsFor(venue, DESTINATION_KINDS))).toEqual([
      ["Other", ["sidesal", "vip-rom"]],
      ["Left", ["front-venstre", "piano-venstre", "venstre-bak", "sub", "main-left"]],
      ["Right", ["front-hoyre", "piano-hoyre", "bak-hoyre", "main-right"]],
    ]);
  });

  it("finds the (ungrouped) console device without naming its id", () => {
    expect(consoleDeviceFor(venue)?.label).toBe("Mikserpult (FOH)");
    // Ungrouped is an ordinary state and must not put the desk on stage.
    expect(
      deviceGroupsFor(venue, STAGE_KINDS).some((group) => group.title === null),
    ).toBe(false);
  });

  it("declares stageboxes on AES50-A only", () => {
    expect(aes50BusesInUse(venue)).toEqual(["A"]);
  });

  it("memoizes per installation and per kind set", () => {
    expect(deviceGroupsFor(venue, STAGE_KINDS)).toBe(
      deviceGroupsFor(venue, STAGE_KINDS),
    );
    expect(deviceGroupsFor(venue, STAGE_KINDS)).not.toBe(
      deviceGroupsFor(venue, DESTINATION_KINDS),
    );
  });
});

describe("an invented foreign installation", () => {
  const example = load(EXAMPLE_CONFIG);

  it("yields its own stage areas, not this venue's", () => {
    expect(shape(deviceGroupsFor(example, STAGE_KINDS))).toEqual([
      ["Downstage", ["snake-a", "dsl-plate"]],
      ["Upstage", ["usr-box"]],
    ]);
  });

  it("puts its ungrouped destination in a trailing untitled group", () => {
    expect(shape(deviceGroupsFor(example, DESTINATION_KINDS))).toEqual([
      ["House", ["main-pa"]],
      [null, ["wedge-1"]],
    ]);
  });

  it("declares no console device, so no console input frame is drawn", () => {
    expect(consoleDeviceFor(example)).toBeUndefined();
  });
});

describe("degenerate installations", () => {
  const empty: Installation = { devices: [], connections: [] };

  it("yields empty collections rather than throwing when nothing is declared", () => {
    expect(deviceGroupsFor(empty, STAGE_KINDS)).toEqual([]);
    expect(deviceGroupsFor(empty, DESTINATION_KINDS)).toEqual([]);
    expect(consoleDeviceFor(empty)).toBeUndefined();
    expect(aes50BusesInUse(empty)).toEqual([]);
  });

  it("renders a lone stagebox with no panel as one group", () => {
    const lone: Installation = {
      devices: [
        {
          id: "box" as DeviceId,
          kind: "stagebox",
          label: "Box",
          inputs: 16,
          aes50: { bus: "B", offset: 0 },
        },
      ],
      connections: [],
    };

    expect(shape(deviceGroupsFor(lone, STAGE_KINDS))).toEqual([[null, ["box"]]]);
    expect(deviceGroupsFor(lone, DESTINATION_KINDS)).toEqual([]);
    expect(aes50BusesInUse(lone)).toEqual(["B"]);
  });

  it("reports each AES50 bus once, in declaration order", () => {
    const three: Installation = {
      devices: ["b1", "b2", "b3"].map((id, index) => ({
        id: id as DeviceId,
        kind: "stagebox" as const,
        label: id,
        inputs: 16,
        aes50: { bus: index === 1 ? ("B" as const) : ("A" as const), offset: 0 },
      })),
      connections: [],
    };

    expect(aes50BusesInUse(three)).toEqual(["A", "B"]);
    expect(shape(deviceGroupsFor(three, STAGE_KINDS))).toEqual([
      [null, ["b1", "b2", "b3"]],
    ]);
  });

  it("filters by kind, never by id", () => {
    const mixed: Installation = {
      devices: [
        device("panel", "Stage"),
        { ...device("speaker", "House"), kind: "destination", inputs: 0 },
        { ...device("desk"), kind: "console", inputs: 32 },
      ],
      connections: [],
    };

    expect(devicesOfKind(mixed, STAGE_KINDS).map((d) => d.id)).toEqual(["panel"]);
    expect(devicesOfKind(mixed, DESTINATION_KINDS).map((d) => d.id)).toEqual([
      "speaker",
    ]);
    expect(consoleDeviceFor(mixed)?.id).toBe("desk");
  });
});
