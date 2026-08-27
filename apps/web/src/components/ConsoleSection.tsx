/**
 * The console section: Mikserpult (FOH) and Console XLR outs, together as
 * one unit — both are "the desk at FOH", so they share one row-layout
 * wrapper. Whether this section is shown at all is decided one level up in
 * `App`, via the header's `SectionsControl` (see `sectionVisibility.ts`);
 * this component only lays the two devices out.
 */

import { deviceId } from "@x32/domain";

import { ConsoleInputs } from "./ConsoleInputs";
import { ConsoleOutputs } from "./ConsoleOutputs";

export function ConsoleSection() {
  return (
    <div className="console-section">
      <div className="console-section__devices">
        <ConsoleInputs deviceId={deviceId("console")} />
        <ConsoleOutputs />
      </div>
    </div>
  );
}
