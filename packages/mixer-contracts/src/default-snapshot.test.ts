import { MIXER_CHANNEL_COUNT } from "@x32/domain";
import { describe, expect, it } from "vitest";

import { createDefaultMockSnapshot } from "./default-snapshot";

describe("createDefaultMockSnapshot", () => {
  it("has exactly 32 channels, ids 1–32 in order", () => {
    const { channels } = createDefaultMockSnapshot();

    expect(channels).toHaveLength(MIXER_CHANNEL_COUNT);
    expect(channels.map((channel) => channel.channel)).toEqual(
      Array.from({ length: MIXER_CHANNEL_COUNT }, (_, index) => index + 1),
    );
  });

  it("names every channel within the X32's 12-character limit", () => {
    for (const channel of createDefaultMockSnapshot().channels) {
      expect(channel.name.length).toBeGreaterThan(0);
      expect(channel.name.length).toBeLessThanOrEqual(12);
    }
  });

  it("starts with nothing selected", () => {
    expect(createDefaultMockSnapshot().selectedChannel).toBeNull();
  });

  it("exercises both stageboxes on AES50-A", () => {
    const busChannels: number[] = [];
    for (const channel of createDefaultMockSnapshot().channels) {
      if (channel.source.kind !== "aes50") continue;
      expect(channel.source.bus).toBe("A");
      busChannels.push(channel.source.channel);
    }

    // Stagebox 1 is AES50-A 1–16, stagebox 2 (cascaded) is 17–32.
    expect(busChannels.some((channel) => channel >= 1 && channel <= 16)).toBe(
      true,
    );
    expect(busChannels.some((channel) => channel >= 17 && channel <= 32)).toBe(
      true,
    );
    expect(busChannels.every((channel) => channel >= 1 && channel <= 48)).toBe(
      true,
    );
  });

  it("includes one AES50 source consumed by two channels", () => {
    const consumers = new Map<number, number>();
    for (const channel of createDefaultMockSnapshot().channels) {
      if (channel.source.kind !== "aes50") continue;
      const busChannel = channel.source.channel;
      consumers.set(busChannel, (consumers.get(busChannel) ?? 0) + 1);
    }

    const shared = [...consumers.entries()].filter(([, count]) => count > 1);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.[1]).toBe(2);
  });

  it("includes an unmapped card source and an OFF channel", () => {
    const { channels } = createDefaultMockSnapshot();

    expect(channels.some((channel) => channel.source.kind === "card")).toBe(
      true,
    );
    expect(channels.some((channel) => channel.source.kind === "off")).toBe(
      true,
    );
  });

  it("returns an independent snapshot per call", () => {
    const first = createDefaultMockSnapshot();
    const second = createDefaultMockSnapshot();

    expect(first).not.toBe(second);
    expect(first.channels[0]).not.toBe(second.channels[0]);
    expect(first.channels[0]?.source).not.toBe(second.channels[0]?.source);
    expect(first).toEqual(second);
  });
});
