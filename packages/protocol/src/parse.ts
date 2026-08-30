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
  Aes50Chain,
  Aes50ChainBox,
  Aes50LinkState,
  MixerChannelId,
  MixerChannelState,
  MixerOutputSourceRef,
  MixerOutputState,
  MixerSourceMeterLevels,
  MixerSourceRef,
} from "@x32/domain";
import { MIXER_CHANNEL_COUNT, MIXER_OUTPUT_COUNT, mixerChannelId } from "@x32/domain";
import type { InstallationOperation } from "@x32/installation";
import { parseInstallationOperation } from "@x32/installation";
import type {
  MixerConnectionState,
  MixerEvent,
  MixerSnapshot,
} from "@x32/mixer-contracts";

import type { ClientMessage, ServerMessage, UpdateAvailable } from "./messages";

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

/**
 * `null`/absent both mean "no value" — absent is tolerated, like
 * `updateAvailable`, so a `snapshot` from a bridge that predates the field
 * still parses; only a present, non-string value is an error.
 */
function parseNullableString(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, context);
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

const MAIN_SIDES = new Set(["L", "R", "C"]);
const MONITOR_SIDES = new Set(["L", "R"]);

/** A console Out slot number (1–16, issue #11) — the output-side mirror of `parseChannelId`. */
function parseOutputNumber(value: unknown, context: string): number {
  const raw = requireNumber(value, context);
  if (!Number.isInteger(raw) || raw < 1 || raw > MIXER_OUTPUT_COUNT) {
    throw malformed(
      context,
      `an integer between 1 and ${MIXER_OUTPUT_COUNT}`,
      value,
    );
  }
  return raw;
}

/**
 * `MixerOutputSourceRef` (issue #11) — the output-side mirror of
 * `parseMixerSourceRef`, deliberately its own function since the two unions
 * are not related (architecture.md §3).
 */
function parseMixerOutputSourceRef(
  value: unknown,
  context: string,
): MixerOutputSourceRef {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw malformed(context, 'a mixer output source ref object with a "kind"', value);
  }

  switch (value.kind) {
    case "main": {
      const side = value.side;
      if (typeof side !== "string" || !MAIN_SIDES.has(side)) {
        throw malformed(`${context}.side`, '"L" | "R" | "C"', side);
      }
      return { kind: "main", side: side as "L" | "R" | "C" };
    }
    case "bus":
      return { kind: "bus", bus: requireNumber(value.bus, `${context}.bus`) };
    case "matrix":
      return { kind: "matrix", matrix: requireNumber(value.matrix, `${context}.matrix`) };
    case "direct-out-channel":
      return {
        kind: "direct-out-channel",
        channel: parseChannelId(value.channel, `${context}.channel`),
      };
    case "direct-out-aux":
      return { kind: "direct-out-aux", aux: requireNumber(value.aux, `${context}.aux`) };
    case "direct-out-fx":
      return { kind: "direct-out-fx", ret: requireNumber(value.ret, `${context}.ret`) };
    case "monitor": {
      const side = value.side;
      if (typeof side !== "string" || !MONITOR_SIDES.has(side)) {
        throw malformed(`${context}.side`, '"L" | "R"', side);
      }
      return { kind: "monitor", side: side as "L" | "R" };
    }
    case "talkback":
      return { kind: "talkback" };
    case "off":
      return { kind: "off" };
    default:
      throw malformed(`${context}.kind`, "a known mixer output source kind", value.kind);
  }
}

function parseMixerOutputState(value: unknown, context: string): MixerOutputState {
  if (!isRecord(value)) {
    throw malformed(context, "a mixer output state object", value);
  }
  const rawName = value.name;
  if (rawName !== undefined && typeof rawName !== "string") {
    throw malformed(`${context}.name`, "a string or undefined", rawName);
  }
  return {
    output: parseOutputNumber(value.output, `${context}.output`),
    name: rawName,
    source: parseMixerOutputSourceRef(value.source, `${context}.source`),
  };
}

/**
 * Absent/undefined means "no output data yet" (issue #11) — tolerated, like
 * `updateAvailable`, so a snapshot from a peer that predates this field still
 * parses. Unlike `aes50Chain` (normalized to `[]`), `undefined` is preserved
 * rather than coerced, matching the field's own optionality on `MixerSnapshot`.
 */
