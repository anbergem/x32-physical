/**
 * One X32 input channel strip: its number and its name.
 *
 * It subscribes to its *own* channel plus its own hover and selection status
 * (architecture.md §5), so renaming CH7 rerenders CH7, hovering a socket
 * rerenders only the strips actually on that route, and the console SELECTing
 * a channel rerenders only that channel's route.
 */

import { endpointId, mixerChannel } from "@x32/domain";
import type { MixerChannelId } from "@x32/domain";

import { isMeterHot, meterBarHeightPercent } from "../format/meter";
import {
  selectChannelState,
  selectDiagnosticStatus,
  selectHoverStatus,
  selectMeterLevel,
  selectSelectionStatus,
  selectSetHoveredEndpoint,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { diagnosticModifier, hoverModifier, selectionModifier } from "./highlight";

export function MixerChannel({ channel }: { channel: MixerChannelId }) {
  const endpoint = endpointId(mixerChannel(channel));
  const state = useAppStore(selectChannelState(channel));
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const selectionStatus = useAppStore(selectSelectionStatus(endpoint));
  const diagnosticStatus = useAppStore(selectDiagnosticStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);
  // The fourth, fastest state path (architecture.md §5): its own primitive
  // selector, subscribed to only this channel's level, so a meter tick never
  // rerenders any strip but this one.
  const meterLevel = useAppStore(selectMeterLevel(channel));

  // Single composition point for the class list — see `InputPort`. Hover,
  // selection and diagnostics are independent layers: a strip can be on all
  // three at once (e.g. the operator hovers the channel they just SELECTed,
  // which also disagrees with the baseline) and shows all three.
  const classNames = ["strip"];
  if (state === undefined) classNames.push("strip--unknown");
  const hoverClass = hoverModifier("strip", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);
  const selectionClass = selectionModifier("strip", selectionStatus);
  if (selectionClass !== null) classNames.push(selectionClass);
  const diagnosticClass = diagnosticModifier("strip", diagnosticStatus);
  if (diagnosticClass !== null) classNames.push(diagnosticClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      onMouseEnter={() => setHovered(endpoint)}
      onMouseLeave={() => setHovered(null)}
    >
      <span className="strip__number">{channel}</span>
      {/* No name until the first snapshot arrives — topology renders without
          a mixer, and an empty X32 channel name is legitimately blank. */}
      <span className="strip__name">{state?.name ?? "·"}</span>
      {hoverStatus === "hovered" && <EndpointTooltip endpoint={endpoint} />}
      {/* No data (null) -> no bar at all, zero layout change either way —
          the bar is absolutely positioned so it never shifts the strip's
          own content regardless of whether it's present. */}
      {meterLevel !== null && <MeterBar level={meterLevel} />}
    </div>
  );
}

function MeterBar({ level }: { level: number }) {
  const heightPercent = meterBarHeightPercent(level);
  const classNames = ["strip__meter-fill"];
  if (isMeterHot(heightPercent)) classNames.push("strip__meter-fill--hot");

  // The track is always rendered (dim, full height) so silence and "no
  // meter data at all" stay visually distinct: the caller only mounts
  // `MeterBar` when this channel has data, so the track's presence itself
  // is the "data is arriving" signal, independent of the fill's height.
  return (
    <span className="strip__meter" aria-hidden="true">
      <span className={classNames.join(" ")} style={{ height: `${heightPercent}%` }} />
    </span>
  );
}
