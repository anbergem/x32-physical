import type { MixerOutputSourceRef } from "@x32/domain";
import { mixerChannelId } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { formatMixerOutputSource } from "./outputSource";

describe("formatMixerOutputSource", () => {
  const table: Array<[MixerOutputSourceRef, string]> = [
    [{ kind: "main", side: "L" }, "Main L"],
    [{ kind: "main", side: "R" }, "Main R"],
    [{ kind: "main", side: "C" }, "M/C"],
    [{ kind: "bus", bus: 3 }, "Bus 3"],
    [{ kind: "matrix", matrix: 1 }, "Matrix 1"],
    [{ kind: "direct-out-channel", channel: mixerChannelId(12) }, "Direct Out CH12"],
    [{ kind: "direct-out-aux", aux: 2 }, "Direct Out Aux 2"],
    [{ kind: "direct-out-fx", ret: 1 }, "Direct Out FX 1"],
    [{ kind: "monitor", side: "L" }, "Monitor L"],
    [{ kind: "monitor", side: "R" }, "Monitor R"],
    [{ kind: "talkback" }, "Talkback"],
    [{ kind: "off" }, "OFF"],
  ];

  it.each(table)("formats %j as %s", (source, expected) => {
    expect(formatMixerOutputSource(source)).toBe(expected);
  });
});
