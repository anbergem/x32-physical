import { fileURLToPath } from "node:url";

import type { MixerSourceRef } from "@x32/domain";
import {
  buildRouteIndex,
  MIXER_CHANNEL_COUNT,
  mixerChannelId,
  panelInput,
} from "@x32/domain";
import { loadInstallationFile } from "@x32/installation/node";
import { describe, expect, it } from "vitest";

import { createDefaultMockSnapshot } from "./default-snapshot";

/** The repo's real `config/installation.yaml`, not a fixture copy. */
const VENUE_CONFIG = fileURLToPath(
  new URL("../../../config/installation.yaml", import.meta.url),
);

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

    // Stagebox V is AES50-A 1–16, stagebox H (cascaded) is 17–32.
    expect(busChannels.some((channel) => channel >= 1 && channel <= 16)).toBe(
      true,
    );
    expect(busChannels.some((channel) => channel >= 17 && channel <= 32)).toBe(
      true,
    );
    expect(busChannels.every((channel) => channel >= 1 && channel <= 32)).toBe(
      true,
    );
  });

  it("matches the patch sheet: console local inputs 1–3 feed CH1–CH3, no other local/card/off sources", () => {
    const { channels } = createDefaultMockSnapshot();

    const local: MixerSourceRef[] = [];
    for (const channel of channels) {
      if (channel.source.kind === "local") local.push(channel.source);
      // The real sheet has no card/off channels at all.
      expect(channel.source.kind).not.toBe("card");
      expect(channel.source.kind).not.toBe("off");
    }

    expect(local).toEqual([
      { kind: "local", input: 1 },
      { kind: "local", input: 2 },
      { kind: "local", input: 3 },
    ]);
  });

  it("has no source consumed by more than one channel (unlike the old synthetic default)", () => {
    const consumers = new Map<string, number>();
    for (const channel of createDefaultMockSnapshot().channels) {
      const key = JSON.stringify(channel.source);
      consumers.set(key, (consumers.get(key) ?? 0) + 1);
    }

    expect([...consumers.values()].every((count) => count === 1)).toBe(true);
  });

  it("leaves AES50-A 7, 10 and 11 unconsumed, per the patch sheet", () => {
    const consumedBusChannels = new Set(
      createDefaultMockSnapshot()
        .channels.map((channel) => channel.source)
        .filter((source): source is Extract<MixerSourceRef, { kind: "aes50" }> => source.kind === "aes50")
        .map((source) => source.channel),
    );

    expect(consumedBusChannels.has(7)).toBe(false);
    expect(consumedBusChannels.has(10)).toBe(false);
    expect(consumedBusChannels.has(11)).toBe(false);
  });

  it("returns an independent snapshot per call", () => {
    const first = createDefaultMockSnapshot();
    const second = createDefaultMockSnapshot();

    expect(first).not.toBe(second);
    expect(first.channels[0]).not.toBe(second.channels[0]);
    expect(first.channels[0]?.source).not.toBe(second.channels[0]?.source);
    expect(first).toEqual(second);
  });

  describe("sanity anchor against the real installation", () => {
    it("traces CH11 Vokal H1 (AES50-A 18) to Stagebox H input 2 / MK Front H socket 1", () => {
      const installation = loadInstallationFile(VENUE_CONFIG);
      const { channels } = createDefaultMockSnapshot();
      const routeIndex = buildRouteIndex(installation, channels);

      const route = routeIndex.byMixerChannel.get(mixerChannelId(11));
      expect(route?.physicalInputs).toEqual([panelInput("front-right", 1)]);
    });

    it("traces CH5 Vokal V1 (AES50-A 1) to MK Front V socket 1", () => {
      const installation = loadInstallationFile(VENUE_CONFIG);
      const { channels } = createDefaultMockSnapshot();
      const routeIndex = buildRouteIndex(installation, channels);

      const route = routeIndex.byMixerChannel.get(mixerChannelId(5));
      expect(route?.physicalInputs).toEqual([panelInput("front-left", 1)]);
    });
  });
});
