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
 * Every edit the app can ask for. One member today (issue #27 is the vertical
 * slice that proves the pipe); the rest of the ~90% of real edits — groups,
 * socket annotations, cabling, destinations — arrive as further members.
 */
export type InstallationOperation = SetDeviceLabelOperation;

/** Every operation kind this build knows, for guards and for logging. */
export const INSTALLATION_OPERATION_KINDS = ["set-device-label"] as const;

/** One line naming what an operation would do — used in bridge logs. */
export function describeOperation(operation: InstallationOperation): string {
  switch (operation.kind) {
    case "set-device-label":
      return `set-device-label ${operation.device} -> "${operation.label}"`;
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
  }
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
    default:
      throw malformed(
        `${context}.kind`,
        INSTALLATION_OPERATION_KINDS.map((kind) => `"${kind}"`).join(" | "),
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
