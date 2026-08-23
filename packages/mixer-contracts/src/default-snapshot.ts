/**
 * The mock's realistic default snapshot (architecture.md §4).
 *
 * It mirrors `config/installation.yaml`: two 16-in stageboxes daisy-chained on
 * AES50-A, so bus channels 1–16 are Stagebox 1 and 17–32 are Stagebox 2. Most
 * channels are the straight `CH n ← AES50-A n` patch; the deviations are the
 * cases the UI has to get right and are marked inline:
 *
 * - **dual consumer** — CH23 and CH28 both take AES50-A 23 (Stagebox 2 input
 *   7), so one physical socket highlights two channel strips.
 * - **unmapped source** — CH29/CH30 come off the card; no physical input maps.
 * - **off** — CH32 has no source at all.
 *
 * AES50-A 28, 29, 30 and 32 are left unconsumed on purpose: stage sockets that
 * nothing is currently patched from are normal and must render fine.
 */

import type { MixerChannelState, MixerSourceRef } from "@x32/domain";
import { mixerChannelId } from "@x32/domain";

import type { MixerSnapshot } from "./client";

function aes50A(channel: number): MixerSourceRef {
  return { kind: "aes50", bus: "A", channel };
}

/** Channel names are max 12 chars on an X32 (docs/x32-protocol.md). */
const DEFAULT_CHANNELS: ReadonlyArray<{
  readonly name: string;
  readonly source: MixerSourceRef;
}> = [
  { name: "Kick In", source: aes50A(1) }, // CH1  · Stagebox 1 / 1
  { name: "Snare", source: aes50A(2) }, // CH2  · Stagebox 1 / 2
  { name: "Hi-Hat", source: aes50A(3) }, // CH3  · Stagebox 1 / 3
  { name: "Tom 1", source: aes50A(4) }, // CH4  · Stagebox 1 / 4
  { name: "Tom 2", source: aes50A(5) }, // CH5  · Stagebox 1 / 5
  { name: "OH L", source: aes50A(6) }, // CH6  · Stagebox 1 / 6
  { name: "OH R", source: aes50A(7) }, // CH7  · Stagebox 1 / 7
  { name: "Bass DI", source: aes50A(8) }, // CH8  · Stagebox 1 / 8
  { name: "Gtr Amp L", source: aes50A(9) }, // CH9  · Stagebox 1 / 9
  { name: "Gtr Amp R", source: aes50A(10) }, // CH10 · Stagebox 1 / 10
  { name: "Keys L", source: aes50A(11) }, // CH11 · Stagebox 1 / 11
  { name: "Keys R", source: aes50A(12) }, // CH12 · Stagebox 1 / 12
  { name: "Acoustic", source: aes50A(13) }, // CH13 · Stagebox 1 / 13
  { name: "Perc", source: aes50A(14) }, // CH14 · Stagebox 1 / 14
  { name: "Cajon", source: aes50A(15) }, // CH15 · Stagebox 1 / 15
  { name: "Spare 16", source: aes50A(16) }, // CH16 · Stagebox 1 / 16
  { name: "Vox Lead", source: aes50A(17) }, // CH17 · Stagebox 2 / 1
  { name: "Vox 2", source: aes50A(18) }, // CH18 · Stagebox 2 / 2
  { name: "Vox 3", source: aes50A(19) }, // CH19 · Stagebox 2 / 3
  { name: "Choir L", source: aes50A(20) }, // CH20 · Stagebox 2 / 4
  { name: "Choir R", source: aes50A(21) }, // CH21 · Stagebox 2 / 5
  { name: "Handheld 1", source: aes50A(22) }, // CH22 · Stagebox 2 / 6
  { name: "Podium", source: aes50A(23) }, // CH23 · Stagebox 2 / 7
  { name: "Handheld 2", source: aes50A(24) }, // CH24 · Stagebox 2 / 8
  { name: "Lav 1", source: aes50A(25) }, // CH25 · Stagebox 2 / 9
  { name: "Lav 2", source: aes50A(26) }, // CH26 · Stagebox 2 / 10
  { name: "Amb L", source: aes50A(27) }, // CH27 · Stagebox 2 / 11
  { name: "Podium Rec", source: aes50A(23) }, // CH28 · dual consumer with CH23
  { name: "Playback L", source: { kind: "card", input: 1 } }, // CH29 · unmapped
  { name: "Playback R", source: { kind: "card", input: 2 } }, // CH30 · unmapped
  { name: "Stage Talk", source: aes50A(31) }, // CH31 · Stagebox 2 / 15
  { name: "Spare 32", source: { kind: "off" } }, // CH32 · no source
];

/**
 * A fresh default snapshot per call — callers (and the mock) own the result and
 * may mutate it freely. Nothing is selected initially; a selection only ever
 * comes from the physical console.
 */
export function createDefaultMockSnapshot(): MixerSnapshot {
  const channels: MixerChannelState[] = DEFAULT_CHANNELS.map(
    (channel, index) => ({
      channel: mixerChannelId(index + 1),
      name: channel.name,
      source: { ...channel.source },
    }),
  );

  return { channels, selectedChannel: null };
}
