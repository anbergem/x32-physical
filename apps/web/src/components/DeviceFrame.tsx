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
  outputs,
}: {
  kind: "panel" | "stagebox" | "console";
  label: string;
  /** Short static fact, e.g. socket count or the box's AES50 range. */
  meta: string;
  children: ReactNode;
  /**
   * A stagebox's outputs row (issue #11), rendered as its own labelled row
   * below the inputs grid — the box is one physical object with 16 in / 8
   * out, and the frame says so, rather than splitting outputs into a
   * separate area. `undefined` for a device with no outputs (every panel,
   * and a stagebox with none declared).
   */
  outputs?: ReactNode;
}) {
  return (
    <section className={`device device--${kind}`}>
      <header className="device__header">
        <span className="device__label">{label}</span>
        <span className="device__meta">{meta}</span>
      </header>
      <div className="device__ports">{children}</div>
      {outputs !== undefined && (
        <div className="device__outputs">
          <span className="device__outputs-label">OUT</span>
          <div className="device__ports">{outputs}</div>
        </div>
      )}
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
