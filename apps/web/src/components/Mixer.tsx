/**
 * The console's 32 input channels, in four rows of 8 — the console's own
 * layout (its physical faders come in banks of 8), and a narrower footprint
 * than two rows of 16.
 */

import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import type { MixerChannelId } from "@x32/domain";

import { MixerChannel } from "./MixerChannel";

const CHANNELS: MixerChannelId[] = Array.from(
  { length: MIXER_CHANNEL_COUNT },
  (_, index) => mixerChannelId(index + 1),
);

const ROW_LENGTH = 8;
const ROWS: MixerChannelId[][] = Array.from(
  { length: MIXER_CHANNEL_COUNT / ROW_LENGTH },
  (_, index) => CHANNELS.slice(index * ROW_LENGTH, (index + 1) * ROW_LENGTH),
);

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
