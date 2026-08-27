/**
 * Which devices the schematic draws, and in what groups — derived from the
 * installation instead of from a list of this venue's device ids (issue #22).
 *
 * Before this, `App.tsx` named `stagebox-1`/`front-left`/… and
 * `Destinations.tsx` named all eleven of one venue's speakers. Clone the repo,
 * write your own `installation.yaml`, and you got someone else's schematic.
 * Now membership and grouping come from the data:
 *
 * - a group is the device's `group` name, which is a *name and never a
 *   coordinate* (CLAUDE.md invariant 6, `Device.group`);
 * - group order is order of first appearance in the device list, and device
 *   order inside a group is declaration order — which is what puts a stagebox
 *   above the panel cabled into it, and gives the YAML author control of the
 *   reading order without ever writing a position;
 * - ungrouped devices collect into one final, untitled group, because being
 *   ungrouped is an ordinary state (this venue's FOH desk is) and a config
 *   with no groups at all must still render one sensible flow.
 *
 * What stays hard-coded is *arrangement*: which section sits above which on
 * the page, and that a group is drawn as a bordered area. Only membership is
 * data. Nothing here knows a device id.
 *
 * Pure and memoized per installation object, following `aes50Labels.ts` and
 * `outputCabling.ts`: the installation is structural and set once at startup
 * (CLAUDE.md invariant 1), so a `WeakMap` computes each answer once for the
 * app's lifetime and every component gets the same array identity — a hover
 * or a tap can never invalidate it.
 */

import type { Aes50Bus, Device, DeviceKind, Installation } from "@x32/domain";

/**
 * One rendered area: the devices sharing a `group`, in declaration order.
 * `title` is `null` for the trailing ungrouped area — which is drawn without
 * a heading, not with an invented one ("Other", "Ungrouped" and friends are
 * all confident lies about data that simply says nothing).
 */
export interface DeviceGroup {
  title: string | null;
  devices: readonly Device[];
}

/**
 * Partitions `devices` (already filtered to the kinds a section draws) by
 * `group`. Exported for tests and used by the memoized accessors below.
 */
export function groupDevices(devices: readonly Device[]): DeviceGroup[] {
  const named = new Map<string, Device[]>();
  const ungrouped: Device[] = [];

  for (const device of devices) {
    // The schema already trims a group and normalises an empty one to
    // `undefined` (issue #20), so this is the only ungrouped test needed.
    if (device.group === undefined) {
      ungrouped.push(device);
      continue;
    }
    const existing = named.get(device.group);
    if (existing === undefined) named.set(device.group, [device]);
    else existing.push(device);
  }

  // `Map` iterates in insertion order, which is first appearance.
  const groups: DeviceGroup[] = [...named].map(([title, members]) => ({
    title,
    devices: members,
  }));
  if (ungrouped.length > 0) groups.push({ title: null, devices: ungrouped });
  return groups;
}

/** Every device of one of `kinds`, in declaration order. */
export function devicesOfKind(
  installation: Installation,
  kinds: readonly DeviceKind[],
): Device[] {
  return installation.devices.filter((device) => kinds.includes(device.kind));
}

/** The AES50 buses this installation actually declares a stagebox on. */
export function aes50BusesInUse(installation: Installation): Aes50Bus[] {
  const buses: Aes50Bus[] = [];
  for (const device of installation.devices) {
    if (device.kind !== "stagebox" || device.aes50 === undefined) continue;
    if (!buses.includes(device.aes50.bus)) buses.push(device.aes50.bus);
  }
  return buses;
}

const groupCache = new WeakMap<Installation, Map<string, DeviceGroup[]>>();

/**
 * The groups a section draws, memoized per installation *and* per kind set,
 * so `Stage` and `Destinations` each compute theirs once.
 */
export function deviceGroupsFor(
  installation: Installation,
  kinds: readonly DeviceKind[],
): DeviceGroup[] {
  let byKind = groupCache.get(installation);
  if (byKind === undefined) {
    byKind = new Map();
    groupCache.set(installation, byKind);
  }
  const key = [...kinds].join("+");
  const cached = byKind.get(key);
  if (cached !== undefined) return cached;

  const computed = groupDevices(devicesOfKind(installation, kinds));
  byKind.set(key, computed);
  return computed;
}

/**
 * The console device, if one is declared. `undefined` is a legitimate
 * installation (a rig with no desk-local inputs worth drawing), and the
 * console *section* then renders nothing rather than an empty frame. The
 * first one wins if a config somehow declares several — the X32 has one set
 * of local inputs, and drawing a second desk would be inventing hardware.
 */
export function consoleDeviceFor(installation: Installation): Device | undefined {
  return installation.devices.find((device) => device.kind === "console");
}
