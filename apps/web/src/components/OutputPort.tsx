/**
 * One physical output socket — console XLR or stagebox XLR out (issue #11).
 * The output-side mirror of `InputPort`, with two differences: no
 * selection/diagnostic layer (console SELECT and the baseline diff are
 * input-only — architecture.md §3/§5, "Out of scope"), and a `cabled` flag
 * for the wholesale-block distinction (docs/installation.md "a block is
 * presented wholesale, but only some sockets are patched") — a socket that
 * carries a block but has nothing plugged into it reads visually distinct
 * from one that does, so a technician is never told a wholesale-presented
 * socket feeds a destination it does not.
 *
 * Like `InputPort`, it knows only its `EndpointId`: hovering (or, on touch,
 * tapping) it publishes that id to the shared `hoveredEndpoint` slice, and
 * `selectHoverStatus`
 * (which consults `routeIndex` and `outputRouteIndex` alike) decides what
 * lights up.
 */

import type { EndpointId } from "@x32/domain";

import { selectHoverStatus } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier, isHoveredEndpoint } from "./highlight";
import { useEndpointPointer } from "./useEndpointPointer";

export interface OutputPortProps {
  /** Domain identity of this socket; the handle for hover and highlighting. */
  endpoint: EndpointId;
  /** The number printed on the box or console, e.g. `5`. */
  label: string;
  /**
   * The console Out slot this socket carries, e.g. `Out 13` — a stagebox
   * socket's second, dual-labelled identity, mirroring `InputPort`'s AES50
   * label. Console XLRs carry no second label: their own number already is
   * the Out slot (the console's identity default).
   */
  outSlotLabel?: string;
  /**
   * Whether `installation.yaml` declares this exact socket cabled to a
   * destination (`installation/outputCabling.ts`) — never read from
   * `OutputRouteIndex`, whose `destinations` reads identically for every
   * socket sharing a wholesale-presented block.
   */
  cabled: boolean;
}

export function OutputPort({ endpoint, label, outSlotLabel, cabled }: OutputPortProps) {
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const pointer = useEndpointPointer(endpoint);

  const classNames = ["port"];
  if (outSlotLabel !== undefined) classNames.push("port--dual");
  if (!cabled) classNames.push("port--uncabled");
  const hoverClass = hoverModifier("port", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      {...pointer}
    >
      <span className="port__number">{label}</span>
      {outSlotLabel !== undefined && (
        <span className="port__aes50">{outSlotLabel}</span>
      )}
      {isHoveredEndpoint(hoverStatus) && (
        <EndpointTooltip endpoint={endpoint} pinned={hoverStatus === "pinned"} />
      )}
    </div>
  );
}
