/**
 * What the everyday editor controls actually send (issue #28).
 *
 * Pure, and separate from the components for the same reason `labelEdit.ts`
 * is: the judgement — *is there anything to send at all?* — is worth
 * asserting without a DOM stack, and the components are left with wiring.
 *
 * The recurring rule is **do not write when nothing was asked for.** Tabbing
 * through a field, or re-choosing the value already stored, must not rewrite
 * the venue's file: every write churns the `.bak`, which is the one copy of
 * the last-known-good document.
 */

import type { DeviceId } from "@x32/domain";
import { deviceId } from "@x32/domain";
import type {
  AddConnectionOperation,
  AddDestinationOperation,
  ConnectionEnd,
  RemoveConnectionOperation,
  RemoveDeviceOperation,
  SetDeviceGroupOperation,
  SetSocketAnnotationOperation,
} from "@x32/installation";

/**
 * The operation a group commit would send, or `null` when there is nothing to
 * send.
 *
 * Unlike a label, a **blank group is meaningful**: it clears the group, and
 * being ungrouped is an ordinary state (docs/installation.md). So blank is
 * passed through rather than treated as "no change" — but only when the
 * device actually had one.
 */
export function deviceGroupOperation(
  device: DeviceId,
  currentGroup: string | undefined,
  draft: string,
): SetDeviceGroupOperation | null {
  const group = draft.trim();
  const current = currentGroup ?? "";
  if (group === current) return null;
  return { kind: "set-device-group", device, group };
}

/**
 * The operation an annotation change would send, or `null` when the socket
 * already says exactly this.
 */
export function socketAnnotationOperation(
  device: DeviceId,
  input: number,
  current: { status: "broken" | "unused"; note?: string } | undefined,
  next: { status: "broken" | "unused" | null; note?: string },
): SetSocketAnnotationOperation | null {
  const nextNote = next.note?.trim() ?? "";
  const currentNote = current?.note?.trim() ?? "";

  if (next.status === null) {
    // Clearing an annotation that is not there asks for nothing.
    if (current === undefined) return null;
    return { kind: "set-socket-annotation", device, input, status: null };
  }

  if (current?.status === next.status && currentNote === nextNote) return null;

  return {
    kind: "set-socket-annotation",
    device,
    input,
    status: next.status,
    ...(nextNote === "" ? {} : { note: nextNote }),
  };
}

export function addConnectionOperation(
  from: ConnectionEnd,
  to: ConnectionEnd,
): AddConnectionOperation {
  return { kind: "add-connection", from, to };
}

export function removeConnectionOperation(
  from: ConnectionEnd,
  to: ConnectionEnd,
): RemoveConnectionOperation {
  return { kind: "remove-connection", from, to };
}

/**
 * A new destination, or `null` when the label is blank — an unnamed box on
 * the schematic helps nobody, and a blank field is nearly always a slip.
 *
 * The device id is derived from the label rather than asked for separately:
 * ids are an implementation detail of the file, and requiring a technician to
 * invent a unique slug is exactly the kind of schema knowledge the editor
 * exists to hide.
 */
export function addDestinationOperation(
  label: string,
  group: string,
  existingIds: readonly DeviceId[],
): AddDestinationOperation | null {
  const trimmed = label.trim();
  if (trimmed === "") return null;

  const device = uniqueDeviceId(trimmed, existingIds);
  const trimmedGroup = group.trim();
  return {
    kind: "add-destination",
    device,
    label: trimmed,
    ...(trimmedGroup === "" ? {} : { group: trimmedGroup }),
  };
}

export function removeDeviceOperation(device: DeviceId): RemoveDeviceOperation {
  return { kind: "remove-device", device };
}

/**
 * A readable, unique device id from a label: lowercased, non-alphanumerics
 * collapsed to hyphens, with a numeric suffix only if that collides.
 *
 * Readability is the point — someone opening `installation.yaml` in a text
 * editor should recognise what a device is from its key, the way every
 * hand-written device in the sample does.
 */
export function uniqueDeviceId(label: string, existingIds: readonly DeviceId[]): DeviceId {
  const base =
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "destination";

  const taken = new Set<string>(existingIds);
  // Branded through the sanctioned constructor, never cast: `deviceId()` is
  // what decides a well-formed id, and slipping past it here would let the
  // editor mint a key the loader would later refuse.
  if (!taken.has(base)) return deviceId(base);

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return deviceId(candidate);
  }
}
