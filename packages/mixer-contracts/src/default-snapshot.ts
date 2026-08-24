/**
 * The mock's realistic default snapshot (architecture.md §4).
 *
 * Faithful to the venue's real patch sheet ("Betania Lydsystem - Inputs",
 * docs/installation.md) and to `config/installation.yaml`: two 16-in
 * stageboxes daisy-chained on AES50-A, so bus channels 1–16 are Stagebox V
 * and 17–32 are Stagebox H. The console's own local inputs 1–3 (Bøyle,
 * Håndholdt 1/2) carry CH1–CH3.
 *
 * AES50-A 7, 10 and 11 are left unconsumed on purpose, matching the sheet —
 * stage sockets that nothing is currently patched from are normal and must
 * render fine; they're also good hover-demo material.
 *
 * Edge cases (a source feeding two channels, an unmapped/card source, an OFF
 * channel) are deliberately absent here — the real patch sheet has none of
 * them. Tests that need those cases build their own local fixture snapshots
 * (e.g. via `simulateSourceChange`, or by cloning and overriding this
 * snapshot) rather than leaning on the default.
 */

import type { MixerChannelState, MixerSourceRef } from "@x32/domain";
import { mixerChannelId } from "@x32/domain";

import type { MixerSnapshot } from "./client";

function aes50A(channel: number): MixerSourceRef {
  return { kind: "aes50", bus: "A", channel };
}

function local(input: number): MixerSourceRef {
  return { kind: "local", input };
}

/** Channel names are max 12 chars on an X32 (docs/x32-protocol.md). */
const DEFAULT_CHANNELS: ReadonlyArray<{
  readonly name: string;
  readonly source: MixerSourceRef;
}> = [
  { name: "Bøyle", source: local(1) }, // CH1  · console local input 1
  { name: "Håndholdt 1", source: local(2) }, // CH2  · console local input 2
  { name: "Håndholdt 2", source: local(3) }, // CH3  · console local input 3
  { name: "Vok Piano", source: aes50A(16) }, // CH4  · Stagebox V / 16
  { name: "Vokal V1", source: aes50A(1) }, // CH5  · Stagebox V / 1
  { name: "Vokal V2", source: aes50A(2) }, // CH6  · Stagebox V / 2
  { name: "Vokal V3", source: aes50A(3) }, // CH7  · Stagebox V / 3
  { name: "Vokal V4", source: aes50A(4) }, // CH8  · Stagebox V / 4
  { name: "Vokal V5", source: aes50A(5) }, // CH9  · Stagebox V / 5
  { name: "Vokal V6", source: aes50A(6) }, // CH10 · Stagebox V / 6
  { name: "Vokal H1", source: aes50A(18) }, // CH11 · Stagebox H / 2
  { name: "Vokal H2", source: aes50A(19) }, // CH12 · Stagebox H / 3
  { name: "Vokal H3", source: aes50A(20) }, // CH13 · Stagebox H / 4
  { name: "Vokal H4", source: aes50A(21) }, // CH14 · Stagebox H / 5
  { name: "Vokal H5", source: aes50A(22) }, // CH15 · Stagebox H / 6
  { name: "Vokal H6", source: aes50A(23) }, // CH16 · Stagebox H / 7
  { name: "Piano V", source: aes50A(14) }, // CH17 · Stagebox V / 14
  { name: "Piano H", source: aes50A(15) }, // CH18 · Stagebox V / 15
  { name: "Bass DI VB", source: aes50A(9) }, // CH19 · Stagebox V / 9
  { name: "DI HB", source: aes50A(17) }, // CH20 · Stagebox H / 1
  { name: "DI VF", source: aes50A(8) }, // CH21 · Stagebox V / 8
  { name: "DI HF", source: aes50A(24) }, // CH22 · Stagebox H / 8
  { name: "Aux Scene L", source: aes50A(12) }, // CH23 · Stagebox V / 12
  { name: "Aux Scene R", source: aes50A(13) }, // CH24 · Stagebox V / 13
  { name: "Click", source: aes50A(25) }, // CH25 · Stagebox H / 9
  { name: "Stortromme", source: aes50A(26) }, // CH26 · Stagebox H / 10
  { name: "Skarp", source: aes50A(27) }, // CH27 · Stagebox H / 11
  { name: "Hihat", source: aes50A(28) }, // CH28 · Stagebox H / 12
  { name: "Tam 1", source: aes50A(29) }, // CH29 · Stagebox H / 13
  { name: "Tam 2", source: aes50A(30) }, // CH30 · Stagebox H / 14
  { name: "OH V", source: aes50A(31) }, // CH31 · Stagebox H / 15
  { name: "OH H", source: aes50A(32) }, // CH32 · Stagebox H / 16
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
