import { describe, expect, it } from "vitest";

import { aes50Bus, deviceId, mixerChannelId } from "./ids";

describe("deviceId", () => {
  it("accepts kebab-case ids", () => {
    expect(deviceId("stagebox-1")).toBe("stagebox-1");
    expect(deviceId("front-left")).toBe("front-left");
    expect(deviceId("fl2")).toBe("fl2");
  });

  it.each(["", "Front-Left", "front left", "front:left", "-front", "front--left", "front-"])(
    "rejects %o",
    (value) => {
      expect(() => deviceId(value)).toThrow(/Invalid device id/);
    },
  );
});

describe("mixerChannelId", () => {
  it("accepts the 1-based 1–32 range", () => {
    expect(mixerChannelId(1)).toBe(1);
    expect(mixerChannelId(12)).toBe(12);
    expect(mixerChannelId(32)).toBe(32);
  });

  it.each([0, 33, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %o",
    (value) => {
      expect(() => mixerChannelId(value)).toThrow(/Invalid mixer channel/);
    },
  );
});

describe("aes50Bus", () => {
  it("accepts A and B", () => {
    expect(aes50Bus("A")).toBe("A");
    expect(aes50Bus("B")).toBe("B");
  });

  it.each(["", "a", "C", "AB"])("rejects %o", (value) => {
    expect(() => aes50Bus(value)).toThrow(/Invalid AES50 bus/);
  });
});
