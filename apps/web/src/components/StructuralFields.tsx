/**
 * The structural fields of a device — input/output counts, the AES50 mapping,
 * and the output block (issue #29).
 *
 * Kept out of `DeviceInspector` because the judgement here is different in
 * kind: the everyday fields are a label and a group, where a mistake is
 * cosmetic and obvious. These two —
 *
 *   `aes50.offset`, which decides what every socket on the box is called, and
 *   `outputBlock.start`, which decides what every one of its outs carries
 *
 * — fail *silently and totally*. Neither appears on any patch sheet, the
 * console reports the same channels either way, and a wrong value leaves a
 * schematic that looks entirely correct while pointing at the wrong socket.
 *
 * So every one of them is shown with its consequence spelled out as it is
 * typed ("inputs 1–16 → AES50-A 17–32"), and a collision with another box is
 * named before anything is saved. The human still declares the value: it is a
 * physical DIP switch, and inferring it from anything else would be exactly
 * the confident guess this tool exists to prevent.
 */

import type { Aes50Bus, Device } from "@x32/domain";
import { useState } from "react";
import type { ReactNode } from "react";

import type { DeviceFieldEdit } from "@x32/installation";

import type { MixerGateway } from "../gateway/mixerGateway";
import { deviceFieldOperation } from "../installation/edits";
import {
  aes50Collision,
  aes50RangeOverruns,
  describeAes50Range,
  describeOutputBlock,
  outputBlockOverruns,
} from "../installation/structuralEdit";
import { selectInstallation, selectInstallationVersion } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

export function StructuralFields({
  device,
  gateway,
}: {
  device: Device;
  gateway: MixerGateway;
}) {
  const installation = useAppStore(selectInstallation);
  const version = useAppStore(selectInstallationVersion);

  // A destination has no sockets of its own, so it has none of this.
  if (device.kind === "destination") return null;

  function send(edit: DeviceFieldEdit): void {
    if (version === null) return;
    gateway.applyInstallationEdit(version, deviceFieldOperation(device.id, edit));
  }

  const isStagebox = device.kind === "stagebox";
  const aes50 = device.aes50;

  return (
    <>
      <NumberField
        name="Inputs"
        value={device.inputs}
        min={1}
        onCommit={(value) => send({ field: "inputs", value })}
      />

      {isStagebox && aes50 !== undefined && (
        <>
          <label className="inspector__field">
            <span className="inspector__field-name">AES50 bus</span>
            <div className="inspector__choices">
              {(["A", "B"] as Aes50Bus[]).map((bus) => (
                <button
                  key={bus}
                  type="button"
                  aria-pressed={aes50.bus === bus}
                  onClick={() => send({ field: "aes50Bus", value: bus })}
                >
                  {bus}
                </button>
              ))}
            </div>
          </label>

          <NumberField
            name="AES50 offset"
            value={aes50.offset}
            min={0}
            hint="Set on the box itself — the channel its first input lands on, minus one."
            onCommit={(value) => send({ field: "aes50Offset", value })}
            preview={(draft) => (
              <RangePreview
                text={describeAes50Range(aes50.bus, draft, device.inputs)}
                problem={
                  aes50RangeOverruns(draft, device.inputs)
                    ? `That runs past AES50 channel 48 — a bus carries 48.`
                    : collisionMessage(installation, aes50.bus, draft, device)
                }
              />
            )}
          />

          <NumberField
            name="Outputs"
            value={device.outputs ?? 0}
            min={0}
            onCommit={(value) =>
              send({ field: "outputs", value: value === 0 ? null : value })
            }
          />

          {device.outputs !== undefined && (
            <NumberField
              name="Output block starts at"
              value={device.outputBlock?.start ?? 1}
              min={1}
              hint="Which console Out slot this box's first XLR out carries. Set on the box; OSC cannot report it."
              onCommit={(value) => send({ field: "outputBlockStart", value })}
              preview={(draft) => (
                <RangePreview
                  text={describeOutputBlock(draft, device.outputs ?? 0)}
                  problem={
                    outputBlockOverruns(draft, device.outputs ?? 0)
                      ? "That runs past Out 16 — the console has 16 out slots."
                      : null
                  }
                />
              )}
            />
          )}
        </>
      )}
    </>
  );
}

function collisionMessage(
  installation: Parameters<typeof aes50Collision>[0],
  bus: Aes50Bus,
  offset: number,
  device: Device,
): string | null {
  const clash = aes50Collision(installation, bus, offset, device.inputs, device.id);
  return clash === null
    ? null
    : `Those channels are already claimed by ${clash.label} — both boxes would be wrong.`;
}

function RangePreview({ text, problem }: { text: string | null; problem: string | null }) {
  if (problem !== null) return <p className="inspector__warning">{problem}</p>;
  if (text === null) return null;
  return <p className="inspector__preview">{text}</p>;
}

/**
 * A number field that commits on blur or Enter, never per keystroke — the
 * same rule as every other field here, for the same reason: a write storm
 * would churn the `.bak`, which is the only copy of the last-known-good file.
 *
 * `preview` renders live from the *draft*, not the stored value, so the
 * consequence updates while typing and a mistake is visible before it lands.
 */
function NumberField({
  name,
  value,
  min,
  hint,
  onCommit,
  preview,
}: {
  name: string;
  value: number;
  min: number;
  hint?: string;
  onCommit: (value: number) => void;
  preview?: (draft: number) => ReactNode;
}) {
  const [draft, setDraft] = useState(String(value));
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= min;

  function commit(): void {
    if (!valid || parsed === value) return;
    onCommit(parsed);
  }

  return (
    <label className="inspector__field">
      <span className="inspector__field-name">{name}</span>
      <input
        type="number"
        inputMode="numeric"
        className="inspector__input"
        value={draft}
        min={min}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            return;
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(String(value));
          }
        }}
      />
      {hint !== undefined && <p className="inspector__hint">{hint}</p>}
      {valid && preview?.(parsed)}
    </label>
  );
}

