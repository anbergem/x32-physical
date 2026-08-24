/**
 * Inbound-message guards (architecture.md §7).
 *
 * Both ends of the bridge parse what the wire hands them before trusting it:
 * the web app validates `ServerMessage`s from the bridge, the bridge
 * validates `ClientMessage`s from the web app. A malformed payload throws a
 * descriptive `Error` — callers catch it and ignore the one bad message
 * rather than crash (a stray or out-of-date client must not take the whole
 * pipe down).
 *
 * Channel ids are re-branded through `mixerChannelId`, the sanctioned domain
 * constructor: an out-of-range channel is rejected here, before it can reach
 * a `RouteIndex` lookup downstream.
 */

import type {
  Aes50Bus,
  MixerChannelId,
  MixerChannelState,
  MixerSourceRef,
} from "@x32/domain";
import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import type {
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";

import type { ClientMessage, ServerMessage } from "./messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function malformed(context: string, expected: string, value: unknown): Error {
  return new Error(
    `Malformed ${context}: expected ${expected}, got ${describe(value)}.`,
  );
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") throw malformed(context, "a string", value);
  return value;
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw malformed(context, "a number", value);
  }
  return value;
}

function parseChannelId(value: unknown, context: string): MixerChannelId {
  const raw = requireNumber(value, context);
  try {
    return mixerChannelId(raw);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Malformed ${context}: ${reason}`, { cause });
  }
}

const CONNECTION_STATES: ReadonlySet<string> = new Set<MixerConnectionState>([
  "connecting",
  "connected",
  "disconnected",
]);

function parseConnectionState(
  value: unknown,
  context: string,
): MixerConnectionState {
  const state = requireString(value, context);
  if (!CONNECTION_STATES.has(state)) {
    throw malformed(
      context,
      '"connecting" | "connected" | "disconnected"',
      value,
    );
  }
  return state as MixerConnectionState;
}

const AES50_BUSES: ReadonlySet<string> = new Set<Aes50Bus>(["A", "B"]);
const USB_SIDES = new Set(["L", "R"]);
const TALKBACK_SIDES = new Set(["int", "ext"]);

function parseMixerSourceRef(value: unknown, context: string): MixerSourceRef {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw malformed(context, 'a mixer source ref object with a "kind"', value);
  }

  switch (value.kind) {
    case "aes50": {
      const bus = value.bus;
      if (typeof bus !== "string" || !AES50_BUSES.has(bus)) {
        throw malformed(`${context}.bus`, '"A" | "B"', bus);
      }
      return {
        kind: "aes50",
        bus: bus as Aes50Bus,
        channel: requireNumber(value.channel, `${context}.channel`),
      };
    }
    case "local":
      return { kind: "local", input: requireNumber(value.input, `${context}.input`) };
    case "card":
      return { kind: "card", input: requireNumber(value.input, `${context}.input`) };
    case "aux":
      return { kind: "aux", input: requireNumber(value.input, `${context}.input`) };
    case "usb": {
      const side = value.side;
      if (typeof side !== "string" || !USB_SIDES.has(side)) {
        throw malformed(`${context}.side`, '"L" | "R"', side);
      }
      return { kind: "usb", side: side as "L" | "R" };
    }
    case "fx":
      return { kind: "fx", ret: requireNumber(value.ret, `${context}.ret`) };
    case "bus":
      return { kind: "bus", bus: requireNumber(value.bus, `${context}.bus`) };
    case "talkback": {
      const which = value.which;
      if (typeof which !== "string" || !TALKBACK_SIDES.has(which)) {
        throw malformed(`${context}.which`, '"int" | "ext"', which);
      }
      return { kind: "talkback", which: which as "int" | "ext" };
    }
    case "off":
      return { kind: "off" };
    default:
      throw malformed(`${context}.kind`, "a known mixer source kind", value.kind);
  }
}

function parseMixerChannelState(
  value: unknown,
  context: string,
): MixerChannelState {
  if (!isRecord(value)) {
    throw malformed(context, "a mixer channel state object", value);
  }
  return {
    channel: parseChannelId(value.channel, `${context}.channel`),
    name: requireString(value.name, `${context}.name`),
    source: parseMixerSourceRef(value.source, `${context}.source`),
  };
}

/**
 * Validates a plain `MixerSnapshot` object. Exported (not just used
 * internally by the message guards) because the bridge's `DiskBaselineStore`
 * and the web app's `LocalStorageBaselineStore` reuse it to tolerate a
 * corrupt persisted baseline file/localStorage entry — same "never crash on
 * malformed input" discipline, applied to disk instead of the wire.
 */
export function parseMixerSnapshot(value: unknown, context: string): MixerSnapshot {
  if (!isRecord(value)) {
    throw malformed(context, "a mixer snapshot object", value);
  }
  if (!Array.isArray(value.channels)) {
    throw malformed(`${context}.channels`, "an array", value.channels);
  }

  const channels = value.channels.map((channel, index) =>
    parseMixerChannelState(channel, `${context}.channels[${index}]`),
  );

  const rawSelected = value.selectedChannel;
  const selectedChannel =
    rawSelected === null
      ? null
      : parseChannelId(rawSelected, `${context}.selectedChannel`);

  return { channels, selectedChannel };
}

function parseMixerEvent(value: unknown, context: string): MixerEvent {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw malformed(context, 'a mixer event object with a "type"', value);
  }

  switch (value.type) {
    case "selected-channel-changed": {
      const rawChannel = value.channel;
      return {
        type: "selected-channel-changed",
        channel:
          rawChannel === null
            ? null
            : parseChannelId(rawChannel, `${context}.channel`),
      };
    }
    case "channel-name-changed":
      return {
        type: "channel-name-changed",
        channel: parseChannelId(value.channel, `${context}.channel`),
        name: requireString(value.name, `${context}.name`),
      };
    case "channel-source-changed":
      return {
        type: "channel-source-changed",
        channel: parseChannelId(value.channel, `${context}.channel`),
        source: parseMixerSourceRef(value.source, `${context}.source`),
      };
    case "connection-state-changed":
      return {
        type: "connection-state-changed",
        state: parseConnectionState(value.state, `${context}.state`),
      };
    default:
      throw malformed(`${context}.type`, "a known mixer event type", value.type);
  }
}

function parseNullableBaseline(value: unknown, context: string): MixerSnapshot | null {
  return value === null ? null : parseMixerSnapshot(value, context);
}

/** `meters` messages (step 15): always exactly `MIXER_CHANNEL_COUNT` finite numbers. */
function parseMeterLevels(value: unknown, context: string): number[] {
  if (!Array.isArray(value)) {
    throw malformed(context, "an array", value);
  }
  if (value.length !== MIXER_CHANNEL_COUNT) {
    throw malformed(
      context,
      `an array of exactly ${MIXER_CHANNEL_COUNT} numbers`,
      value,
    );
  }
  return value.map((level, index) => requireNumber(level, `${context}[${index}]`));
}

/** Validates a `ServerMessage` decoded from `JSON.parse`d WebSocket data. */
export function parseServerMessage(value: unknown): ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw malformed("server message", 'an object with a "type"', value);
  }

  switch (value.type) {
    case "snapshot":
      return {
        type: "snapshot",
        snapshot: parseMixerSnapshot(value.snapshot, "server message.snapshot"),
        mixerConnection: parseConnectionState(
          value.mixerConnection,
          "server message.mixerConnection",
        ),
        baseline: parseNullableBaseline(value.baseline, "server message.baseline"),
      };
    case "event":
      return {
        type: "event",
        event: parseMixerEvent(value.event, "server message.event"),
      };
    case "baseline-changed":
      return {
        type: "baseline-changed",
        baseline: parseMixerSnapshot(value.baseline, "server message.baseline"),
      };
    case "baseline-save-rejected":
      return {
        type: "baseline-save-rejected",
        reason: requireString(value.reason, "server message.reason"),
      };
    case "meters":
      return {
        type: "meters",
        levels: parseMeterLevels(value.levels, "server message.levels"),
      };
    default:
      throw malformed(
        "server message.type",
        '"snapshot" | "event" | "baseline-changed" | "baseline-save-rejected" | "meters"',
        value.type,
      );
  }
}

/** Validates a `ClientMessage` decoded from `JSON.parse`d WebSocket data. */
export function parseClientMessage(value: unknown): ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw malformed("client message", 'an object with a "type"', value);
  }
  switch (value.type) {
    case "resync":
      return { type: "resync" };
    case "save-baseline":
      return { type: "save-baseline" };
    default:
      throw malformed("client message.type", '"resync" | "save-baseline"', value.type);
  }
}
