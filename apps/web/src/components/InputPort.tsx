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

import type { PointerEvent as ReactPointerEvent } from "react";

import type { EndpointId, SocketAnnotation } from "@x32/domain";



import { isMeterHot, meterBarHeightPercent } from "../format/meter";
import { cableEndForEndpoint, cablingReasonFor } from "../installation/cabling";
import { addConnectionOperation } from "../installation/edits";
import {
  selectCablingFrom,
  selectCablingState,
  selectDiagnosticStatus,
  selectEditMode,
  selectInstallation,
  selectInstallationVersion,
  selectSetCablingFrom,
  selectSetEditingSocket,
  selectHoverStatus,
  selectSelectionStatus,
  selectSocketMeterLevel,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { useEditGateway } from "./editGatewayContext";
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
  // Edit mode (issue #28). `cabling.state` is "idle" whenever no cable is in
  // flight, so none of this changes how the schematic looks in normal use.
  const editMode = useAppStore(selectEditMode);
  const cablingState = useAppStore(selectCablingState(endpoint));
  const installation = useAppStore(selectInstallation);
  const cablingFrom = useAppStore(selectCablingFrom);
  const setCablingFrom = useAppStore(selectSetCablingFrom);
  const setEditingSocket = useAppStore(selectSetEditingSocket);
  const version = useAppStore(selectInstallationVersion);
  const gateway = useEditGateway();

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
  if (editMode && cablingState !== "idle") {
    // Availability is rendered, not merely enforced: an illegal target is
    // visibly out of reach before it is clicked, which is the whole point of
    // an editor over a spreadsheet (issue #28).
    classNames.push(`port--cable-${cablingState}`);
  }

  const end = editMode ? cableEndForEndpoint(endpoint) : null;

  /**
   * In edit mode a tap means "edit this socket", not "pin its route" — the
   * mode changes what the gesture is for, so the pin handler is replaced
   * rather than added to. Hover still works, so the schematic keeps
   * explaining itself while editing.
   */
  function onEditPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (end === null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();

    if (cablingFrom === null) {
      if (end.kind === "socket") setEditingSocket({ device: end.device, input: end.input });
      return;
    }
    if (cablingState !== "available") return;
    if (version === null || gateway === null) return;

    gateway.applyInstallationEdit(version, addConnectionOperation(cablingFrom, end));
    setCablingFrom(null);
  }

  const interaction = editMode
    ? {
        onPointerEnter: pointer.onPointerEnter,
        onPointerLeave: pointer.onPointerLeave,
        onPointerUp: onEditPointerUp,
      }
    : pointer;

  return (
    <div
      className={classNames.join(" ")}
      data-endpoint={endpoint}
      data-cabling={editMode && cablingState !== "idle" ? cablingState : undefined}
      title={
        editMode && cablingState === "unavailable"
          ? (cablingReasonFor(installation, cablingFrom, endpoint) ?? undefined)
          : undefined
      }
      {...interaction}
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
