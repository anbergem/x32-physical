/**
 * The arithmetic behind structural editing, presented as questions a
 * technician can answer (issue #29).
 *
 * **Why this module exists.** `aes50.offset` and `outputBlock.start` are the
 * two most dangerous values in an installation. Neither appears on any patch
 * sheet — at the maintainer's venue both were reverse-engineered from the
 * cascade and the routing column — and getting either wrong silently
 * mislabels every socket or every output on that box. Nothing over OSC will
 * catch it: the console reports the same channels either way, and the
 * schematic will look entirely plausible while pointing at the wrong socket.
 *
 * So the interface must never ask for a raw integer and hope. It shows the
 * *consequence* of the number as it is typed — "inputs 1–16 → AES50-A 17–32"
 * — and flags a collision with another box before anything is saved. The
 * human still declares the value; a DIP switch is a physical fact and
 * inferring it from anything else would be exactly the confident guess this
 * tool exists to prevent.
 */

import type { Aes50Bus, Device, DeviceId, Installation } from "@x32/domain";
import { MIXER_OUTPUT_COUNT } from "@x32/domain";

/** The highest AES50 channel a bus carries. */
export const AES50_CHANNEL_COUNT = 48;
/** Every stagebox presents 8 of the console's Out slots on its own XLRs. */
export const OUTPUT_BLOCK_SIZE = 8;

export interface Aes50Range {
  readonly first: number;
  readonly last: number;
}

/**
 * The bus channels a box's inputs land on: input *n* → `offset + n`, both
 * 1-based. `null` when the numbers cannot describe a range at all.
 */
export function aes50RangeFor(offset: number, inputs: number): Aes50Range | null {
  if (!Number.isInteger(offset) || offset < 0) return null;
  if (!Number.isInteger(inputs) || inputs < 1) return null;
  return { first: offset + 1, last: offset + inputs };
}

/** "inputs 1–16 → AES50-A 17–32", the sentence the form shows live. */
export function describeAes50Range(
  bus: Aes50Bus,
  offset: number,
  inputs: number,
): string | null {
  const range = aes50RangeFor(offset, inputs);
  if (range === null) return null;
  return `inputs 1–${inputs} → AES50-${bus} ${range.first}–${range.last}`;
}

/** Whether the range runs past the bus's 48 channels — the commonest arithmetic slip. */
export function aes50RangeOverruns(offset: number, inputs: number): boolean {
  const range = aes50RangeFor(offset, inputs);
  return range !== null && range.last > AES50_CHANNEL_COUNT;
}

/**
 * The already-declared box whose channels this range would collide with, or
 * `null`.
 *
 * An overlap is the failure this warning exists for: two boxes claiming the
 * same channels makes both wrong, and the schematic shows a confident,
 * incorrect answer for every socket on either.
 *
 * `excluding` is the device being edited, so a box never reports colliding
 * with itself.
 */
export function aes50Collision(
  installation: Installation,
  bus: Aes50Bus,
  offset: number,
  inputs: number,
  excluding?: DeviceId,
): Device | null {
  const range = aes50RangeFor(offset, inputs);
  if (range === null) return null;

  for (const device of installation.devices) {
    if (device.id === excluding) continue;
    if (device.aes50 === undefined || device.aes50.bus !== bus) continue;

    const other = aes50RangeFor(device.aes50.offset, device.inputs);
    if (other === null) continue;
    if (range.first <= other.last && other.first <= range.last) return device;
  }
  return null;
}

/**
 * "presents Out 1–8 on its XLR outs 1–8" — which console Out slots the box
 * carries, and where they land on its own connectors.
 *
 * This is the hop OSC cannot see (docs/venue-betania.md): the block is
 * selected on the box itself, so the only way to be sure is to read the
 * switch. Saying it in both vocabularies at once is what lets someone check
 * the screen against the hardware in front of them.
 */
export function describeOutputBlock(start: number, outputs: number): string | null {
  if (!Number.isInteger(start) || start < 1) return null;
  if (!Number.isInteger(outputs) || outputs < 1) return null;
  const last = start + outputs - 1;
  return `presents Out ${start}–${last} on its own outs 1–${outputs}`;
}

/** Whether the block would run past the console's last Out slot. */
export function outputBlockOverruns(start: number, outputs: number): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(outputs)) return false;
  return start + outputs - 1 > MIXER_OUTPUT_COUNT;
}

export interface RemovalConsequences {
  /** Cables that will go with the device. */
  readonly cables: number;
  /** Sockets elsewhere that fed it and will stop reaching anything. */
  readonly strandedSockets: number;
  /** Destinations that will lose their feed. */
  readonly strandedDestinations: string[];
}

/**
 * What removing a device actually costs, counted from the installation.
 *
 * Removing a stagebox is not like removing a speaker: every panel socket that
 * fed it stops reaching the console, and every destination it fed goes
 * silent. Those are the sentences the confirmation needs, and counting them
 * here keeps the component free of topology walking.
 */
export function removalConsequences(
  installation: Installation,
  device: DeviceId,
): RemovalConsequences {
  let cables = 0;
  let strandedSockets = 0;
  const strandedDestinations: string[] = [];

  const labelOf = (id: DeviceId): string =>
    installation.devices.find((candidate) => candidate.id === id)?.label ?? id;

  for (const connection of installation.connections) {
    const from = connection.from;
    const to = connection.to;
    const fromDevice = "device" in from ? from.device : undefined;
    const toDevice = "device" in to ? to.device : undefined;
    if (fromDevice !== device && toDevice !== device) continue;

    cables += 1;
    // A socket on *another* device that fed this one is now going nowhere.
    if (toDevice === device && fromDevice !== undefined && fromDevice !== device) {
      strandedSockets += 1;
    }
    if (to.kind === "destination" && toDevice !== device) {
      strandedDestinations.push(labelOf(to.device));
    }
  }

  return { cables, strandedSockets, strandedDestinations };
}

/** The confirmation sentence, in the installation's terms rather than the schema's. */
export function describeRemoval(
  installation: Installation,
  device: DeviceId,
): string {
  const target = installation.devices.find((candidate) => candidate.id === device);
  const label = target?.label ?? device;
  const { cables, strandedSockets, strandedDestinations } = removalConsequences(
    installation,
    device,
  );

  if (cables === 0) return `Remove ${label}? Nothing is cabled to it.`;

  const parts: string[] = [`${cables} ${cables === 1 ? "cable" : "cables"} will be removed`];
  if (strandedSockets > 0) {
    parts.push(
      `${strandedSockets} ${strandedSockets === 1 ? "socket" : "sockets"} will stop reaching the console`,
    );
  }
  if (strandedDestinations.length > 0) {
    parts.push(`${strandedDestinations.join(", ")} will lose ${strandedDestinations.length === 1 ? "its" : "their"} feed`);
  }
  return `Remove ${label}? ${parts.join("; ")}.`;
}
