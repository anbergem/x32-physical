/**
 * One physical input socket — the shared atom of every panel and stagebox.
 *
 * It knows its `EndpointId` and nothing else: no topology, no route walking
 * (architecture.md §5). Hovering it publishes that id to the runtime slice;
 * what lights up as a result is decided by `selectHoverStatus`, which reads the
 * precomputed route index.
 */

import type { EndpointId } from "@x32/domain";

import { selectHoverStatus, selectSetHoveredEndpoint } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import { hoverModifier } from "./highlight";

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
  const status = useAppStore(selectHoverStatus(endpoint));
  const setHovered = useAppStore(selectSetHoveredEndpoint);

  // Single composition point for the class list: one class per highlight
  // layer, so step 8's selection modifier joins without touching the markup.
  const classNames = ["port"];
  if (aes50Label !== undefined) classNames.push("port--dual");
  const highlight = hoverModifier("port", status);
  if (highlight !== null) classNames.push(highlight);

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
      {status === "hovered" && <EndpointTooltip endpoint={endpoint} />}
    </div>
  );
}
