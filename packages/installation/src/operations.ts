/**
 * Typed edit operations on an `installation.yaml` document (issue #27, epic
 * #25).
 *
 * **Why operations rather than whole-document writes.** Re-serialising a
 * parsed document loses every comment in it, and for this project the
 * comments are a substantial part of the file's value — they carry the
 * reasoning nobody's patch sheet records (`aes50.offset`, `outputBlock.start`
 * were reverse-engineered, and the file says so). A minimal typed operation
 * applied surgically to a `yaml` `Document` leaves the rest of the document —
 * comments, key order, quoting style, blank lines — exactly as the author
 * wrote it. `operations.test.ts` asserts that against the sample
 * installation, not a toy fixture.
 *
 * Operations also keep rejection messages specific, keep write conflicts
 * fine-grained, and grow *additively*: a new kind is a new union member, a
 * new `case` in `applyOperation`, and a new `case` in
 * `parseInstallationOperation` — all in this one file, with no protocol
 * change (the wire carries `InstallationOperation`, whatever it is today).
 *
 * Browser-safe, like the rest of this package's index entry point: the `yaml`
 * package works in a bundle, so the bridge and the web app apply the very
 * same code and can never disagree about what an operation means.
 *
 * What this module deliberately does **not** do is decide whether the
 * *result* is a valid installation. An individually sensible operation can
 * still leave the document invalid, so validation belongs to the pipeline
 * that owns the whole resulting document (`./edit.ts`), never here.
 */

import type { DeviceId } from "@x32/domain";
import { deviceId } from "@x32/domain";
import type { Document } from "yaml";
import { isScalar } from "yaml";

/** Rename a device — the label the schematic prints on its frame. */
export interface SetDeviceLabelOperation {
  readonly kind: "set-device-label";
  readonly device: DeviceId;
  readonly label: string;
}

/**
 * Set or clear a device's group — the named part of the installation it
 * belongs to ("Stage left", "Other"). A blank or whitespace-only group
 * *clears* it: `docs/installation.md` says an absent group is an ordinary
 * state, so the key is removed rather than left as `group: ""`, which would
 * read as a group whose name happens to be empty.
 */
export interface SetDeviceGroupOperation {
  readonly kind: "set-device-group";
  readonly device: DeviceId;
  readonly group: string;
}

/**
 * Annotate a socket as `broken` or `unused`, or clear the annotation with a
 * `null` status.
 *
 * Annotations are descriptive only — `buildRouteIndex` never branches on
 * them. They exist so a technician reading the schematic learns why a socket
 * is empty, which is the difference between "nothing patched here" and
 * "don't use this one".
 */
export interface SetSocketAnnotationOperation {
  readonly kind: "set-socket-annotation";
  readonly device: DeviceId;
  /** 1-based socket number on the owning device. */
  readonly input: number;
  /** `null` clears the annotation entirely. */
  readonly status: "broken" | "unused" | null;
  /** Free-text detail; omitted or blank removes any existing note. */
  readonly note?: string;
}

/**
 * One end of a cable, in the four shapes `installation.yaml` records.
 *
 * Kept as an explicit discriminated union rather than the bare YAML shapes
 * (`{device, input}` vs `{device, output}` vs `{consoleOutput}`) because
 * those are structurally ambiguous to both TypeScript and a wire guard: a
 * payload could arrive carrying both `input` and `output`, and nothing in the
 * shape itself says which was meant.
 */
export type ConnectionEnd =
  /** A socket on a panel, stagebox or console — `{ device, input }`. */
  | { readonly kind: "socket"; readonly device: DeviceId; readonly input: number }
  /** A stagebox's physical output — `{ device, output }`. */
  | { readonly kind: "device-output"; readonly device: DeviceId; readonly output: number }
  /** A console XLR out — `{ consoleOutput }`, no device id. */
  | { readonly kind: "console-output"; readonly output: number }
  /** A destination, which has no socket number of its own — `{ device }`. */
  | { readonly kind: "destination"; readonly device: DeviceId };

/** Cable one endpoint to another, in signal direction. */
export interface AddConnectionOperation {
  readonly kind: "add-connection";
  readonly from: ConnectionEnd;
  readonly to: ConnectionEnd;
}

/** Remove an existing cable. Removing one that is not there is an error, not a no-op. */
export interface RemoveConnectionOperation {
  readonly kind: "remove-connection";
  readonly from: ConnectionEnd;
  readonly to: ConnectionEnd;
}

