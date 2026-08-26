/**
 * Endpoints of the static signal graph (architecture.md §3).
 *
 * Endpoints are structured objects internally; `EndpointId` is the canonical
 * string encoding used for map keys and wire transfer:
 *
 * ```text
 * panel:front-left:3        # physical panel socket
 * stagebox:stagebox-1:3     # stagebox input socket
 * local:console:3           # console XLR local input socket
 * aes50:A:19                # AES50 bus channel (bus-level, box-agnostic)
 * mixer:12                  # X32 input channel
 * out:13                    # X32 output slot (console Out N)
 * console-out:1             # console XLR out socket
 * stagebox-out:stagebox-1:5 # stagebox XLR out socket
 * dest:main-left            # destination device (powered speaker/zone)
 * ```
 *
 * The input-side kinds (`panel-input`, `stagebox-input`, `local-input`,
 * `aes50-channel`, `mixer-channel`) and the output-side kinds (`mixer-output`,
 * `console-output`, `stagebox-output`, `destination`) are disjoint: an
 * `EndpointId` never means both an input and an output endpoint, and a single
 * `RouteIndex` or `OutputRouteIndex` only ever contains nodes of its own side
 * (architecture.md §3).
 */

import type { Aes50Bus, DeviceId, EndpointId, MixerChannelId } from "./ids";
import {
  AES50_CHANNEL_COUNT,
  MIXER_OUTPUT_COUNT,
  aes50Bus,
  deviceId,
  mixerChannelId,
} from "./ids";

export interface PanelInputRef {
  kind: "panel-input";
  device: DeviceId;
  input: number;
}

export interface StageboxInputRef {
  kind: "stagebox-input";
  device: DeviceId;
  input: number;
}

/**
 * A console XLR local input socket (IN 1–32 on the desk itself). Distinct
 * from `stagebox-input`: it belongs to the `console` device, not a stagebox,
 * and it never reaches an AES50 bus.
 */
export interface LocalInputRef {
  kind: "local-input";
  device: DeviceId;
  input: number;
}

/**
 * A channel on an AES50 bus. Deliberately distinct from `stagebox-input`: the
 * mixer only ever sees bus + channel; which physical box that channel belongs
 * to is a static topology fact (cascade offsets), expressed as graph edges.
 */
export interface Aes50ChannelRef {
  kind: "aes50-channel";
  bus: Aes50Bus;
  channel: number;
}

export interface MixerChannelRef {
  kind: "mixer-channel";
  channel: MixerChannelId;
}

/** An X32 output slot (console Out 1–16, `/outputs/main/[01…16]/src`). */
export interface MixerOutputRef {
  kind: "mixer-output";
  output: number;
}

/** A console XLR out socket. Identified by number alone — no console device. */
export interface ConsoleOutputRef {
  kind: "console-output";
  output: number;
}

/** A stagebox XLR out socket. */
export interface StageboxOutputRef {
  kind: "stagebox-output";
  device: DeviceId;
  output: number;
}

/**
 * A powered speaker or zone. The whole device *is* the endpoint — it has no
 * socket number, unlike every other endpoint kind.
 */
export interface DestinationRef {
  kind: "destination";
  device: DeviceId;
}

export type EndpointRef =
  | PanelInputRef
  | StageboxInputRef
  | LocalInputRef
  | Aes50ChannelRef
  | MixerChannelRef
  | MixerOutputRef
  | ConsoleOutputRef
  | StageboxOutputRef
  | DestinationRef;

function socketNumber(input: number, kind: EndpointRef["kind"]): number {
  if (!Number.isInteger(input) || input < 1) {
    throw new Error(
      `Invalid ${kind} number ${input}: expected a positive integer (1-based).`,
    );
  }
  return input;
}

function mixerOutputNumber(output: number, kind: EndpointRef["kind"]): number {
  if (
    !Number.isInteger(output) ||
    output < 1 ||
    output > MIXER_OUTPUT_COUNT
  ) {
    throw new Error(
      `Invalid ${kind} number ${output}: expected an integer between 1 and ` +
        `${MIXER_OUTPUT_COUNT} (1-based).`,
    );
  }
  return output;
}

function aes50ChannelNumber(channel: number): number {
  if (
    !Number.isInteger(channel) ||
    channel < 1 ||
    channel > AES50_CHANNEL_COUNT
  ) {
    throw new Error(
      `Invalid AES50 channel ${channel}: expected an integer between 1 and ` +
        `${AES50_CHANNEL_COUNT} (1-based).`,
    );
  }
  return channel;
}

