/**
 * Endpoints of the static signal graph (architecture.md §3).
 *
 * Endpoints are structured objects internally; `EndpointId` is the canonical
 * string encoding used for map keys and wire transfer:
 *
 * ```text
 * panel:front-left:3        # physical panel socket
 * stagebox:stagebox-1:3     # stagebox input socket
 * aes50:A:19                # AES50 bus channel (bus-level, box-agnostic)
 * mixer:12                  # X32 input channel
 * ```
 */

import type { Aes50Bus, DeviceId, EndpointId, MixerChannelId } from "./ids";
import { AES50_CHANNEL_COUNT, aes50Bus, deviceId, mixerChannelId } from "./ids";

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

export type EndpointRef =
  | PanelInputRef
  | StageboxInputRef
  | Aes50ChannelRef
  | MixerChannelRef;

function socketNumber(input: number, kind: EndpointRef["kind"]): number {
  if (!Number.isInteger(input) || input < 1) {
    throw new Error(
      `Invalid ${kind} number ${input}: expected a positive integer (1-based).`,
    );
  }
  return input;
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

/** Canonical string encoding of an endpoint. Validates the ref it encodes. */
export function endpointId(ref: EndpointRef): EndpointId {
  switch (ref.kind) {
    case "panel-input":
      return `panel:${deviceId(ref.device)}:${socketNumber(ref.input, ref.kind)}` as EndpointId;
    case "stagebox-input":
      return `stagebox:${deviceId(ref.device)}:${socketNumber(ref.input, ref.kind)}` as EndpointId;
    case "aes50-channel":
      return `aes50:${aes50Bus(ref.bus)}:${aes50ChannelNumber(ref.channel)}` as EndpointId;
    case "mixer-channel":
      return `mixer:${mixerChannelId(ref.channel)}` as EndpointId;
  }
}

function malformed(value: string, expected: string): Error {
  return new Error(
    `Malformed endpoint id "${value}": expected the form "${expected}".`,
  );
}

function parseNumber(
  raw: string | undefined,
  value: string,
  expected: string,
): number {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) {
    throw malformed(value, expected);
  }
  return Number(raw);
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
    default:
      throw new Error(
        `Malformed endpoint id "${value}": unknown endpoint kind ` +
          `"${parts[0] ?? ""}" (expected panel, stagebox, aes50 or mixer).`,
      );
  }
}
