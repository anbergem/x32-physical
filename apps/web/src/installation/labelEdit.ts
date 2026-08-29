/**
 * What committing a device-label field actually sends (issue #27).
 *
 * Pure and separate from `DeviceInspector` for the same reason
 * `sectionVisibility.ts` is separate from `SectionsControl`: the judgement —
 * *is there anything to send at all?* — is worth asserting without a DOM
 * stack, and the component should be left with nothing but wiring.
 *
 * Two rules, both about not writing when nothing was asked for:
 *
 * - **A commit is a blur or Enter, never a keystroke.** That contract lives in
 *   the component; what lives here is the consequence — one commit produces at
 *   most one operation. Per-keystroke writes would mean a write storm and a
 *   `.bak` churned into uselessness.
 * - **An unchanged or blank draft sends nothing.** Tabbing through a field is
 *   the commonest interaction there is, and it must not rewrite the venue's
 *   file. A blank label is treated as "no change" rather than as a request to
 *   erase the device's name: on blur it is nearly always a slip, and the
 *   schematic would be left with an unnamed box.
 */

import type { DeviceId } from "@x32/domain";
import type { InstallationOperation } from "@x32/installation";

/** The slice of `MixerGateway` a label commit needs. */
export interface InstallationEditSender {
  applyInstallationEdit(baseVersion: string, operation: InstallationOperation): void;
}

/**
 * The operation a commit would send, or `null` when there is nothing to send.
 *
 * @param currentLabel the label the installation currently carries.
 * @param draft        what is in the field, exactly as typed.
 */
export function deviceLabelOperation(
  device: DeviceId,
  currentLabel: string,
  draft: string,
): InstallationOperation | null {
  const label = draft.trim();
  if (label === "" || label === currentLabel) return null;
  return { kind: "set-device-label", device, label };
}

/**
 * Commits a label edit through `sender`, at most once.
 *
 * @returns whether an operation was sent — the inspector uses it to decide
 *   whether to keep waiting for an answer or simply close.
 */
export function commitDeviceLabel(
  sender: InstallationEditSender,
  baseVersion: string | null,
  device: DeviceId,
  currentLabel: string,
  draft: string,
): boolean {
  // No version means this app never learned what it is editing against, and
  // an edit with no precondition is exactly what optimistic concurrency
  // exists to prevent. Send nothing.
  if (baseVersion === null) return false;

  const operation = deviceLabelOperation(device, currentLabel, draft);
  if (operation === null) return false;

  sender.applyInstallationEdit(baseVersion, operation);
  return true;
}