export function panelInput(device: string, input: number): PanelInputRef {
  return {
    kind: "panel-input",
    device: deviceId(device),
    input: socketNumber(input, "panel-input"),
  };
}

export function stageboxInput(device: string, input: number): StageboxInputRef {
  return {
    kind: "stagebox-input",
    device: deviceId(device),
    input: socketNumber(input, "stagebox-input"),
  };
}

export function localInput(device: string, input: number): LocalInputRef {
  return {
    kind: "local-input",
    device: deviceId(device),
    input: socketNumber(input, "local-input"),
  };
}

export function aes50Channel(bus: string, channel: number): Aes50ChannelRef {
  return {
    kind: "aes50-channel",
    bus: aes50Bus(bus),
    channel: aes50ChannelNumber(channel),
  };
}

export function mixerChannel(channel: number): MixerChannelRef {
  return { kind: "mixer-channel", channel: mixerChannelId(channel) };
}

export function mixerOutput(output: number): MixerOutputRef {
  return {
    kind: "mixer-output",
    output: mixerOutputNumber(output, "mixer-output"),
  };
}

export function consoleOutput(output: number): ConsoleOutputRef {
  return {
    kind: "console-output",
    output: mixerOutputNumber(output, "console-output"),
  };
}

export function stageboxOutput(
  device: string,
  output: number,
): StageboxOutputRef {
  return {
    kind: "stagebox-output",
    device: deviceId(device),
    output: socketNumber(output, "stagebox-output"),
  };
}

export function destination(device: string): DestinationRef {
  return { kind: "destination", device: deviceId(device) };
}

/** Canonical string encoding of an endpoint. Validates the ref it encodes. */
export function endpointId(ref: EndpointRef): EndpointId {
  switch (ref.kind) {
    case "panel-input":
      return `panel:${deviceId(ref.device)}:${socketNumber(ref.input, ref.kind)}` as EndpointId;
    case "stagebox-input":
      return `stagebox:${deviceId(ref.device)}:${socketNumber(ref.input, ref.kind)}` as EndpointId;
    case "local-input":
      return `local:${deviceId(ref.device)}:${socketNumber(ref.input, ref.kind)}` as EndpointId;
    case "aes50-channel":
      return `aes50:${aes50Bus(ref.bus)}:${aes50ChannelNumber(ref.channel)}` as EndpointId;
    case "mixer-channel":
      return `mixer:${mixerChannelId(ref.channel)}` as EndpointId;
    case "mixer-output":
      return `out:${mixerOutputNumber(ref.output, ref.kind)}` as EndpointId;
    case "console-output":
      return `console-out:${mixerOutputNumber(ref.output, ref.kind)}` as EndpointId;
    case "stagebox-output":
      return `stagebox-out:${deviceId(ref.device)}:${socketNumber(ref.output, ref.kind)}` as EndpointId;
    case "destination":
      return `dest:${deviceId(ref.device)}` as EndpointId;
  }
}

/**
 * A route hands out only its own objects. Part of the graph is built from the
 * caller's `Installation`, and a consumer mutating a ref it got from a route
 * must not be able to corrupt the topology through it.
 */
export function cloneEndpoint(ref: EndpointRef): EndpointRef {
  switch (ref.kind) {
    case "panel-input":
      return { kind: ref.kind, device: ref.device, input: ref.input };
    case "stagebox-input":
      return { kind: ref.kind, device: ref.device, input: ref.input };
    case "local-input":
      return { kind: ref.kind, device: ref.device, input: ref.input };
    case "aes50-channel":
      return { kind: ref.kind, bus: ref.bus, channel: ref.channel };
    case "mixer-channel":
      return { kind: ref.kind, channel: ref.channel };
    case "mixer-output":
      return { kind: ref.kind, output: ref.output };
    case "console-output":
      return { kind: ref.kind, output: ref.output };
    case "stagebox-output":
      return { kind: ref.kind, device: ref.device, output: ref.output };
    case "destination":
      return { kind: ref.kind, device: ref.device };
  }
}

/** Upstream → downstream ordering of every endpoint kind, input and output. */
const KIND_ORDER: Record<EndpointRef["kind"], number> = {
  "panel-input": 0,
  "stagebox-input": 1,
  "local-input": 2,
  "aes50-channel": 3,
  "mixer-channel": 4,
  "mixer-output": 5,
  "console-output": 6,
  "stagebox-output": 7,
  destination: 8,
};

