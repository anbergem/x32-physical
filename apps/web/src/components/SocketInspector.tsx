/**
 * The inspector for a socket selected in edit mode (issue #28).
 *
 * A socket's editable facts are different from a device's — its annotation,
 * and what it is cabled to — so it gets its own panel rather than a device
 * inspector with conditional fields. The two are never open at once.
 *
 * Three rules this panel encodes, all of them the domain's:
 *
 * - **Annotated and cabled are mutually exclusive.** A cabled socket is not
 *   offered an annotation, and an annotated one is not offered a cable —
 *   taught by the absence of the control rather than by a rejection.
 * - **Uncabling states its consequence** in the installation's terms ("Stagebox
 *   H input 4 will have no source"), never "connection removed".
 * - **A rejection is shown verbatim**, never swallowed or retried.
 */

import type { DeviceId } from "@x32/domain";
import { useEffect, useMemo, useState } from "react";

import type { GatewayMode, MixerGateway } from "../gateway/mixerGateway";
import {
  cablesTouchingSocket,
  canStartCable,
  describeUncableConsequence,
} from "../installation/cabling";
import { removeConnectionOperation, socketAnnotationOperation } from "../installation/edits";
import {
  selectDevice,
  selectEditingSocket,
  selectInstallationEditError,
  selectInstallationVersion,
  selectInstallation,
  selectSetCablingFrom,
  selectSetEditingSocket,
  selectSocketAnnotation,
} from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function SocketInspector({
  gateway,
  mode,
}: {
  gateway: MixerGateway;
  mode: GatewayMode;
}) {
  const editingSocket = useAppStore(selectEditingSocket);

  if (editingSocket === null) return null;

  // Keyed so switching sockets remounts with that socket's own drafts rather
  // than carrying a half-typed note across to a different one.
  return (
    <SocketInspectorPanel
      key={`${editingSocket.device}:${editingSocket.input}`}
      device={editingSocket.device}
      input={editingSocket.input}
      gateway={gateway}
      mode={mode}
    />
  );
}

function SocketInspectorPanel({
  device,
  input,
  gateway,
  mode,
}: {
  device: DeviceId;
  input: number;
  gateway: MixerGateway;
  mode: GatewayMode;
}) {
  const deviceState = useAppStore(selectDevice(device));
  const annotation = useAppStore(selectSocketAnnotation(device, input));
  const installation = useAppStore(selectInstallation);
  const cables = useMemo(
    () => cablesTouchingSocket(installation, device, input),
    [installation, device, input],
  );
  const version = useAppStore(selectInstallationVersion);
  const editError = useAppStore(selectInstallationEditError);
  const setEditingSocket = useAppStore(selectSetEditingSocket);
  const setCablingFrom = useAppStore(selectSetCablingFrom);

  const [noteDraft, setNoteDraft] = useState(annotation?.note ?? "");

  useEffect(() => {
    setNoteDraft(annotation?.note ?? "");
  }, [annotation?.note]);

  const cabled = cables.length > 0;

  function send(operation: Parameters<MixerGateway["applyInstallationEdit"]>[1] | null): void {
    if (operation === null || version === null) return;
    gateway.applyInstallationEdit(version, operation);
  }

  function setStatus(status: "broken" | "unused" | null): void {
    send(
      socketAnnotationOperation(device, input, annotation, {
        status,
        note: noteDraft,
      }),
    );
  }

  return (
    <aside className="inspector" aria-label={`Edit socket ${input}`}>
      <header className="inspector__header">
        <span className="inspector__title">
          {deviceState?.label ?? device} — socket {input}
        </span>
        <button
          type="button"
          className="inspector__close"
          aria-label="Close inspector"
          onClick={() => setEditingSocket(null)}
        >
          ×
        </button>
      </header>

      {/* Cabling and annotation are mutually exclusive, so only one of the
          two sections below is ever offered. */}
      {cabled ? (
        <section className="inspector__section">
          <span className="inspector__field-name">Cabled to</span>
          {cables.map((cable, index) => (
            <div key={index} className="inspector__cable">
              <p className="inspector__cable-text">
                {describeUncableConsequence(installation, cable.from, cable.to)}
              </p>
              <button
                type="button"
                onClick={() => send(removeConnectionOperation(cable.from, cable.to))}
              >
                Uncable
              </button>
            </div>
          ))}
        </section>
      ) : (
        <section className="inspector__section">
          <span className="inspector__field-name">Status</span>
          <div className="inspector__choices">
            <button
              type="button"
              aria-pressed={annotation === undefined}
              onClick={() => setStatus(null)}
            >
              Normal
            </button>
            <button
              type="button"
              aria-pressed={annotation?.status === "broken"}
              onClick={() => setStatus("broken")}
            >
              Broken
            </button>
            <button
              type="button"
              aria-pressed={annotation?.status === "unused"}
              onClick={() => setStatus("unused")}
            >
              Unused
            </button>
          </div>

          {annotation !== undefined && (
            <label className="inspector__field">
              <span className="inspector__field-name">Note</span>
              <input
                type="text"
                className="inspector__input"
                placeholder="Why?"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onBlur={() => setStatus(annotation.status)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setStatus(annotation.status);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setNoteDraft(annotation.note ?? "");
                  }
                }}
              />
            </label>
          )}

          {/* Offered only when this socket can actually start a cable: an
              annotated one reaches nothing, and a stagebox or console input
              receives signal rather than feeding it. Both rules are taught by
              the absence of the control, not by a later rejection. */}
          {canStartCable(installation, { kind: "socket", device, input }).available && (
            <button
              type="button"
              className="inspector__action"
              onClick={() => {
                setCablingFrom({ kind: "socket", device, input });
                setEditingSocket(null);
              }}
            >
              Cable from here…
            </button>
          )}
        </section>
      )}

      {editError !== null && <p className="inspector__error">{editError}</p>}

      {mode === "mock" && (
        <p className="inspector__note">
          Simulated data: edits stay in this tab and are never written to
          installation.yaml.
        </p>
      )}
    </aside>
  );
}
