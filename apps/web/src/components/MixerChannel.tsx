/**
 * One X32 input channel strip: its number and its name.
 *
 * It subscribes to its *own* channel plus its own highlight status
 * (architecture.md §5), so renaming CH7 rerenders CH7 and hovering a socket
 * rerenders only the strips actually on that route.
 */

import { endpointId, mixerChannel } from "@x32/domain";
import type { MixerChannelId } from "@x32/domain";

import {
  selectChannelState,
  selectHoverStatus,
  selectSetHoveredEndpoint,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier } from "./highlight";

export function MixerChannel({ channel }: { channel: MixerChannelId }) {
  const endpoint = endpointId(mixerChannel(channel));
  const state = useAppStore(selectChannelState(channel));
  const status = useAppStore(selectHoverStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);

  // Single composition point for the class list — see `InputPort`.
  const classNames = ["strip"];
  if (state === undefined) classNames.push("strip--unknown");
  const highlight = hoverModifier("strip", status);
  if (highlight !== null) classNames.push(highlight);

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
      {status === "hovered" && <EndpointTooltip endpoint={endpoint} />}
    </div>
  );
}