/**
 * Add a destination — a powered speaker or zone. Destinations carry no socket
 * number and no `inputs` of their own (the loader supplies 0), so a label and
 * an optional group is the whole of it.
 */
export interface AddDestinationOperation {
  readonly kind: "add-destination";
  readonly device: DeviceId;
  readonly label: string;
  readonly group?: string;
}

/**
 * Remove a device **and every connection referencing it**, in this one
 * operation.
 *
 * The cascade is not a convenience: a two-step "remove the connections, then
 * the device" would leave a document referencing a device that no longer
 * exists between the steps, and the pipeline validates the *result* of each
 * operation, so it would rightly refuse the first half.
 *
 * Restricted to destinations in this step (issue #28). Removing a stagebox
 * or panel invalidates cascade arithmetic across the whole file and belongs
 * with structural editing (#29), where the consequences can be shown
 * properly.
 */
export interface RemoveDeviceOperation {
  readonly kind: "remove-device";
  readonly device: DeviceId;
}

/**
 * Every edit the app can ask for. Adding a member is additive by design
 * (issue #27): a new union member, a new `case` in `applyOperation`, and a
 * new `case` in `parseInstallationOperation` — all in this file, with no
 * protocol change, because the wire carries `InstallationOperation` whatever
 * it is today.
 */
export type InstallationOperation =
  | SetDeviceLabelOperation
  | SetDeviceGroupOperation
  | SetSocketAnnotationOperation
  | AddConnectionOperation
  | RemoveConnectionOperation
  | AddDestinationOperation
  | RemoveDeviceOperation;

/** Every operation kind this build knows, for guards and for logging. */
export const INSTALLATION_OPERATION_KINDS = [
  "set-device-label",
  "set-device-group",
  "set-socket-annotation",
  "add-connection",
  "remove-connection",
  "add-destination",
  "remove-device",
] as const;

/** One line naming what an operation would do — used in bridge logs. */
export function describeOperation(operation: InstallationOperation): string {
  switch (operation.kind) {
    case "set-device-label":
      return `set-device-label ${operation.device} -> "${operation.label}"`;
    case "set-device-group":
      return operation.group.trim() === ""
        ? `set-device-group ${operation.device} -> (none)`
        : `set-device-group ${operation.device} -> "${operation.group}"`;
    case "set-socket-annotation":
      return operation.status === null
        ? `set-socket-annotation ${operation.device} input ${operation.input} -> (cleared)`
        : `set-socket-annotation ${operation.device} input ${operation.input} -> ${operation.status}`;
    case "add-connection":
      return `add-connection ${describeEnd(operation.from)} -> ${describeEnd(operation.to)}`;
    case "remove-connection":
      return `remove-connection ${describeEnd(operation.from)} -> ${describeEnd(operation.to)}`;
    case "add-destination":
      return `add-destination ${operation.device} ("${operation.label}")`;
    case "remove-device":
      return `remove-device ${operation.device}`;
  }
}

function describeEnd(end: ConnectionEnd): string {
  switch (end.kind) {
    case "socket":
      return `${end.device} input ${end.input}`;
    case "device-output":
      return `${end.device} output ${end.output}`;
    case "console-output":
      return `console output ${end.output}`;
    case "destination":
      return `${end.device}`;
  }
}

/**
 * Applies one operation to `document`, in place.
 *
 * @throws Error naming the offending device when the document does not
 *         contain what the operation refers to. The caller turns that
 *         message into a rejection the operator reads verbatim, so it is
 *         written for them and not for a log.
 */
export function applyOperation(
  document: Document,
  operation: InstallationOperation,
): void {
  switch (operation.kind) {
    case "set-device-label":
      requireDevice(document, operation.device);
      setScalar(document, ["devices", operation.device, "label"], operation.label);
      return;

    case "set-device-group": {
      requireDevice(document, operation.device);
      const group = operation.group.trim();
      const path = ["devices", operation.device, "group"];
      if (group === "") {
        document.deleteIn(path);
      } else {
        setScalar(document, path, group);
      }
      return;
    }

    case "set-socket-annotation":
      applySocketAnnotation(document, operation);
      return;

    case "add-connection":
      applyAddConnection(document, operation);
      return;

    case "remove-connection":
      applyRemoveConnection(document, operation);
      return;

    case "add-destination":
      applyAddDestination(document, operation);
      return;

    case "remove-device":
      applyRemoveDevice(document, operation);
      return;
  }
}

