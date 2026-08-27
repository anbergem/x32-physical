/**
 * One physical input socket — the shared atom of every panel and stagebox.
 *
 * It knows its `EndpointId` and nothing else: no topology, no route walking
 * (architecture.md §5). Hovering it publishes that id to the runtime slice —
 * or, on a touch device, tapping it pins that id there (`useEndpointPointer`);
 * what lights up as a result is decided by `selectHoverStatus` and
 * `selectSelectionStatus`, which read the precomputed route index. Selection
 * comes from the physical console (`selectedChannel` in the store) — this
 * component never sets it, only reads its effect.
 */

import type { EndpointId, SocketAnnotation } from "@x32/domain";

import { isMeterHot, meterBarHeightPercent } from "../format/meter";
import {
  selectDiagnosticStatus,
  selectHoverStatus,
  selectSelectionStatus,
  selectSocketMeterLevel,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { EndpointTooltip } from "./EndpointTooltip";
import {
  diagnosticModifier,
  hoverModifier,
  isHoveredEndpoint,
  selectionModifier,
} from "./highlight";
import { useEndpointPointer } from "./useEndpointPointer";

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
  /**
   * Declared knowledge (issue #12): this socket is physically broken or
   * deliberately unused. `undefined` for a normal socket — including one
   * that simply has nothing cabled to it, which is not the same thing.
   */
  socketAnnotation?: SocketAnnotation;
}

export function InputPort({
  endpoint,
  label,
  aes50Label,
  socketAnnotation,
}: InputPortProps) {
  const hoverStatus = useAppStore(selectHoverStatus(endpoint));
  const pointer = useEndpointPointer(endpoint);
  const selectionStatus = useAppStore(selectSelectionStatus(endpoint));
  const diagnosticStatus = useAppStore(selectDiagnosticStatus(endpoint));
  // The fourth, fastest state path (architecture.md §5): this socket's own
  // level and nothing else, so a meter tick rerenders only the sockets some
  // channel actually consumes, never the whole schematic.
  const meterLevel = useAppStore(selectSocketMeterLevel(endpoint));

  // Single composition point for the class list: one class per highlight
  // layer, so hover, selection and diagnostics join independently without
  // touching the markup below.
  const classNames = ["port"];
  if (aes50Label !== undefined) classNames.push("port--dual");
  if (socketAnnotation !== undefined) {
    classNames.push(`port--${socketAnnotation.status}`);
  }
  const hoverClass = hoverModifier("port", hoverStatus);
  if (hoverClass !== null) classNames.push(hoverClass);
  const selectionClass = selectionModifier("port", selectionStatus);
  if (selectionClass !== null) classNames.push(selectionClass);
  const diagnosticClass = diagnosticModifier("port", diagnosticStatus);
  if (diagnosticClass !== null) classNames.push(diagnosticClass);

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      {...pointer}
    >
      <span className="port__number">{label}</span>
      {/* A broken socket carries no AES50 sublabel — it reaches nothing. */}
      {aes50Label !== undefined && socketAnnotation === undefined && (
        <span className="port__aes50">{aes50Label}</span>
      )}
      {isHoveredEndpoint(hoverStatus) && (
        <EndpointTooltip endpoint={endpoint} pinned={hoverStatus === "pinned"} />
      )}
      {/* No data (null) -> no bar at all, zero layout change either way —
          the bar is absolutely positioned so it never shifts the socket's
          own content regardless of whether it's present. A broken/unused
          socket never carries a meter either — it is its own dead end. */}
      {meterLevel !== null && socketAnnotation === undefined && (
        <PortMeterBar level={meterLevel} />
      )}
    </div>
  );
}

function PortMeterBar({ level }: { level: number }) {
  const heightPercent = meterBarHeightPercent(level);
  const classNames = ["port__meter-fill"];
  if (isMeterHot(heightPercent)) classNames.push("port__meter-fill--hot");

  // Same track + fill split as `MixerChannel`'s `MeterBar` — see there.
  return (
    <span className="port__meter" aria-hidden="true">
      <span className={classNames.join(" ")} style={{ height: `${heightPercent}%` }} />
    </span>
  );
}
