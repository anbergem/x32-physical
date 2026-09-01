/**
 * The banner shown while a cable is half-made (issue #28).
 *
 * A half-made cable is a mode, and an unlabelled mode is a trap: the
 * schematic suddenly greys out most of itself and the operator has no way to
 * tell why, or how to get out. So the banner names what is in flight, says
 * what to do next, and carries an always-reachable Cancel — Escape does the
 * same thing, but a visible control is what makes it discoverable on a
 * tablet, where there is no Escape key at all.
 */

import { useEffect } from "react";

import { selectCablingFrom, selectInstallation, selectSetCablingFrom } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function CablingBanner() {
  const cablingFrom = useAppStore(selectCablingFrom);
  const setCablingFrom = useAppStore(selectSetCablingFrom);
  const installation = useAppStore(selectInstallation);

  useEffect(() => {
    if (cablingFrom === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      // Cancelling a half-made cable takes precedence over the app-wide
      // Escape (which drops a pinned route): the operator is unmistakably in
      // this mode, so this is what they mean.
      event.stopPropagation();
      setCablingFrom(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cablingFrom, setCablingFrom]);

  if (cablingFrom === null) return null;

  const label = (id: string): string =>
    installation.devices.find((device) => device.id === id)?.label ?? id;

  const source =
    cablingFrom.kind === "socket"
      ? `${label(cablingFrom.device)} socket ${cablingFrom.input}`
      : cablingFrom.kind === "device-output"
        ? `${label(cablingFrom.device)} output ${cablingFrom.output}`
        : cablingFrom.kind === "console-output"
          ? `console output ${cablingFrom.output}`
          : label(cablingFrom.device);

  return (
    <div className="cabling-banner" role="status">
      <span className="cabling-banner__text">
        Cabling from <strong>{source}</strong> — choose a highlighted target.
      </span>
      <button
        type="button"
        className="cabling-banner__cancel"
        onClick={() => setCablingFrom(null)}
      >
        Cancel
      </button>
    </div>
  );
}
