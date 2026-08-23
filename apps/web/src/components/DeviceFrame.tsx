/**
 * Shared chrome for a device box: a caption line plus a grid of sockets.
 * Used by both `PhysicalInputPanel` and `Stagebox` so they stay visually
 * identical apart from what their sockets say.
 */

import type { DeviceId } from "@x32/domain";
import type { ReactNode } from "react";

export function DeviceFrame({
  kind,
  label,
  meta,
  children,
}: {
  kind: "panel" | "stagebox";
  label: string;
  /** Short static fact, e.g. socket count or the box's AES50 range. */
  meta: string;
  children: ReactNode;
}) {
  return (
    <section className={`device device--${kind}`}>
      <header className="device__header">
        <span className="device__label">{label}</span>
        <span className="device__meta">{meta}</span>
      </header>
      <div className="device__ports">{children}</div>
    </section>
  );
}

/**
 * The hard-coded layout named a device `installation.yaml` does not declare
 * (MVP layout is hard-coded JSX — CLAUDE.md invariant 6). Say so in place
 * rather than crashing or silently dropping part of the schematic.
 */
export function MissingDevice({ deviceId }: { deviceId: DeviceId }) {
  return (
    <section className="device device--missing">
      <header className="device__header">
        <span className="device__label">{deviceId}</span>
        <span className="device__meta">not in installation.yaml</span>
      </header>
    </section>
  );
}

/** `1 … inputs`, the socket numbers as printed on the hardware. */
export function socketNumbers(inputs: number): number[] {
  if (!Number.isInteger(inputs) || inputs < 1) return [];
  return Array.from({ length: inputs }, (_, index) => index + 1);
}