/**
 * `MixerSnapshot.outputs` is a required field (issue #31) and is required on
 * the wire and on disk too: an absent `outputs` is an error, not an empty
 * list. Backward compatibility with baselines written before the field
 * existed was explicitly waived by the project owner (2026-08-30) — such a
 * baseline is now rejected on load and simply re-blessed with "Save as
 * correct". Silently substituting `[]` would be worse than failing: it would
 * present a baseline that claims every output is unrouted, and every real
 * output would then read as a deviation.
 */
function parseMixerOutputList(
  value: unknown,
  context: string,
): MixerOutputState[] {
  if (!Array.isArray(value)) throw malformed(context, "an array", value);
  return value.map((output, index) => parseMixerOutputState(output, `${context}[${index}]`));
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw malformed(context, "a boolean", value);
  return value;
}

function parseAes50Bus(value: unknown, context: string): Aes50Bus {
  if (typeof value !== "string" || !AES50_BUSES.has(value)) {
    throw malformed(context, '"A" | "B"', value);
  }
  return value as Aes50Bus;
}

/** `/-stat/aes50/state`, decoded (issue #17). `null` means "not read yet" — never a guess at "healthy". */
function parseAes50LinkState(value: unknown, context: string): Aes50LinkState {
  if (!isRecord(value)) {
    throw malformed(context, "an AES50 link state object", value);
  }
  if (!Array.isArray(value.buses)) {
    throw malformed(`${context}.buses`, "an array", value.buses);
  }
  const buses = value.buses.map((busState, index) => {
    const busContext = `${context}.buses[${index}]`;
    if (!isRecord(busState)) throw malformed(busContext, "an AES50 bus link state object", busState);
    return {
      bus: parseAes50Bus(busState.bus, `${busContext}.bus`),
      audioError: requireBoolean(busState.audioError, `${busContext}.audioError`),
      auxError: requireBoolean(busState.auxError, `${busContext}.auxError`),
    };
  });
  return { buses, locked: requireBoolean(value.locked, `${context}.locked`) };
}

function parseNullableAes50LinkState(value: unknown, context: string): Aes50LinkState | null {
  return value === null || value === undefined ? null : parseAes50LinkState(value, context);
}

function parseAes50ChainBox(value: unknown, context: string): Aes50ChainBox {
  if (!isRecord(value)) {
    throw malformed(context, "an AES50 chain box object", value);
  }
  const rawModel = value.model;
  if (rawModel !== null && typeof rawModel !== "string") {
    throw malformed(`${context}.model`, "a string or null", rawModel);
  }
  return {
    position: requireNumber(value.position, `${context}.position`),
    model: rawModel,
    rawLetter: requireString(value.rawLetter, `${context}.rawLetter`),
  };
}

function parseAes50Chain(value: unknown, context: string): Aes50Chain {
  if (!isRecord(value)) {
    throw malformed(context, "an AES50 chain object", value);
  }
  if (!Array.isArray(value.boxes)) {
    throw malformed(`${context}.boxes`, "an array", value.boxes);
  }
  return {
    bus: parseAes50Bus(value.bus, `${context}.bus`),
    boxes: value.boxes.map((box, index) => parseAes50ChainBox(box, `${context}.boxes[${index}]`)),
  };
}

/** Absent/undefined means "no chain data yet" — tolerated so an older snapshot still parses. */
function parseAes50ChainList(value: unknown, context: string): Aes50Chain[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformed(context, "an array", value);
  return value.map((chain, index) => parseAes50Chain(chain, `${context}[${index}]`));
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

  const outputs = parseMixerOutputList(value.outputs, `${context}.outputs`);

  const rawSelected = value.selectedChannel;
  const selectedChannel =
    rawSelected === null
      ? null
      : parseChannelId(rawSelected, `${context}.selectedChannel`);

  const aes50LinkState = parseNullableAes50LinkState(
    value.aes50LinkState,
    `${context}.aes50LinkState`,
  );
  const aes50Chain = parseAes50ChainList(value.aes50Chain, `${context}.aes50Chain`);

  return { channels, outputs, selectedChannel, aes50LinkState, aes50Chain };
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
    case "output-source-changed":
      return {
        type: "output-source-changed",
        output: parseOutputNumber(value.output, `${context}.output`),
        source: parseMixerOutputSourceRef(value.source, `${context}.source`),
      };
    case "connection-state-changed":
      return {
        type: "connection-state-changed",
        state: parseConnectionState(value.state, `${context}.state`),
      };
    case "aes50-link-state-changed":
      return {
        type: "aes50-link-state-changed",
        state: parseAes50LinkState(value.state, `${context}.state`),
      };
    case "aes50-chain-changed":
      return {
        type: "aes50-chain-changed",
        chain: parseAes50Chain(value.chain, `${context}.chain`),
      };
    default:
      throw malformed(`${context}.type`, "a known mixer event type", value.type);
  }
}

