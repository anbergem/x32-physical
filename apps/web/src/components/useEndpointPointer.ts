/**
 * The pointer props every endpoint element shares — one hook so the five
 * components that render an endpoint (`InputPort`, `OutputPort`,
 * `MixerChannel`, `MixerOutputSlot`, `Destination`) cannot drift apart in
 * how they treat a mouse versus a finger.
 *
 * All the judgement lives in `resolveEndpointPointerAction`, which is pure
 * and tested; this only wires its result to the two store actions. Both
 * actions have stable identities, so subscribing to them never rerenders.
 */

import type { EndpointId } from "@x32/domain";
import type { PointerEvent, PointerEventHandler } from "react";

import {
  selectSetHoveredEndpoint,
  selectToggleEndpointPin,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

import { resolveEndpointPointerAction } from "./endpointPointer";

export interface EndpointPointerProps {
  onPointerEnter: PointerEventHandler<HTMLDivElement>;
  onPointerLeave: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
}

export function useEndpointPointer(endpoint: EndpointId): EndpointPointerProps {
  const setHovered = useAppStore(selectSetHoveredEndpoint);
  const togglePin = useAppStore(selectToggleEndpointPin);

  function apply(phase: "enter" | "leave" | "up", event: PointerEvent<HTMLDivElement>): void {
    // A right- or middle-click is not a request to pin anything.
    if (phase === "up" && event.pointerType === "mouse" && event.button !== 0) return;

    switch (resolveEndpointPointerAction(phase, event.pointerType)) {
      case "hover":
        setHovered(endpoint);
        return;
      case "clear":
        setHovered(null);
        return;
      case "toggle-pin-keep-hover":
        togglePin(endpoint, true);
        return;
      case "toggle-pin-clear":
        togglePin(endpoint, false);
        return;
      case "ignore":
        return;
    }
  }

  return {
    onPointerEnter: (event) => apply("enter", event),
    onPointerLeave: (event) => apply("leave", event),
    onPointerUp: (event) => apply("up", event),
  };
}
