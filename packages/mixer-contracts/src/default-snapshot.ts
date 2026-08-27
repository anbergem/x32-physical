/**
 * The mock's realistic default snapshot (architecture.md §4).
 *
 * Channel names are a generic band/speech input list — mock mode is the first
 * thing anyone cloning this repo sees, so it demonstrates the tool rather than
 * publishing one venue's patch list. The *routing* matches
 * `config/installation.yaml`: two 16-in stageboxes daisy-chained on AES50-A,
 * so bus channels 1–16 are the first stagebox and 17–32 the second. The
 * console's own local inputs 1–3 carry CH1–CH3.
 *
 * AES50-A 7, 10 and 11 are left unconsumed on purpose — stage sockets that
 * nothing is currently patched from are normal and must render fine; they're
 * also good hover-demo material.
 *
 * The fixture's shape is one source per channel, with no synthetic edge cases:
 * no source feeding two channels, no unmapped/card source, no OFF channel.
 * Tests that need those cases build their own local fixture snapshots (e.g.
 * via `simulateSourceChange`, or by cloning and overriding this snapshot)
 * rather than leaning on the default.
 */

import type {
  Aes50Chain,
  Aes50LinkState,
  MixerChannelState,
  MixerOutputSourceRef,
  MixerOutputState,
  MixerSourceRef,
} from "@x32/domain";
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
  { name: "Lectern", source: local(1) }, // CH1  · console local input 1
  { name: "Handheld 1", source: local(2) }, // CH2  · console local input 2
  { name: "Handheld 2", source: local(3) }, // CH3  · console local input 3
  { name: "Vox Lead", source: aes50A(16) }, // CH4  · Stagebox V / 16
  { name: "Vox 1", source: aes50A(1) }, // CH5  · Stagebox V / 1
  { name: "Vox 2", source: aes50A(2) }, // CH6  · Stagebox V / 2
  { name: "Vox 3", source: aes50A(3) }, // CH7  · Stagebox V / 3
  { name: "Vox 4", source: aes50A(4) }, // CH8  · Stagebox V / 4
  { name: "Vox 5", source: aes50A(5) }, // CH9  · Stagebox V / 5
  { name: "Vox 6", source: aes50A(6) }, // CH10 · Stagebox V / 6
  { name: "Speech 1", source: aes50A(18) }, // CH11 · Stagebox H / 2
  { name: "Speech 2", source: aes50A(19) }, // CH12 · Stagebox H / 3
  { name: "Speech 3", source: aes50A(20) }, // CH13 · Stagebox H / 4
  { name: "Speech 4", source: aes50A(21) }, // CH14 · Stagebox H / 5
  { name: "Speech 5", source: aes50A(22) }, // CH15 · Stagebox H / 6
  { name: "Speech 6", source: aes50A(23) }, // CH16 · Stagebox H / 7
  { name: "Keys L", source: aes50A(14) }, // CH17 · Stagebox V / 14
  { name: "Keys R", source: aes50A(15) }, // CH18 · Stagebox V / 15
  { name: "Bass DI", source: aes50A(9) }, // CH19 · Stagebox V / 9
  { name: "Gtr DI 1", source: aes50A(17) }, // CH20 · Stagebox H / 1
  { name: "Gtr DI 2", source: aes50A(8) }, // CH21 · Stagebox V / 8
  { name: "Gtr DI 3", source: aes50A(24) }, // CH22 · Stagebox H / 8
  { name: "Playback L", source: aes50A(12) }, // CH23 · Stagebox V / 12
  { name: "Playback R", source: aes50A(13) }, // CH24 · Stagebox V / 13
  { name: "Click", source: aes50A(25) }, // CH25 · Stagebox H / 9
  { name: "Kick", source: aes50A(26) }, // CH26 · Stagebox H / 10
  { name: "Snare", source: aes50A(27) }, // CH27 · Stagebox H / 11
  { name: "Hi-Hat", source: aes50A(28) }, // CH28 · Stagebox H / 12
  { name: "Tom 1", source: aes50A(29) }, // CH29 · Stagebox H / 13
  { name: "Tom 2", source: aes50A(30) }, // CH30 · Stagebox H / 14
  { name: "OH L", source: aes50A(31) }, // CH31 · Stagebox H / 15
  { name: "OH R", source: aes50A(32) }, // CH32 · Stagebox H / 16
];

function matrix(n: number): MixerOutputSourceRef {
  return { kind: "matrix", matrix: n };
}

function bus(n: number): MixerOutputSourceRef {
  return { kind: "bus", bus: n };
}

function main(side: "L" | "R" | "C"): MixerOutputSourceRef {
  return { kind: "main", side };
}

const OFF: MixerOutputSourceRef = { kind: "off" };

/**
 * The venue's real output patch (docs/venue-betania.md §"Output topology",
 * "Betania Lydsystem - Outputs"): Out 1/2 feed the console's own XLRs
 * (Sidesal, Vip Rom) from Matrix 1/2; Outs 6–8 and 11–13 feed the stagebox
 * blocks; 14–16 carry the M/C and Main L/R signal pair. Outs 3, 4, 5, 9, 10
 * are unused at this venue.
 */
const DEFAULT_OUTPUT_SOURCES: ReadonlyArray<MixerOutputSourceRef> = [
  matrix(1), // Out 1  · Sidesal
  matrix(2), // Out 2  · Vip Rom
  OFF, // Out 3
  OFF, // Out 4
  OFF, // Out 5
  bus(5), // Out 6  · Bak Høyre
  bus(3), // Out 7  · Piano Høyre
  bus(2), // Out 8  · Front Høyre
  OFF, // Out 9
  OFF, // Out 10
  bus(4), // Out 11 · Venstre Bak
  bus(3), // Out 12 · Piano Venstre
  bus(1), // Out 13 · Front Venstre
  main("C"), // Out 14 · Sub
  main("L"), // Out 15 · Main Left
  main("R"), // Out 16 · Main Right
];

/**
 * A fresh copy per call, matching `DEFAULT_CHANNELS`' discipline — the mock
 * mirrors the desk's real output patch (docs/venue-betania.md).
 */
function defaultOutputs(): MixerOutputState[] {
  return DEFAULT_OUTPUT_SOURCES.map((source, index) => ({
    output: index + 1,
    source: { ...source },
  }));
}

/**
 * A healthy default AES50 state (issue #17): both buses clear, locked (the
 * console reports lock once the link is stable). Matches the venue's real
 * cascade (docs/installation.md) — two 16-in boxes on AES50-A, AES50-B
 * unused — so the mock's default renders no warning, same as a healthy
 * console would.
 */
function defaultAes50LinkState(): Aes50LinkState {
  return {
    buses: [
      { bus: "A", audioError: false, auxError: false },
      { bus: "B", audioError: false, auxError: false },
    ],
    locked: true,
  };
}

/**
 * Two detected boxes on AES50-A, matching `config/installation.yaml`'s
 * `stagebox-1`/`stagebox-2` (both 16-in, model unknown at the venue —
 * `"S16"` here is the mock's stand-in). AES50-B stays empty: unused.
 */
function defaultAes50Chain(): Aes50Chain[] {
  return [
    {
      bus: "A",
      boxes: [
        { position: 1, model: "S16", rawLetter: "A" },
        { position: 2, model: "S16", rawLetter: "A" },
      ],
    },
    { bus: "B", boxes: [] },
  ];
}

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

  return {
    channels,
    outputs: defaultOutputs(),
    selectedChannel: null,
    aes50LinkState: defaultAes50LinkState(),
    aes50Chain: defaultAes50Chain(),
  };
}
