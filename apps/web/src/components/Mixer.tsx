/**
 * The console's 32 input channels, in two rows of 16 — the console's own
 * bank layout (`1-16`, `17-32`), which is the whole point of a schematic:
 * it should read like the desk. Deliberate (#15, reverting a 4x8 experiment
 * from 549d726) — do not "tidy" this back to four rows of 8.
 */

import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import type { MixerChannelId } from "@x32/domain";

import { MixerChannel } from "./MixerChannel";

const CHANNELS: MixerChannelId[] = Array.from(
  { length: MIXER_CHANNEL_COUNT },
  (_, index) => mixerChannelId(index + 1),
);

export const MIXER_ROW_LENGTH = 16;

/** Exported for testing without a DOM stack — see `Mixer.test.ts`. */
export function mixerRows(): MixerChannelId[][] {
  return Array.from(
    { length: MIXER_CHANNEL_COUNT / MIXER_ROW_LENGTH },
    (_, index) => CHANNELS.slice(index * MIXER_ROW_LENGTH, (index + 1) * MIXER_ROW_LENGTH),
  );
}

const ROWS: MixerChannelId[][] = mixerRows();

export function Mixer() {
  return (
    <section className="mixer">
      <header className="mixer__header">
        <span className="mixer__label">X32 input channels</span>
        <span className="mixer__meta">CH 1–{MIXER_CHANNEL_COUNT}</span>
      </header>
      {ROWS.map((row, index) => (
        <div className="mixer__row" key={`row-${index}`}>
          {row.map((channel) => (
            <MixerChannel key={channel} channel={channel} />
          ))}
        </div>
      ))}
    </section>
  );
}
