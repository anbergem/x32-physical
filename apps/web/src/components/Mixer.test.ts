import { describe, expect, it } from "vitest";

import { mixerRows } from "./Mixer";

describe("mixerRows", () => {
  it("splits into 2 rows of 16 covering channels 1-32 in order", () => {
    const rows = mixerRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(16);
    expect(rows[1]).toHaveLength(16);
    expect(rows[0]).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(rows[1]).toEqual(Array.from({ length: 16 }, (_, i) => i + 17));
  });
});
