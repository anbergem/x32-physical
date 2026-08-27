/**
 * The popover shown on the endpoint the pointer is actually on — or the one
 * a tap pinned.
 *
 * Rendered *inside* that socket or strip and centred above it by plain CSS,
 * so it needs no portal and no library. It is `pointer-events: none`, so it
 * can never steal the mouseleave that clears the hover, and never absorbs a
 * tap meant for the socket underneath it.
 *
 * The one thing CSS alone cannot do is keep it on screen: a socket at the
 * edge of a 768px-wide tablet would push it off, and one in the top row
 * would push it under the sticky header. So it measures its anchor once per
 * render and applies a correction (`placeTooltip`, pure and tested) — the
 * only measurement in the schematic, and only ever for the single tooltip
 * that exists at a time.
 *
 * The slices it reads (`installation`, `routeIndex`, `channels`) all have
 * stable identities, so subscribing to them wholesale costs nothing.
 */

import type { EndpointId } from "@x32/domain";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { describeEndpoint } from "../format/tooltip";
import {
  selectChannels,
  selectDiscrepancies,
  selectInstallation,
  selectOutputRouteIndex,
  selectOutputs,
  selectRouteIndex,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { placeTooltip } from "./tooltipPlacement";
import type { TooltipPlacement } from "./tooltipPlacement";

/** Matches the `7px` offset in `.tooltip`'s CSS. */
const GAP = 7;
/** Clear of the sticky header (~41px) with room to breathe. */
const SAFE_TOP = 56;
/** Never closer than this to a viewport edge. */
const MARGIN = 8;

const CENTRED: TooltipPlacement = { shiftX: 0, below: false };

export function EndpointTooltip({
  endpoint,
  pinned = false,
}: {
  endpoint: EndpointId;
  /**
   * Whether this tooltip is held open by a click/tap rather than by the
   * pointer resting on the endpoint. Adds the one line telling the reader
   * how to get rid of it — without it, a pinned tooltip on a touch device
   * looks like the tool has frozen.
   */
  pinned?: boolean;
}) {
  const installation = useAppStore(selectInstallation);
  const routeIndex = useAppStore(selectRouteIndex);
  const channels = useAppStore(selectChannels);
  const discrepancies = useAppStore(selectDiscrepancies);
  const outputRouteIndex = useAppStore(selectOutputRouteIndex);
  const outputs = useAppStore(selectOutputs);

  const elementRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<TooltipPlacement>(CENTRED);

  const measure = useCallback(() => {
    const element = elementRef.current;
    const anchor = element?.parentElement;
    if (element === null || anchor === null || anchor === undefined) return;
    if (typeof window === "undefined") return;

    // Measured off the *anchor*, never off the tooltip's own corrected
    // position — that is what keeps this a single pass instead of a loop.
    const next = placeTooltip({
      anchor: anchor.getBoundingClientRect(),
      tooltip: { width: element.offsetWidth, height: element.offsetHeight },
      viewportWidth: window.innerWidth,
      safeTop: SAFE_TOP,
      gap: GAP,
      margin: MARGIN,
    });
    setPlacement((previous) =>
      previous.shiftX === next.shiftX && previous.below === next.below ? previous : next,
    );
  }, []);

  // Every render: the tooltip's own content can change under it (a channel
  // rename), which changes its width. The equality guard above makes the
  // common case a no-op.
  useLayoutEffect(measure);

  // A pinned tooltip outlives the gesture that opened it, so the page can
  // scroll or rotate while it is up.
  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const { title, lines } = describeEndpoint(endpoint, {
    installation,
    routeIndex,
    channels,
    discrepancies,
    outputRouteIndex,
    outputs,
  });

  const classNames = ["tooltip"];
  if (placement.below) classNames.push("tooltip--below");
  if (pinned) classNames.push("tooltip--pinned");

  return (
    <div
      ref={elementRef}
      className={classNames.join(" ")}
      role="tooltip"
      style={
        placement.shiftX === 0
          ? undefined
          : { transform: `translateX(calc(-50% + ${placement.shiftX}px))` }
      }
    >
      <span className="tooltip__title">{title}</span>
      {lines.map((line, index) => (
        <span className="tooltip__line" key={`${index}-${line}`}>
          {line}
        </span>
      ))}
      {pinned && (
        <span className="tooltip__pin-hint">Pinned — tap elsewhere to clear</span>
      )}
    </div>
  );
}
