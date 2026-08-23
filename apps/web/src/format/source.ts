/**
 * Human-readable `MixerSourceRef`.
 *
 * One place, because the same wording has to appear anywhere a source is shown
 * (hover tooltips now, the selected-channel readout and the mock control
 * surface later). The forms are short and unambiguous rather than verbatim
 * console strings: an operator reading "Card 5" next to a schematic knows
 * exactly which of the X32's inputs is meant.
 */

import type { MixerSourceRef } from "@x32/domain";

export function formatMixerSource(source: MixerSourceRef): string {
  switch (source.kind) {
    case "aes50":
      return `AES50-${source.bus} ${source.channel}`;
    case "local":
      return `Local ${source.input}`;
    case "card":
      return `Card ${source.input}`;
    case "aux":
      return `Aux ${source.input}`;
    case "usb":
      return `USB ${source.side}`;
    case "fx":
      return `FX ${source.ret}`;
    case "bus":
      return `Bus ${source.bus}`;
    case "talkback":
      return `Talkback ${source.which === "int" ? "INT" : "EXT"}`;
    case "off":
      return "OFF";
  }
}
