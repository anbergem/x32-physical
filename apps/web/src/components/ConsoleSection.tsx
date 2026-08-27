/**
 * The console at FOH, laid out as one row: the desk's local inputs and the
 * Console XLR outs side by side, because they are the same physical desk.
 *
 * They are nonetheless two *sections* as far as visibility goes — one is an
 * input surface, the other an output surface, so they belong to different
 * halves of the signal path (`sectionVisibility.ts`). `App` decides which of
 * the two to ask for via the header's `SectionsControl`; this component only
 * lays out whatever it is given, and keeps the shared row wrapper so showing
 * one half never moves the other.
 *
 * Which desk it draws comes from the installation, not from a device id
 * (issue #22): whichever device declares `kind: console`, or no input frame
 * at all if none does. The 16 XLR outs are not a device — they are X32-fixed
 * endpoints (issue #22 "verified facts") and are drawn whenever their
 * section is visible, console device or not. When neither half has anything
 * to show, the row wrapper is not rendered either: an empty bordered box
 * would read as "the desk has nothing patched", which is a different claim
 * from "this installation does not describe a desk".
 */

import { consoleDeviceFor } from "../installation/deviceGroups";
import { selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { ConsoleInputs } from "./ConsoleInputs";
import { ConsoleOutputs } from "./ConsoleOutputs";

export function ConsoleSection({
  showInputs,
  showOutputs,
}: {
  showInputs: boolean;
  showOutputs: boolean;
}) {
  const installation = useAppStore(selectInstallation);
  const consoleDevice = consoleDeviceFor(installation);
  const inputs = showInputs && consoleDevice !== undefined;

  if (!inputs && !showOutputs) return null;

  return (
    <div className="console-section">
      <div className="console-section__devices">
        {inputs && consoleDevice !== undefined && (
          <ConsoleInputs deviceId={consoleDevice.id} />
        )}
        {showOutputs && <ConsoleOutputs />}
      </div>
    </div>
  );
}
