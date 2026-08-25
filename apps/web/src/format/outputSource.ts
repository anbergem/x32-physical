/**
 * Human-readable `MixerOutputSourceRef` (issue #11) — the output-side mirror
 * of `format/source.ts`'s `formatMixerSource`. Kept as its own function
 * rather than folded into that one: the two source unions are deliberately
 * unrelated types (architecture.md §3 "Mixer output routing model").
 */

import type { MixerOutputSourceRef } from "@x32/domain";

export function formatMixerOutputSource(source: MixerOutputSourceRef): string {
  switch (source.kind) {
    case "main":
      return source.side === "C" ? "M/C" : `Main ${source.side}`;
    case "bus":
      return `Bus ${source.bus}`;
    case "matrix":
      return `Matrix ${source.matrix}`;
    case "direct-out-channel":
      return `Direct Out CH${source.channel}`;
    case "direct-out-aux":
      return `Direct Out Aux ${source.aux}`;
    case "direct-out-fx":
      return `Direct Out FX ${source.ret}`;
    case "monitor":
      return `Monitor ${source.side}`;
    case "talkback":
      return "Talkback";
    case "off":
      return "OFF";
  }
}
