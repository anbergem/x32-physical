/**
 * One physical input socket — the shared atom of every panel and stagebox.
 *
 * It knows its `EndpointId` and nothing else: no topology, no route walking
 * (architecture.md §5). Hovering it publishes that id to the runtime slice;
 * what lights up as a result is decided by `selectHoverStatus` and
 * `selectSelectionStatus`, which read the precomputed route index. Selection
 * comes from the physical console (`selectedChannel` in the store) — this
 * component never sets it, only reads its effect.
 */

import type { EndpointId } from "@x32/domain";

import {
  selectHoverStatus,
  selectSelectionStatus,
  selectSetHoveredEndpoint,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier, selectionModifier } from "./highlight";

export interface InputPortProps {
  /** Domain identity of this socket; the handle for hover and highlighting. */
  endpoint: EndpointId;
  /** The number printed on the box or panel, e.g. `7`. */
  label: string;
  /**
   * Stagebox sockets carry a second identity: the AES50 channel the console
   * sees them as, e.g. `A23`. Panels have none.
   */
  aes50Label?: string;
}

export function InputPort({ endpoint, label, aes50Label }: InputPortProps) {
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const selectionStatus = useAppStore(selectSelectionStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);

  // Single composition point for the class list: one class per highlight
  // layer, so hover and selection join independently without touching the
  // markup below.
  const classNames = ["port"];
  if (aes50Label !== undefined) classNames.push("port--dual");
  const hoverClass = hoverModifier("port", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);
  const selectionClass = selectionModifier("port", selectionStatus);
  if (selectionClass !== null) classNames.push(selectionClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      // Element-level, not document-level: the hover ends exactly when the
      // pointer leaves this socket, whatever else is on the page.
      onMouseEnter={() => setHovered(endpoint)}
      onMouseLeave={() => setHovered(null)}
    >
      <span className="port__number">{label}</span>
      {aes50Label !== undefined && (
        <span className="port__aes50">{aes50Label}</span>
      )}
      {hoverStatus === "hovered" && <EndpointTooltip endpoint={endpoint} />}
    </div>
  );
}
