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
 * Add a device of any kind (issue #29).
 *
 * It carries **everything the kind needs to be valid**, because the pipeline
 * validates the document after each operation: a stagebox added without its
 * `aes50` mapping would fail `missing-aes50` and be refused, so there is no
 * "add it now, configure it next" sequence to be had. The same reasoning as
 * `remove-device`'s cascade.
 *
 * Per-kind rules, enforced here so a malformed request is refused with a
 * sentence rather than a schema dump:
 *
 * - `stagebox` — `inputs` ≥ 1 and `aes50` are required; `outputs` and
 *   `outputBlock` are optional.
 * - `passive-panel`, `console` — `inputs` ≥ 1, and **no** `aes50`: only a
 *   stagebox connects to an AES50 bus.
 * - `destination` — a label, optionally a group, nothing else. `inputs: 0` is
 *   supplied by the loader and is never authored.
 */
export interface AddDeviceOperation {
  readonly kind: "add-device";
  readonly device: DeviceId;
  readonly deviceKind: "stagebox" | "passive-panel" | "console" | "destination";
  readonly label: string;
  readonly group?: string;
  readonly inputs?: number;
  readonly outputs?: number;
  readonly aes50?: { readonly bus: "A" | "B"; readonly offset: number };
  readonly outputBlock?: { readonly start: number };
}

/**
 * One structural field of an existing device (issue #29).
 *
 * `aes50Offset` and `outputBlockStart` are the two most dangerous values in
 * the whole file: neither appears on any patch sheet, both were
 * reverse-engineered from the cascade, and getting either wrong silently
 * mislabels every socket or every output on that box — with nothing over OSC
 * able to catch it. They are editable here, but the interface's job is to
 * present them as questions about hardware and show the resulting ranges, and
 * never to infer them.
 */
export type DeviceFieldEdit =
  | { readonly field: "inputs"; readonly value: number }
  | { readonly field: "outputs"; readonly value: number | null }
  | { readonly field: "aes50Bus"; readonly value: "A" | "B" }
  | { readonly field: "aes50Offset"; readonly value: number }
  | { readonly field: "outputBlockStart"; readonly value: number | null };

export interface SetDeviceFieldOperation {
  readonly kind: "set-device-field";
  readonly device: DeviceId;
  readonly edit: DeviceFieldEdit;
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
  | AddDeviceOperation
  | SetDeviceFieldOperation
  | RemoveDeviceOperation;

/** Every operation kind this build knows, for guards and for logging. */
export const INSTALLATION_OPERATION_KINDS = [
  "set-device-label",
  "set-device-group",
  "set-socket-annotation",
  "add-connection",
  "remove-connection",
  "add-device",
  "set-device-field",
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
    case "add-device":
      return `add-device ${operation.deviceKind} ${operation.device} ("${operation.label}")`;
    case "set-device-field":
      return `set-device-field ${operation.device} ${operation.edit.field} -> ${String(operation.edit.value)}`;
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

    case "add-device":
      applyAddDevice(document, operation);
      return;

    case "set-device-field":
      applySetDeviceField(document, operation);
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
  const seq = document.getIn(["connections"], true) as { items: unknown[]; flow?: boolean };
  const entry = document.createNode({
    from: endToPlain(operation.from),
    to: endToPlain(operation.to),
  });
  // `- from: { … }` / `  to: { … }` — the sample's shape exactly.
  applyHouseStyle(entry, ["from", "to"]);
  seq.flow = false;
  seq.items.push(entry);
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

/**
 * Matches the hand-written house style, because the file must stay pleasant to
 * hand-edit — that is the whole reason operations are surgical rather than a
 * re-serialisation.
 *
 * `yaml` inherits flow style from the container it writes into, so a document
 * seeded as `devices: {}` would grow every device as a one-line flow map and
 * produce something no one would want to open. The convention in
 * `installation.sample.yaml` is: devices and their fields in block style, with
 * `aes50` and `outputBlock` kept as flow one-liners, exactly as
 * `aes50: { bus: B, offset: 0 }`.
 */
function applyHouseStyle(node: unknown, nested: readonly string[] = []): void {
  if (node === null || typeof node !== "object") return;
  const collection = node as { flow?: boolean; get?: (key: string) => unknown };
  collection.flow = false;
  for (const key of nested) {
    const child = collection.get?.(key);
    if (child !== undefined && child !== null && typeof child === "object") {
      (child as { flow?: boolean }).flow = true;
    }
  }
}

function applyAddDevice(document: Document, operation: AddDeviceOperation): void {
  if (document.hasIn(["devices", operation.device])) {
    throw new Error(
      `Device "${operation.device}" already exists: device ids must be unique.`,
    );
  }

  const device: Record<string, unknown> = {
    kind: operation.deviceKind,
    label: operation.label,
  };

  if (operation.deviceKind === "destination") {
    // A destination is a device-level endpoint: no sockets of its own, and
    // `inputs: 0` supplied by the loader rather than authored.
    if (operation.inputs !== undefined || operation.aes50 !== undefined) {
      throw new Error(
        `A destination has no inputs or AES50 mapping of its own — ` +
          `"${operation.device}" declared them.`,
      );
    }
  } else {
    if (operation.inputs === undefined || !Number.isInteger(operation.inputs) || operation.inputs < 1) {
      throw new Error(
        `A ${operation.deviceKind} must declare at least 1 input — ` +
          `"${operation.device}" declared ${String(operation.inputs)}.`,
      );
    }
    device.inputs = operation.inputs;

    if (operation.deviceKind === "stagebox") {
      // Required, and required *here*: a stagebox added without it would fail
      // `missing-aes50` and the whole edit would be refused, so there is no
      // valid "add now, map later" sequence.
      if (operation.aes50 === undefined) {
        throw new Error(
          `Stagebox "${operation.device}" needs its AES50 mapping ` +
            `({ bus, offset }) — a stagebox without one is not a valid installation.`,
        );
      }
      device.aes50 = { bus: operation.aes50.bus, offset: operation.aes50.offset };
      if (operation.outputs !== undefined) device.outputs = operation.outputs;
      if (operation.outputBlock !== undefined) {
        device.outputBlock = { start: operation.outputBlock.start };
      }
    } else if (operation.aes50 !== undefined) {
      throw new Error(
        `Only a stagebox connects to an AES50 bus — "${operation.device}" is a ` +
          `${operation.deviceKind}.`,
      );
    }
  }

  const group = operation.group?.trim() ?? "";
  if (group !== "") device.group = group;

  if (!document.hasIn(["devices"])) {
    document.setIn(["devices"], document.createNode({}));
  }
  const node = document.createNode(device);
  applyHouseStyle(node, ["aes50", "outputBlock"]);
  document.setIn(["devices", operation.device], node);
  // The `devices` map itself: a document seeded as `devices: {}` is flow, and
  // would otherwise stay that way for every device ever added to it.
  applyHouseStyle(document.getIn(["devices"], true));
}

function applySetDeviceField(
  document: Document,
  operation: SetDeviceFieldOperation,
): void {
  requireDevice(document, operation.device);
  const base = ["devices", operation.device];
  const { edit } = operation;

  switch (edit.field) {
    case "inputs":
      document.setIn([...base, "inputs"], edit.value);
      return;

    // `outputs` and `outputBlock` are a schema *pair*: a stagebox that
    // presents a block must say how many outs it has, and a declared output
    // count needs a block to sit in. So clearing either clears both —
    // clearing one alone could only ever produce a document the pipeline
    // refuses, which would make the operation useless rather than safe.
    case "outputs":
      if (edit.value === null) {
        document.deleteIn([...base, "outputs"]);
        document.deleteIn([...base, "outputBlock"]);
      } else {
        document.setIn([...base, "outputs"], edit.value);
      }
      return;

    case "aes50Bus":
    case "aes50Offset": {
      requireStagebox(document, operation.device, "an AES50 mapping");
      if (!document.hasIn([...base, "aes50"])) {
        document.setIn([...base, "aes50"], document.createNode({}));
      }
      const key = edit.field === "aes50Bus" ? "bus" : "offset";
      document.setIn([...base, "aes50", key], edit.value);
      return;
    }

    case "outputBlockStart": {
      requireStagebox(document, operation.device, "an output block");
      if (edit.value === null) {
        document.deleteIn([...base, "outputBlock"]);
        document.deleteIn([...base, "outputs"]);
        return;
      }
      if (!document.hasIn([...base, "outputBlock"])) {
        document.setIn([...base, "outputBlock"], document.createNode({}));
      }
      document.setIn([...base, "outputBlock", "start"], edit.value);
      return;
    }
  }
}

function requireStagebox(document: Document, device: DeviceId, what: string): void {
  const kind: unknown = document.getIn(["devices", device, "kind"]);
  if (kind === "stagebox") return;
  throw new Error(
    `Only a stagebox has ${what} — "${device}" is a ` +
      `${typeof kind === "string" ? kind : "device of unknown kind"}.`,
  );
}

function applyRemoveDevice(document: Document, operation: RemoveDeviceOperation): void {
  requireDevice(document, operation.device);

  // Any kind may be removed since issue #29. Removing a stagebox or panel is
  // far more consequential than removing a destination — it changes AES50
  // cascade arithmetic and strands every socket that fed it — so the *UI*
  // states those consequences before asking. The operation itself stays
  // uniform: refusing structurally valid edits down here would only push
  // people back to a text editor, which has no guardrails at all.

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
    case "add-device":
      return {
        kind: "add-device",
        device: parseDeviceId(value.device, `${context}.device`),
        deviceKind: parseDeviceKind(value.deviceKind, `${context}.deviceKind`),
        label: requireString(value.label, `${context}.label`),
        ...(value.group === undefined
          ? {}
          : { group: requireString(value.group, `${context}.group`) }),
        ...(value.inputs === undefined
          ? {}
          : { inputs: requireCount(value.inputs, `${context}.inputs`) }),
        ...(value.outputs === undefined
          ? {}
          : { outputs: requireCount(value.outputs, `${context}.outputs`) }),
        ...(value.aes50 === undefined
          ? {}
          : { aes50: parseAes50Mapping(value.aes50, `${context}.aes50`) }),
        ...(value.outputBlock === undefined
          ? {}
          : {
              outputBlock: {
                start: requireCount(
                  isRecord(value.outputBlock) ? value.outputBlock.start : undefined,
                  `${context}.outputBlock.start`,
                ),
              },
            }),
      };
    case "set-device-field":
      return {
        kind: "set-device-field",
        device: parseDeviceId(value.device, `${context}.device`),
        edit: parseDeviceFieldEdit(value.edit, `${context}.edit`),
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

function parseDeviceKind(
  value: unknown,
  context: string,
): "stagebox" | "passive-panel" | "console" | "destination" {
  if (
    value === "stagebox" ||
    value === "passive-panel" ||
    value === "console" ||
    value === "destination"
  ) {
    return value;
  }
  throw malformed(context, '"stagebox" | "passive-panel" | "console" | "destination"');
}

/** A socket/output count or an offset: a non-negative integer. Ranges are `validateInstallation`'s rule. */
function requireCount(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw malformed(context, "a non-negative integer");
  }
  return value;
}

function parseAes50Mapping(
  value: unknown,
  context: string,
): { bus: "A" | "B"; offset: number } {
  if (!isRecord(value)) throw malformed(context, "an object with bus and offset");
  if (value.bus !== "A" && value.bus !== "B") {
    throw malformed(`${context}.bus`, '"A" | "B"');
  }
  return { bus: value.bus, offset: requireCount(value.offset, `${context}.offset`) };
}

function parseDeviceFieldEdit(value: unknown, context: string): DeviceFieldEdit {
  if (!isRecord(value) || typeof value.field !== "string") {
    throw malformed(context, 'an edit with a "field"');
  }

  switch (value.field) {
    case "inputs":
      return { field: "inputs", value: requireCount(value.value, `${context}.value`) };
    case "outputs":
      return {
        field: "outputs",
        value: value.value === null ? null : requireCount(value.value, `${context}.value`),
      };
    case "aes50Bus":
      if (value.value !== "A" && value.value !== "B") {
        throw malformed(`${context}.value`, '"A" | "B"');
      }
      return { field: "aes50Bus", value: value.value };
    case "aes50Offset":
      return { field: "aes50Offset", value: requireCount(value.value, `${context}.value`) };
    case "outputBlockStart":
      return {
        field: "outputBlockStart",
        value: value.value === null ? null : requireCount(value.value, `${context}.value`),
      };
    default:
      throw malformed(
        `${context}.field`,
        '"inputs" | "outputs" | "aes50Bus" | "aes50Offset" | "outputBlockStart"',
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