/** Device id or bus letter — whatever groups endpoints of one kind. */
function groupOf(ref: EndpointRef): string {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
    case "local-input":
    case "stagebox-output":
    case "destination":
      return ref.device;
    case "aes50-channel":
      return ref.bus;
    case "mixer-channel":
    case "mixer-output":
    case "console-output":
      return "";
  }
}

function numberOf(ref: EndpointRef): number {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
    case "local-input":
      return ref.input;
    case "aes50-channel":
    case "mixer-channel":
      return ref.channel;
    case "mixer-output":
    case "console-output":
    case "stagebox-output":
      return ref.output;
    case "destination":
      // No socket number: the device itself is the endpoint. Every
      // destination on one device already collides on `groupOf`, so this
      // constant never needs to disambiguate anything.
      return 0;
  }
}

/**
 * Total order over every endpoint kind (input and output alike): kind, then
 * device/bus, then socket number. Plain string comparison (not
 * `localeCompare`) so ordering cannot vary with the host locale — same
 * inputs must always give the same output. Shared by `routing.ts` and
 * `output-routing.ts` so both route graphs sort deterministically the same
 * way.
 */
export function compareEndpoints(a: EndpointRef, b: EndpointRef): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) return byKind;
  const groupA = groupOf(a);
  const groupB = groupOf(b);
  if (groupA !== groupB) return groupA < groupB ? -1 : 1;
  return numberOf(a) - numberOf(b);
}

function malformed(value: string, expected: string): Error {
  return new Error(
    `Malformed endpoint id "${value}": expected the form "${expected}".`,
  );
}

/**
 * Strictly canonical digits only: `endpointId` never emits a leading zero or a
 * value beyond exact integer precision, so neither may parse. Two spellings of
 * one endpoint would otherwise yield two `EndpointId` map keys.
 */
function parseNumber(
  raw: string | undefined,
  value: string,
  expected: string,
): number {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) {
    throw malformed(value, expected);
  }
  const parsed = Number(raw);
  if (String(parsed) !== raw) {
    throw malformed(value, expected);
  }
  return parsed;
}

/** Inverse of `endpointId`. Throws on anything it did not produce. */
export function parseEndpointId(value: string): EndpointRef {
  const parts = value.split(":");
  switch (parts[0]) {
    case "panel": {
      const expected = "panel:<device>:<input>";
      if (parts.length !== 3) throw malformed(value, expected);
      return panelInput(parts[1] ?? "", parseNumber(parts[2], value, expected));
    }
    case "stagebox": {
      const expected = "stagebox:<device>:<input>";
      if (parts.length !== 3) throw malformed(value, expected);
      return stageboxInput(
        parts[1] ?? "",
        parseNumber(parts[2], value, expected),
      );
    }
    case "local": {
      const expected = "local:<device>:<input>";
      if (parts.length !== 3) throw malformed(value, expected);
      return localInput(parts[1] ?? "", parseNumber(parts[2], value, expected));
    }
    case "aes50": {
      const expected = "aes50:<A|B>:<channel>";
      if (parts.length !== 3) throw malformed(value, expected);
      return aes50Channel(
        parts[1] ?? "",
        parseNumber(parts[2], value, expected),
      );
    }
    case "mixer": {
      const expected = "mixer:<channel>";
      if (parts.length !== 2) throw malformed(value, expected);
      return mixerChannel(parseNumber(parts[1], value, expected));
    }
    case "out": {
      const expected = "out:<output>";
      if (parts.length !== 2) throw malformed(value, expected);
      return mixerOutput(parseNumber(parts[1], value, expected));
    }
    case "console-out": {
      const expected = "console-out:<output>";
      if (parts.length !== 2) throw malformed(value, expected);
      return consoleOutput(parseNumber(parts[1], value, expected));
    }
    case "stagebox-out": {
      const expected = "stagebox-out:<device>:<output>";
      if (parts.length !== 3) throw malformed(value, expected);
      return stageboxOutput(
        parts[1] ?? "",
        parseNumber(parts[2], value, expected),
      );
    }
    case "dest": {
      const expected = "dest:<device>";
      if (parts.length !== 2) throw malformed(value, expected);
      return destination(parts[1] ?? "");
    }
    default:
      throw new Error(
        `Malformed endpoint id "${value}": unknown endpoint kind ` +
          `"${parts[0] ?? ""}" (expected panel, stagebox, local, aes50, mixer, ` +
          `out, console-out, stagebox-out or dest).`,
      );
  }
}
