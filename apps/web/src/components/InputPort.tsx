/**
 * One physical input socket — the shared atom of every panel and stagebox.
 *
 * It knows its `EndpointId` and nothing else: no topology, no route lookups
 * (architecture.md §5). Plan steps 7–8 attach hover handlers and a highlight
 * class at the single composition point below.
 */

import type { EndpointId } from "@x32/domain";

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
  // Single composition point for the class list: the hover / selected
  // highlight classes of plan steps 7–8 slot in here, markup untouched.
  const classNames = ["port"];
  if (aes50Label !== undefined) classNames.push("port--dual");

  return (
    <div className={classNames.join(" ")} data-endpoint={endpoint}>
      <span className="port__number">{label}</span>
      {aes50Label !== undefined && (
        <span className="port__aes50">{aes50Label}</span>
      )}
    </div>
  );
}
