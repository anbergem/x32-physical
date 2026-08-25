/**
 * The console's 16 output slots, one row (issue #11) — below the input
 * channels, mirroring how `Mixer` lays out the 32 input channels.
 */

import { MIXER_OUTPUT_COUNT } from "@x32/domain";

import { MixerOutputSlot } from "./MixerOutputSlot";

const OUTPUTS: number[] = Array.from(
  { length: MIXER_OUTPUT_COUNT },
  (_, index) => index + 1,
);

export function MixerOutputs() {
  return (
    <section className="mixer-outputs">
      <header className="mixer-outputs__header">
        <span className="mixer-outputs__label">X32 output slots</span>
        <span className="mixer-outputs__meta">Out 1–{MIXER_OUTPUT_COUNT}</span>
      </header>
      <div className="mixer-outputs__row">
        {OUTPUTS.map((output) => (
          <MixerOutputSlot key={output} output={output} />
        ))}
      </div>
    </section>
  );
}