/**
 * `sockets` is keyed by the socket number, and YAML parses `4:` as a *number*
 * scalar. Paths must therefore carry a number, not `"4"`, or `getIn`/`setIn`
 * silently miss the existing key and create a duplicate string one beside it.
 */
function socketPath(device: DeviceId, input: number): (string | number)[] {
  return ["devices", device, "sockets", input];
}

function applySocketAnnotation(
  document: Document,
  operation: SetSocketAnnotationOperation,
): void {
  requireDevice(document, operation.device);
  const path = socketPath(operation.device, operation.input);

  if (operation.status === null) {
    // Clearing an annotation that is not there is a no-op, not an error: the
    // operator's intent ("this socket should carry no annotation") is already
    // satisfied, and `deleteIn` throws on a missing path.
    if (!document.hasIn(path)) return;
    document.deleteIn(path);
    // An empty `sockets:` map is not invalid, but it is noise the author
    // never wrote — drop the key once its last annotation goes.
    const remaining: unknown = document.getIn(["devices", operation.device, "sockets"]);
    if (isEmptyMap(remaining)) {
      document.deleteIn(["devices", operation.device, "sockets"]);
    }
    return;
  }

  // `sockets` must be created as a *map* before writing a numbered key into
  // it. `setIn` infers the container from the next path token, and a numeric
  // token makes it build a sequence — which then fails schema validation with
  // "expected record, received array". Creating the map explicitly is the
  // whole fix, and the reason `sockets` is keyed by socket number at all.
  // `createNode` rather than a bare `{}`: `setIn` stores a plain object as an
  // opaque value, not a YAML collection, and the next `setIn` into it then
  // fails with "Expected YAML collection at sockets".
  const socketsPath = ["devices", operation.device, "sockets"];
  if (!document.hasIn(socketsPath)) {
    document.setIn(socketsPath, document.createNode({}));
  }
  if (!document.hasIn(path)) {
    document.setIn(path, document.createNode({}));
  }
  setScalar(document, [...path, "status"] as string[], operation.status);

  const note = operation.note?.trim() ?? "";
  if (note === "") {
    document.deleteIn([...path, "note"]);
  } else {
    setScalar(document, [...path, "note"] as string[], note);
  }
}

/**
 * `getIn` hands back the `yaml` *node*, not a plain object, so an emptiness
 * check has to look at `items` — `Object.keys()` on a YAMLMap counts its
 * internal fields and never reports empty.
 */
