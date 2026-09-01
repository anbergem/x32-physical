/**
 * Cabling rules, as the interface needs them (issue #28).
 *
 * **Why this exists at all.** `validateInstallation` already rejects every
 * illegal cable, and the write pipeline already refuses to write one. That is
 * the safety net. This module is the *guardrail*: it answers "may this cable
 * be drawn?" **before** the operator draws it, so an illegal target can be
 * rendered visibly unavailable instead of accepted-then-refused. Making
 * invalid states unreachable rather than merely rejected is the main reason
 * to build an editor instead of handing someone a spreadsheet.
 *
 * The rules here are deliberately the *same* rules the domain enforces, read
 * from the same installation — never a second, drifting copy of the schema.
 * If the two ever disagree, the pipeline wins and the operator sees a
 * rejection; that is the failure mode this arrangement is designed to have.
 */

import type { Device, DeviceId, EndpointId, Installation } from "@x32/domain";
import type { EndpointRef } from "@x32/domain";
import { parseEndpointId } from "@x32/domain";
import type { ConnectionEnd } from "@x32/installation";

/** Why a candidate target cannot take the cable in flight, or `null` if it can. */
export type CableTargetRefusal =
  | "wrong-kind"
  | "already-fed"
  | "annotated"
  | "same-endpoint";

export interface CableTargetStatus {
  readonly available: boolean;
  readonly refusal: CableTargetRefusal | null;
  /** Operator-facing, in terms of the installation rather than the schema. */
  readonly reason: string | null;
}

const AVAILABLE: CableTargetStatus = { available: true, refusal: null, reason: null };

function refuse(refusal: CableTargetRefusal, reason: string): CableTargetStatus {
  return { available: false, refusal, reason };
}

function deviceOf(installation: Installation, id: DeviceId): Device | undefined {
  return installation.devices.find((device) => device.id === id);
}

function endEquals(a: ConnectionEnd, b: ConnectionEnd): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "socket":
      return b.kind === "socket" && a.device === b.device && a.input === b.input;
    case "device-output":
      return b.kind === "device-output" && a.device === b.device && a.output === b.output;
    case "console-output":
      return b.kind === "console-output" && a.output === b.output;
    case "destination":
      return b.kind === "destination" && a.device === b.device;
  }
}

/** Whether `device` carries an annotation on `input` — annotated and cabled are exclusive. */
function isAnnotated(installation: Installation, device: DeviceId, input: number): boolean {
  return (
    deviceOf(installation, device)?.sockets?.some(
      (annotation) => annotation.input === input,
    ) ?? false
  );
}

/**
 * Whether a stagebox input already has something feeding it.
 *
 * The domain allows exactly one source per stagebox input, which is the rule
 * an operator most often trips over: the socket looks free on the schematic
 * because its *own* panel is elsewhere on screen.
 */
function stageboxInputFed(
  installation: Installation,
  device: DeviceId,
  input: number,
): boolean {
  return installation.connections.some(
    (connection) =>
      connection.to.kind === "stagebox-input" &&
      connection.to.device === device &&
      connection.to.input === input,
  );
}

/**
 * May the cable that started at `from` land on `candidate`?
 *
 * Direction matters: the input side runs panel socket → stagebox input, and
 * the output side runs a physical or console output → destination. Anything
 * else is `wrong-kind`, which is what keeps the interface from offering, say,
 * a stagebox input as the target of a console output.
 */
export function cableTargetStatus(
  installation: Installation,
  from: ConnectionEnd,
  candidate: ConnectionEnd,
): CableTargetStatus {
  if (endEquals(from, candidate)) {
    return refuse("same-endpoint", "This is the socket the cable starts from.");
  }

  // Output side: an output feeds a destination, and nothing else.
  if (from.kind === "device-output" || from.kind === "console-output") {
    if (candidate.kind !== "destination") {
      return refuse("wrong-kind", "A console or stagebox output feeds a destination.");
    }
    return AVAILABLE;
  }

  // Input side. The domain permits exactly two shapes here (validation.ts's
  // CONNECTION_PAIRS): panel-input → stagebox-input, and panel-input →
  // local-input. So the *source* must be a passive panel — a stagebox input
  // or a console local input is a destination for signal, never a source of
  // it, and offering one would produce a cable the pipeline then refuses.
  if (from.kind === "socket") {
    if (deviceOf(installation, from.device)?.kind !== "passive-panel") {
      return refuse("wrong-kind", "Only a panel socket can feed another socket.");
    }
    if (candidate.kind !== "socket") {
      return refuse("wrong-kind", "A panel socket feeds a stagebox or console input.");
    }
    const target = deviceOf(installation, candidate.device);
    if (target?.kind !== "stagebox" && target?.kind !== "console") {
      return refuse(
        "wrong-kind",
        "A panel socket feeds a stagebox input or a console input.",
      );
    }
    if (isAnnotated(installation, candidate.device, candidate.input)) {
      return refuse(
        "annotated",
        `${target.label} input ${candidate.input} is marked broken or unused — clear the annotation first.`,
      );
    }
    if (stageboxInputFed(installation, candidate.device, candidate.input)) {
      return refuse(
        "already-fed",
        `${target.label} input ${candidate.input} already has a source.`,
      );
    }
    return AVAILABLE;
  }

  return refuse("wrong-kind", "A destination cannot be the start of a cable.");
}

/**
 * May a cable *start* here? A socket that carries an annotation may not, which
 * is why the UI never offers to cable one — the exclusivity rule is taught by
 * the absence of the affordance rather than by a rejection afterwards.
 */
