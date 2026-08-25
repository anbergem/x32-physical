/**
 * The console's own 16 XLR outs (issue #11) — physically at FOH, alongside
 * the mixer section rather than on stage with the stageboxes
 * (docs/installation.md "Output topology": "console XLR 1", "console XLR
 * 2"). Every slot is rendered regardless of whether the venue's
 * `installation.yaml` actually declares it — most read uncabled, exactly
 * like an unused stagebox output.
 *
 * No dual label: a console XLR's own number *is* its Out slot number (the
 * console's identity default — architecture.md §3), so a second label would
 * only repeat the first.
 */

import { consoleOutput, endpointId, MIXER_OUTPUT_COUNT } from "@x32/domain";

import { physicalOutputDestinationsFor } from "../installation/outputCabling";
import { selectInstallation } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { OutputPort } from "./OutputPort";

const SOCKETS: number[] = Array.from(
  { length: MIXER_OUTPUT_COUNT },
  (_, index) => index + 1,
);

export function ConsoleOutputs() {
  const installation = useAppStore(selectInstallation);
  const outputDestinations = physicalOutputDestinationsFor(installation);

  return (
    <section className="device device--console-outputs">
      <header className="device__header">
        <span className="device__label">Console XLR outs</span>
        <span className="device__meta">FOH</span>
      </header>
      <div className="device__ports">
        {SOCKETS.map((socket) => {
          const endpoint = endpointId(consoleOutput(socket));
          return (
            <OutputPort
              key={socket}
              endpoint={endpoint}
              label={String(socket)}
              cabled={outputDestinations.has(endpoint)}
            />
          );
        })}
      </div>
    </section>
  );
}