function isEmptyMap(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const items: unknown = (value as { items?: unknown }).items;
  if (Array.isArray(items)) return items.length === 0;
  if (value instanceof Map) return value.size === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

/** The plain-JS shape this end takes in the document's `connections` list. */
function endToPlain(end: ConnectionEnd): Record<string, unknown> {
  switch (end.kind) {
    case "socket":
      return { device: end.device, input: end.input };
    case "device-output":
      return { device: end.device, output: end.output };
    case "console-output":
      return { consoleOutput: end.output };
    case "destination":
      return { device: end.device };
  }
}

/** Every device id an end refers to — `console-output` refers to none. */
function endDevice(end: ConnectionEnd): DeviceId | null {
  return end.kind === "console-output" ? null : end.device;
}

function connectionsSeq(document: Document): unknown[] {
  const seq: unknown = document.getIn(["connections"], true);
  if (seq === undefined || seq === null) return [];
  const items: unknown = (seq as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function plainEquals(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** Index of the connection matching `from`/`to`, or -1. */
function findConnectionIndex(
  document: Document,
  from: ConnectionEnd,
  to: ConnectionEnd,
): number {
  const wantFrom = endToPlain(from);
  const wantTo = endToPlain(to);
  return connectionsSeq(document).findIndex((item) => {
    const plain: unknown = (item as { toJSON?: () => unknown }).toJSON?.();
    if (!isRecord(plain)) return false;
    return plainEquals(plain.from, wantFrom) && plainEquals(plain.to, wantTo);
  });
}

function applyAddConnection(document: Document, operation: AddConnectionOperation): void {
  requireEndExists(document, operation.from);
  requireEndExists(document, operation.to);

  if (findConnectionIndex(document, operation.from, operation.to) !== -1) {
    throw new Error(
      `${describeEnd(operation.from)} is already cabled to ${describeEnd(operation.to)}.`,
    );
  }

  if (!document.hasIn(["connections"])) {
    document.setIn(["connections"], []);
  }
  const seq = document.getIn(["connections"], true) as { items: unknown[] };
  seq.items.push(
    document.createNode({ from: endToPlain(operation.from), to: endToPlain(operation.to) }),
  );
}

function applyRemoveConnection(
  document: Document,
  operation: RemoveConnectionOperation,
): void {
  const index = findConnectionIndex(document, operation.from, operation.to);
  if (index === -1) {
    throw new Error(
      `${describeEnd(operation.from)} is not cabled to ${describeEnd(operation.to)}.`,
    );
  }
  removeConnectionAt(document, index);
}

/**
 * Deletes connection `index`, carrying any comment that sat above it onto the
 * next entry.
 *
 * Without that hand-off, deleting the first cable of a block would silently
 * take the comment describing the *block* with it ("# Pit wall plate 1-3,
 * 5-6 into the pit box") — a comment about the remaining cables, lost because
 * of where it happened to be attached. Comments are a substantial part of
 * this file's value, so a removal must not quietly eat one that still applies.
 */
function removeConnectionAt(document: Document, index: number): void {
  const items = connectionsSeq(document) as { commentBefore?: string }[];
  const removed = items[index];
  const next = items[index + 1];
  const carried = removed?.commentBefore;

  items.splice(index, 1);

  if (carried !== undefined && carried !== "" && next !== undefined) {
    next.commentBefore =
      next.commentBefore === undefined || next.commentBefore === ""
        ? carried
        : `${carried}\n${next.commentBefore}`;
  }
}

function applyAddDestination(
  document: Document,
  operation: AddDestinationOperation,
): void {
  if (document.hasIn(["devices", operation.device])) {
    throw new Error(
      `Device "${operation.device}" already exists: device ids must be unique.`,
    );
  }

  const group = operation.group?.trim() ?? "";
  const device: Record<string, unknown> = {
    kind: "destination",
    label: operation.label,
  };
  if (group !== "") device.group = group;

  if (!document.hasIn(["devices"])) {
    document.setIn(["devices"], {});
  }
  document.setIn(["devices", operation.device], device);
}

function applyRemoveDevice(document: Document, operation: RemoveDeviceOperation): void {
  requireDevice(document, operation.device);

  const kind: unknown = document.getIn(["devices", operation.device, "kind"]);
  if (kind !== "destination") {
    throw new Error(
      `Cannot remove "${operation.device}": only destinations can be removed here. ` +
        `Removing a ${typeof kind === "string" ? kind : "device"} changes AES50 ` +
        `cascade arithmetic across the whole installation.`,
    );
  }

  // Cascade in the same operation — see RemoveDeviceOperation's doc comment.
  // Walk backwards so each splice leaves the lower indices valid.
  const items = connectionsSeq(document);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const plain: unknown = (items[index] as { toJSON?: () => unknown }).toJSON?.();
    if (!isRecord(plain)) continue;
    if (referencesDevice(plain.from, operation.device) || referencesDevice(plain.to, operation.device)) {
      removeConnectionAt(document, index);
    }
  }

  document.deleteIn(["devices", operation.device]);
}

function referencesDevice(end: unknown, device: DeviceId): boolean {
  return isRecord(end) && end.device === device;
}

/**
 * Rejects an endpoint the document does not contain, so a typo becomes a
 * message naming the device rather than a dangling reference the validator
 * has to catch later. Socket *numbers* are deliberately not range-checked
 * here: `validateInstallation` owns that rule and owns it for the whole
 * resulting document, and duplicating it would give two places to disagree.
 */
function requireEndExists(document: Document, end: ConnectionEnd): void {
  const device = endDevice(end);
  if (device !== null) requireDevice(document, device);
}

function requireDevice(document: Document, device: DeviceId): void {
  if (document.hasIn(["devices", device])) return;
  throw new Error(
    `Unknown device "${device}": the installation file has no device with that id.`,
  );
}

/**
 * Writes a scalar value at `path`, reusing the node already there when there
 * is one. Assigning to an existing `Scalar`'s `value` — rather than
 * `setIn`-ing a fresh node — keeps that node's own formatting: the quoting
 * style the author chose, and any trailing `# comment` sitting on the same
 * line as the value. `setIn` is the fallback for a key that does not exist
 * yet.
 */
function setScalar(document: Document, path: string[], value: string): void {
  const existing: unknown = document.getIn(path, true);
  if (isScalar(existing)) {
    existing.value = value;
    return;
  }
  document.setIn(path, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(context: string, expected: string): Error {
  return new Error(`Malformed ${context}: expected ${expected}.`);
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") throw malformed(context, "a string");
  return value;
}

/**
 * Wire guard for an operation (`apply-installation-edit`'s payload). Lives
 * here rather than in `@x32/protocol` so one operation kind is described in
 * exactly one file: adding a variant means adding a `case` next to its own
 * union member and its own `applyOperation` branch, and the protocol package
 * needs no edit at all.
 *
 * The device id is re-branded through `deviceId()`, the sanctioned domain
 * constructor, so a malformed id is rejected on the wire rather than reaching
 * `setIn` and creating a bogus key.
 *
 * @throws Error describing what was expected.
 */
export function parseInstallationOperation(
  value: unknown,
  context: string,
): InstallationOperation {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw malformed(context, 'an operation object with a "kind"');
  }

  switch (value.kind) {
    case "set-device-label":
      return {
        kind: "set-device-label",
        device: parseDeviceId(value.device, `${context}.device`),
        label: requireString(value.label, `${context}.label`),
      };
    case "set-device-group":
      return {
        kind: "set-device-group",
        device: parseDeviceId(value.device, `${context}.device`),
        group: requireString(value.group, `${context}.group`),
      };
    case "set-socket-annotation":
      return {
        kind: "set-socket-annotation",
        device: parseDeviceId(value.device, `${context}.device`),
        input: requireSocketNumber(value.input, `${context}.input`),
        status: parseAnnotationStatus(value.status, `${context}.status`),
        ...(value.note === undefined
          ? {}
          : { note: requireString(value.note, `${context}.note`) }),
      };
    case "add-connection":
      return {
        kind: "add-connection",
        from: parseConnectionEnd(value.from, `${context}.from`),
        to: parseConnectionEnd(value.to, `${context}.to`),
      };
    case "remove-connection":
      return {
        kind: "remove-connection",
        from: parseConnectionEnd(value.from, `${context}.from`),
        to: parseConnectionEnd(value.to, `${context}.to`),
      };
    case "add-destination":
      return {
        kind: "add-destination",
        device: parseDeviceId(value.device, `${context}.device`),
        label: requireString(value.label, `${context}.label`),
        ...(value.group === undefined
          ? {}
          : { group: requireString(value.group, `${context}.group`) }),
      };
    case "remove-device":
      return {
        kind: "remove-device",
        device: parseDeviceId(value.device, `${context}.device`),
      };
    default:
      throw malformed(
        `${context}.kind`,
        INSTALLATION_OPERATION_KINDS.map((kind) => `"${kind}"`).join(" | "),
      );
  }
}

/** A 1-based socket number: a positive integer. Range against the device's own `inputs` is `validateInstallation`'s rule, not the wire's. */
function requireSocketNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw malformed(context, "a positive integer socket number");
  }
  return value;
}

function parseAnnotationStatus(
  value: unknown,
  context: string,
): "broken" | "unused" | null {
  if (value === null) return null;
  if (value === "broken" || value === "unused") return value;
  throw malformed(context, '"broken" | "unused" | null');
}

function parseConnectionEnd(value: unknown, context: string): ConnectionEnd {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw malformed(context, 'a connection end with a "kind"');
  }

  switch (value.kind) {
    case "socket":
      return {
        kind: "socket",
        device: parseDeviceId(value.device, `${context}.device`),
        input: requireSocketNumber(value.input, `${context}.input`),
      };
    case "device-output":
      return {
        kind: "device-output",
        device: parseDeviceId(value.device, `${context}.device`),
        output: requireSocketNumber(value.output, `${context}.output`),
      };
    case "console-output":
      return {
        kind: "console-output",
        output: requireSocketNumber(value.output, `${context}.output`),
      };
    case "destination":
      return {
        kind: "destination",
        device: parseDeviceId(value.device, `${context}.device`),
      };
    default:
      throw malformed(
        `${context}.kind`,
        '"socket" | "device-output" | "console-output" | "destination"',
      );
  }
}

function parseDeviceId(value: unknown, context: string): DeviceId {
  const raw = requireString(value, context);
  try {
    return deviceId(raw);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Malformed ${context}: ${reason}`, { cause });
  }
}
