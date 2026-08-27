/**
 * The console at FOH, laid out as one row: Mikserpult (FOH) and Console XLR
 * outs side by side, because they are the same physical desk.
 *
 * They are nonetheless two *sections* as far as visibility goes — one is an
 * input surface, the other an output surface, so they belong to different
 * halves of the signal path (`sectionVisibility.ts`). `App` decides which of
 * the two to ask for via the header's `SectionsControl`; this component only
 * lays out whatever it is given, and keeps the shared row wrapper so showing
 * one half never moves the other.
 */

import { deviceId } from "@x32/domain";

import { ConsoleInputs } from "./ConsoleInputs";
import { ConsoleOutputs } from "./ConsoleOutputs";

export function ConsoleSection({
  showInputs,
  showOutputs,
}: {
  showInputs: boolean;
  showOutputs: boolean;
}) {
  return (
    <div className="console-section">
      <div className="console-section__devices">
        {showInputs && <ConsoleInputs deviceId={deviceId("console")} />}
        {showOutputs && <ConsoleOutputs />}
      </div>
    </div>
  );
}
