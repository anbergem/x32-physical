/**
 * One X32 output slot — the compact cell of the "X32 outputs" row
 * (issue #11). Deliberately lighter than `MixerChannel`: an output slot
 * carries a slot number, a source and (issue #36) a meter, but no name.
 *
 * The meter is the *source's* level, since the console meters buses and
 * matrices rather than output sockets. A slot with no metered source shows no
 * bar at all — see `selectOutputMeterLevel`; absent must not look like
 * silence.
 */

import { endpointId, mixerOutput } from "@x32/domain";

import { formatMixerOutputSource } from "../format/outputSource";
import { isMeterHot, meterBarHeightPercent } from "../format/meter";
import {
  selectHoverStatus,
  selectOutputMeterLevel,
  selectOutputState,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier, isHoveredEndpoint } from "./highlight";
import { useEndpointPointer } from "./useEndpointPointer";

export function MixerOutputSlot({ output }: { output: number }) {
  const endpoint = endpointId(mixerOutput(output));
  const state = useAppStore(selectOutputState(output));
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  // Primitive selector, subscribed to this slot's level alone, so one
  // output's tick never rerenders the other fifteen.
  const meterLevel = useAppStore(selectOutputMeterLevel(output));
  const pointer = useEndpointPointer(endpoint);

  const classNames = ["output-slot"];
  const hoverClass = hoverModifier("output-slot", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      {...pointer}
    >
      <span className="output-slot__number">Out {output}</span>
      <span className="output-slot__source">
        {state === undefined ? "·" : formatMixerOutputSource(state.source)}
      </span>
      {meterLevel !== null && <OutputMeterBar level={meterLevel} />}
      {meterLevel !== null && <OutputMeterBar level={meterLevel} />}
      {isHoveredEndpoint(hoverStatus) && (
        <EndpointTooltip endpoint={endpoint} pinned={hoverStatus === "pinned"} />
      )}
    </div>
  );
}

/**
 * Mirrors `MixerChannel`'s `MeterBar`, scaled to the shorter output cell. The
 * track is always drawn when mounted, so "silent" (empty track) and "not
 * metered" (no track at all) stay visually distinct — the distinction the
 * whole `null` contract exists to preserve.
 */
function OutputMeterBar({ level }: { level: number }) {
  const heightPercent = meterBarHeightPercent(level);
  const classNames = ["output-slot__meter-fill"];
  if (isMeterHot(heightPercent)) classNames.push("output-slot__meter-fill--hot");

  return (
    <span className="output-slot__meter" aria-hidden="true">
      <span className={classNames.join(" ")} style={{ height: `${heightPercent}%` }} />
    </span>
  );
}
