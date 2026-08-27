import { fileURLToPath } from "node:url";

import type { MixerSourceRef } from "@x32/domain";
import {
  buildOutputRouteIndex,
  buildRouteIndex,
  consoleOutput,
  destination,
  endpointId,
  MIXER_CHANNEL_COUNT,
  MIXER_OUTPUT_COUNT,
  mixerChannelId,
  panelInput,
  stageboxOutput,
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

  it("names every channel in plain ASCII (issue #21: no venue name creeping back)", () => {
    for (const channel of createDefaultMockSnapshot().channels) {
      expect(channel.name).toMatch(/^[\x20-\x7e]+$/);
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
    it("traces CH11 (AES50-A 18) to Stagebox H input 2 / MK Front H socket 2", () => {
      const installation = loadInstallationFile(VENUE_CONFIG);
      const { channels } = createDefaultMockSnapshot();
      const routeIndex = buildRouteIndex(installation, channels);

      const route = routeIndex.byMixerChannel.get(mixerChannelId(11));
      // issue #12: MK Front H is numbered by physical position, socket 2 is
      // the printed "1" on the plate.
      expect(route?.physicalInputs).toEqual([panelInput("front-right", 2)]);
    });

    it("traces CH5 (AES50-A 1) to MK Front V socket 1", () => {
      const installation = loadInstallationFile(VENUE_CONFIG);
      const { channels } = createDefaultMockSnapshot();
      const routeIndex = buildRouteIndex(installation, channels);

      const route = routeIndex.byMixerChannel.get(mixerChannelId(5));
      expect(route?.physicalInputs).toEqual([panelInput("front-left", 1)]);
    });
  });

  describe("output patch (issue #11, docs/installation.md \"Output topology\")", () => {
    it("has exactly 16 output slots, ids 1–16 in order", () => {
      const { outputs } = createDefaultMockSnapshot();

      expect(outputs).toHaveLength(MIXER_OUTPUT_COUNT);
      expect(outputs?.map((output) => output.output)).toEqual(
        Array.from({ length: MIXER_OUTPUT_COUNT }, (_, index) => index + 1),
      );
    });

    it("matches the venue's real output patch sheet", () => {
      const { outputs } = createDefaultMockSnapshot();
      const byOutput = new Map(outputs?.map((o) => [o.output, o.source]));

      expect(byOutput.get(1)).toEqual({ kind: "matrix", matrix: 1 });
      expect(byOutput.get(2)).toEqual({ kind: "matrix", matrix: 2 });
      expect(byOutput.get(6)).toEqual({ kind: "bus", bus: 5 });
      expect(byOutput.get(7)).toEqual({ kind: "bus", bus: 3 });
      expect(byOutput.get(8)).toEqual({ kind: "bus", bus: 2 });
      expect(byOutput.get(11)).toEqual({ kind: "bus", bus: 4 });
      expect(byOutput.get(12)).toEqual({ kind: "bus", bus: 3 });
      expect(byOutput.get(13)).toEqual({ kind: "bus", bus: 1 });
      expect(byOutput.get(14)).toEqual({ kind: "main", side: "C" });
      expect(byOutput.get(15)).toEqual({ kind: "main", side: "L" });
      expect(byOutput.get(16)).toEqual({ kind: "main", side: "R" });

      for (const off of [3, 4, 5, 9, 10]) {
        expect(byOutput.get(off)).toEqual({ kind: "off" });
      }
    });

    it("returns an independent outputs array per call", () => {
      const first = createDefaultMockSnapshot();
      const second = createDefaultMockSnapshot();

      expect(first.outputs).not.toBe(second.outputs);
      expect(first.outputs?.[0]).not.toBe(second.outputs?.[0]);
      expect(first.outputs).toEqual(second.outputs);
    });

    describe("sanity anchor against the real installation", () => {
      it("traces Out 13 Front Venstre: Bus 1 -> Stagebox V out 5 -> Front Venstre", () => {
        const installation = loadInstallationFile(VENUE_CONFIG);
        const { outputs } = createDefaultMockSnapshot();
        const outputRouteIndex = buildOutputRouteIndex(installation, outputs ?? []);

        const route = outputRouteIndex.byMixerOutput.get(13);
        expect(route?.destinations).toEqual([destination("front-venstre")]);
        expect(route?.endpoints).toContain(
          endpointId(stageboxOutput("stagebox-1", 5)),
        );
      });

      it("shares one route between Out 7 and Out 12, both fed by Bus 3", () => {
        const installation = loadInstallationFile(VENUE_CONFIG);
        const { outputs } = createDefaultMockSnapshot();
        const outputRouteIndex = buildOutputRouteIndex(installation, outputs ?? []);

        const route7 = outputRouteIndex.byMixerOutput.get(7);
        const route12 = outputRouteIndex.byMixerOutput.get(12);
        expect(route7).toBe(route12);
        expect(route7?.mixerOutputs).toEqual([7, 12]);
      });

      it("presents Out 1's block wholesale: the stagebox XLR carries it, but only the console XLR is declared cabled", () => {
        const installation = loadInstallationFile(VENUE_CONFIG);
        const { outputs } = createDefaultMockSnapshot();
        const outputRouteIndex = buildOutputRouteIndex(installation, outputs ?? []);

        const route = outputRouteIndex.byMixerOutput.get(1);
        // Both physical presentations of the block are on the one shared
        // route — `endpoints` is a flat set, not a linear path
        // (architecture.md §3) — and `destinations` names every destination
        // the route reaches, from either branch.
        expect(route?.endpoints).toContain(endpointId(consoleOutput(1)));
        expect(route?.endpoints).toContain(
          endpointId(stageboxOutput("stagebox-2", 1)),
        );
        expect(route?.destinations).toEqual([destination("sidesal")]);

        // `byEndpoint` for the stagebox socket returns this same shared
        // route object — its `destinations` is the whole route's, not this
        // one branch's. This is exactly why the wholesale-block distinction
        // (issue #11) cannot be read off `OutputRoute.destinations` alone:
        // the web app's own `physicalOutputDestinationsFor` answers "is
        // *this* socket declared cabled?" directly from `installation`,
        // never through this index.
        const socketRoutes = outputRouteIndex.byEndpoint.get(
          endpointId(stageboxOutput("stagebox-2", 1)),
        );
        expect(socketRoutes).toEqual([route]);
      });
    });
  });
});