export function canStartCable(
  installation: Installation,
  end: ConnectionEnd,
): CableTargetStatus {
  if (end.kind === "socket") {
    // Mirrors the domain's CONNECTION_PAIRS: only a passive panel's socket is
    // ever the *source* of a cable. A stagebox input and a console input both
    // receive signal, so offering "cable from here" on one would invite an
    // edit the pipeline is bound to refuse.
    if (deviceOf(installation, end.device)?.kind !== "passive-panel") {
      return refuse("wrong-kind", "This socket receives signal; it cannot feed another.");
    }
    if (isAnnotated(installation, end.device, end.input)) {
      return refuse(
        "annotated",
        "This socket is marked broken or unused — clear the annotation before cabling it.",
      );
    }
  }
  return AVAILABLE;
}

/**
 * What removing this cable costs, phrased for a technician: what the
 * installation will no longer do, not "connection removed".
 */
export function describeUncableConsequence(
  installation: Installation,
  from: ConnectionEnd,
  to: ConnectionEnd,
): string {
  const label = (id: DeviceId): string => deviceOf(installation, id)?.label ?? id;

  if (from.kind === "socket" && to.kind === "socket") {
    return `${label(to.device)} input ${to.input} will have no source.`;
  }
  if (to.kind === "destination") {
    return `${label(to.device)} will have no feed.`;
  }
  return "This cable will be removed.";
}

/**
 * The cable end an on-screen endpoint represents, or `null` for endpoints
 * that are not cabling handles at all.
 *
 * AES50 channels and mixer channels/outputs are *derived* positions in the
 * signal path, not cables anyone patches — `deriveStaticEdges` computes them
 * from `aes50.offset` and `outputBlock.start`, and `installation.yaml` must
 * never record them (CLAUDE.md invariant 6's sibling rule). Returning `null`
 * for those is what stops the editor from offering to "cable" something the
 * domain derives.
 */
export function cableEndForEndpoint(endpoint: EndpointId): ConnectionEnd | null {
  return cableEndForRef(parseEndpointId(endpoint));
}

/** The `EndpointRef` form of the same mapping, for walking `installation.connections`. */
export function cableEndForRef(ref: EndpointRef): ConnectionEnd | null {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
    case "local-input":
      return { kind: "socket", device: ref.device, input: ref.input };
    case "stagebox-output":
      return { kind: "device-output", device: ref.device, output: ref.output };
    case "console-output":
      return { kind: "console-output", output: ref.output };
    case "destination":
      return { kind: "destination", device: ref.device };
    default:
      return null;
  }
}

/** How a socket should render while a cable is in flight (or not). */
export type CablingState = "idle" | "source" | "available" | "unavailable";

/**
 * What this endpoint is, relative to the cable currently being drawn.
 *
 * `"idle"` when nothing is in flight — the schematic looks normal. Otherwise
 * every endpoint reports whether it could take the cable, which is what lets
 * the UI grey out the illegal ones rather than let the operator find out by
 * being refused.
 *
 * Returns a **primitive**, deliberately. Selectors feed
 * `useSyncExternalStore`, which compares results by identity: a selector that
 * built a fresh `{state, reason}` object per call would report a change on
 * every render and spin the app into an update loop. The codebase's
 * "primitive per endpoint" rule exists for exactly this reason — see
 * `selectHoverStatus`. The human-readable reason is looked up separately, by
 * the one component that needs it, from values that are already stable.
 */
export function cablingStateFor(
  installation: Installation,
  cablingFrom: ConnectionEnd | null,
  endpoint: EndpointId,
): CablingState {
  if (cablingFrom === null) return "idle";

  const end = cableEndForEndpoint(endpoint);
  if (end === null) return "unavailable";
  if (endEquals(cablingFrom, end)) return "source";

  return cableTargetStatus(installation, cablingFrom, end).available
    ? "available"
    : "unavailable";
}

/** Why this endpoint cannot take the cable in flight, for a tooltip. */
export function cablingReasonFor(
  installation: Installation,
  cablingFrom: ConnectionEnd | null,
  endpoint: EndpointId,
): string | null {
  if (cablingFrom === null) return null;
  const end = cableEndForEndpoint(endpoint);
  if (end === null) return null;
  return cableTargetStatus(installation, cablingFrom, end).reason;
}

/** Every cable touching a socket — a pure walk, called from a `useMemo`, never from JSX. */
export function cablesTouchingSocket(
  installation: Installation,
  device: DeviceId,
  input: number,
): { from: ConnectionEnd; to: ConnectionEnd }[] {
  return cablesMatching(
    installation,
    (from, to) =>
      (from.kind === "socket" && from.device === device && from.input === input) ||
      (to.kind === "socket" && to.device === device && to.input === input),
  );
}

/** Every cable feeding a destination. */
export function cablesTouchingDestination(
  installation: Installation,
  device: DeviceId,
): { from: ConnectionEnd; to: ConnectionEnd }[] {
  return cablesMatching(
    installation,
    (_from, to) => to.kind === "destination" && to.device === device,
  );
}

function cablesMatching(
  installation: Installation,
  predicate: (from: ConnectionEnd, to: ConnectionEnd) => boolean,
): { from: ConnectionEnd; to: ConnectionEnd }[] {
  const matches: { from: ConnectionEnd; to: ConnectionEnd }[] = [];
  for (const connection of installation.connections) {
    const from = cableEndForRef(connection.from);
    const to = cableEndForRef(connection.to);
    if (from === null || to === null) continue;
    if (predicate(from, to)) matches.push({ from, to });
  }
  return matches;
}
