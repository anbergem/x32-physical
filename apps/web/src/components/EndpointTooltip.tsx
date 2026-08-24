/**
 * The popover shown on the endpoint the pointer is actually on.
 *
 * Rendered *inside* the hovered socket or strip and positioned with plain CSS,
 * so it needs no measurement, no portal and no library. It is
 * `pointer-events: none`, so it can never steal the mouseleave that clears the
 * hover.
 *
 * Only one of these exists at a time, and the slices it reads
 * (`installation`, `routeIndex`, `channels`) all have stable identities — so
 * subscribing to them wholesale costs nothing.
 */

import type { EndpointId } from "@x32/domain";

import { describeEndpoint } from "../format/tooltip";
import {
  selectChannels,
  selectDiscrepancies,
  selectInstallation,
  selectRouteIndex,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function EndpointTooltip({ endpoint }: { endpoint: EndpointId }) {
  const installation = useAppStore(selectInstallation);
  const routeIndex = useAppStore(selectRouteIndex);
  const channels = useAppStore(selectChannels);
  const discrepancies = useAppStore(selectDiscrepancies);

  const { title, lines } = describeEndpoint(endpoint, {
    installation,
    routeIndex,
    channels,
    discrepancies,
  });

  return (
    <div className="tooltip" role="tooltip">
      <span className="tooltip__title">{title}</span>
      {lines.map((line, index) => (
        <span className="tooltip__line" key={`${index}-${line}`}>
          {line}
        </span>
      ))}
    </div>
  );
}
