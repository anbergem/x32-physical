/**
 * One X32 input channel strip: its number and its name.
 *
 * It subscribes to its *own* channel only (architecture.md §5), so renaming
 * CH7 rerenders CH7 and nothing else. Like `InputPort` it carries its
 * `EndpointId` for the highlighting of plan steps 7–8.
 */

import { endpointId, mixerChannel } from "@x32/domain";
import type { MixerChannelId } from "@x32/domain";

import { selectChannelState } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function MixerChannel({ channel }: { channel: MixerChannelId }) {
  const state = useAppStore(selectChannelState(channel));

  // Single composition point for the class list — see `InputPort`.
  const classNames = ["strip"];
  if (state === undefined) classNames.push("strip--unknown");

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpointId(mixerChannel(channel))}
    >
      <span className="strip__number">{channel}</span>
      {/* No name until the first snapshot arrives — topology renders without
          a mixer, and an empty X32 channel name is legitimately blank. */}
      <span className="strip__name">{state?.name ?? "·"}</span>
    </div>
  );
}