function parseNullableBaseline(value: unknown, context: string): MixerSnapshot | null {
  return value === null ? null : parseMixerSnapshot(value, context);
}

/**
 * `updateAvailable`/`update-available` payloads (step 20). `url` must be an
 * `https://` string — anything else (a `javascript:`/`data:` URL, a bare
 * hostname, a non-string) is rejected here, before it can ever reach a
 * rendered link, rather than sanitized downstream.
 */
function parseUpdateAvailable(value: unknown, context: string): UpdateAvailable {
  if (!isRecord(value)) {
    throw malformed(context, "an update-available object", value);
  }
  const version = requireString(value.version, `${context}.version`);
  const url = requireString(value.url, `${context}.url`);
  if (!url.startsWith("https://")) {
    throw malformed(`${context}.url`, "an https:// URL", url);
  }
  return { version, url };
}

/**
 * `null`/absent both mean "no update" — absent is tolerated (rather than
 * rejected as malformed) so a `snapshot` message from a bridge that predates
 * this field still parses; only a *present but invalid* value is an error.
 */
function parseNullableUpdateAvailable(
  value: unknown,
  context: string,
): UpdateAvailable | null {
  return value === null || value === undefined
    ? null
    : parseUpdateAvailable(value, context);
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

/**
 * `source-meters` messages (issue #36): exactly 16 bus and 6 matrix levels.
 *
 * Both lengths are fixed by the console's own strip layout, so a short or
 * long array means the sender's idea of the layout differs from ours — and
 * silently accepting it would put a meter beside the wrong speaker. Reject
 * instead; the UI then shows no meter, which is the honest outcome.
 */
function parseSourceMeterLevels(value: unknown, context: string): MixerSourceMeterLevels {
  if (!isRecord(value)) throw malformed(context, "an object", value);

  const list = (raw: unknown, expected: number, name: string): number[] => {
    if (!Array.isArray(raw)) throw malformed(`${context}.${name}`, "an array", raw);
    if (raw.length !== expected) {
      throw malformed(`${context}.${name}`, `an array of exactly ${expected} numbers`, raw);
    }
    return raw.map((level, index) => requireNumber(level, `${context}.${name}[${index}]`));
  };

  return {
    buses: list(value.buses, 16, "buses"),
    matrices: list(value.matrices, 6, "matrices"),
  };
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
        updateAvailable: parseNullableUpdateAvailable(
          value.updateAvailable,
          "server message.updateAvailable",
        ),
        installationVersion: parseNullableString(
          value.installationVersion,
          "server message.installationVersion",
        ),
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
    case "source-meters":
      return {
        type: "source-meters",
        levels: parseSourceMeterLevels(value.levels, "server message.levels"),
      };
    case "update-available":
      return {
        type: "update-available",
        update: parseUpdateAvailable(value.update, "server message.update"),
      };
    case "installation-changed":
      return {
        type: "installation-changed",
        text: requireString(value.text, "server message.text"),
        version: requireString(value.version, "server message.version"),
      };
    case "installation-edit-rejected":
      return {
        type: "installation-edit-rejected",
        reason: requireString(value.reason, "server message.reason"),
      };
    default:
      throw malformed(
        "server message.type",
        '"snapshot" | "event" | "baseline-changed" | "baseline-save-rejected" | "meters" | "source-meters" | "update-available" | "installation-changed" | "installation-edit-rejected"',
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
    case "apply-installation-edit":
      return {
        type: "apply-installation-edit",
        baseVersion: requireString(value.baseVersion, "client message.baseVersion"),
        operation: parseOperation(value.operation, "client message.operation"),
      };
    default:
      throw malformed(
        "client message.type",
        '"resync" | "save-baseline" | "apply-installation-edit"',
        value.type,
      );
  }
}

/**
 * The operation guard lives in `@x32/installation` alongside the union it
 * validates, so a new operation kind is one file's worth of change and this
 * package needs no edit at all (issue #27). Its throws are re-labelled here so
 * every message-guard failure reads the same way to whoever is reading the
 * bridge log.
 */
function parseOperation(value: unknown, context: string): InstallationOperation {
  try {
    return parseInstallationOperation(value, context);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(reason, { cause });
  }
}
