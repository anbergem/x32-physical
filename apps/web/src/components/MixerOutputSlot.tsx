/**
 * One X32 output slot — the compact cell of the "X32 outputs" row
 * (issue #11). Deliberately lighter than `MixerChannel`: an output slot
 * carries less information (a slot number and a source), no name, no meter
 * (output metering is out of scope for this issue).
 */

import { endpointId, mixerOutput } from "@x32/domain";

import { formatMixerOutputSource } from "../format/outputSource";
import {
  selectHoverStatus,
  selectOutputState,
  selectSetHoveredEndpoint,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier } from "./highlight";

export function MixerOutputSlot({ output }: { output: number }) {
  const endpoint = endpointId(mixerOutput(output));
  const state = useAppStore(selectOutputState(output));
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);

  const classNames = ["output-slot"];
  const hoverClass = hoverModifier("output-slot", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      onMouseEnter={() => setHovered(endpoint)}
      onMouseLeave={() => setHovered(null)}
    >
      <span className="output-slot__number">Out {output}</span>
      <span className="output-slot__source">
        {state === undefined ? "·" : formatMixerOutputSource(state.source)}
      </span>
      {hoverStatus === "hovered" && <EndpointTooltip endpoint={endpoint} />}
    </div>
  );
}
