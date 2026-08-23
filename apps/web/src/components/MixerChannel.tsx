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

import {
  selectChannelState,
  selectHoverStatus,
  selectSelectionStatus,
  selectSetHoveredEndpoint,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier, selectionModifier } from "./highlight";

export function MixerChannel({ channel }: { channel: MixerChannelId }) {
  const endpoint = endpointId(mixerChannel(channel));
  const state = useAppStore(selectChannelState(channel));
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const selectionStatus = useAppStore(selectSelectionStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);

  // Single composition point for the class list — see `InputPort`. Hover and
  // selection are independent layers: a strip can be on both at once (e.g.
  // the operator hovers the channel they just SELECTed) and shows both.
  const classNames = ["strip"];
  if (state === undefined) classNames.push("strip--unknown");
  const hoverClass = hoverModifier("strip", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);
  const selectionClass = selectionModifier("strip", selectionStatus);
  if (selectionClass !== null) classNames.push(selectionClass);

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
    </div>
  );
}
