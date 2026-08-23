import { describe, expect, it } from "vitest";

import { formatMixerSource } from "./source";

describe("formatMixerSource", () => {
  it("names the AES50 bus and channel the console shows", () => {
    expect(formatMixerSource({ kind: "aes50", bus: "A", channel: 23 })).toBe(
      "AES50-A 23",
    );
    expect(formatMixerSource({ kind: "aes50", bus: "B", channel: 1 })).toBe(
      "AES50-B 1",
    );
  });

  it("names every mixer-internal source", () => {
    expect(formatMixerSource({ kind: "local", input: 12 })).toBe("Local 12");
    expect(formatMixerSource({ kind: "card", input: 5 })).toBe("Card 5");
    expect(formatMixerSource({ kind: "aux", input: 3 })).toBe("Aux 3");
    expect(formatMixerSource({ kind: "usb", side: "L" })).toBe("USB L");
    expect(formatMixerSource({ kind: "fx", ret: 2 })).toBe("FX 2");
    expect(formatMixerSource({ kind: "bus", bus: 7 })).toBe("Bus 7");
    expect(formatMixerSource({ kind: "talkback", which: "int" })).toBe(
      "Talkback INT",
    );
    expect(formatMixerSource({ kind: "talkback", which: "ext" })).toBe(
      "Talkback EXT",
    );
  });

  it("says OFF for a channel with no source", () => {
    expect(formatMixerSource({ kind: "off" })).toBe("OFF");
  });
});
