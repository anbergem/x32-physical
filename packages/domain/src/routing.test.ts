import { describe, expect, it } from "vitest";

import { venueInstallation } from "./__fixtures__/venue";
import { panelInput, stageboxInput } from "./endpoints";
import type { EndpointId } from "./ids";
import { MIXER_CHANNEL_COUNT, deviceId, mixerChannelId } from "./ids";
import type { MixerChannelState, MixerSourceRef } from "./mixer";
import type { RouteIndex, SignalRoute } from "./routing";
import { buildRouteIndex } from "./routing";
import type { Installation } from "./topology";

/**
 * Two 16-in stageboxes cascaded on AES50-A (1–16 and 17–32) plus one 8-socket
 * panel. Only three sockets are cabled, so the fixture also covers direct stage
 * sockets (uncabled stagebox inputs) and dead-end panel sockets.
 */
function routingInstallation(): Installation {
  return {
    devices: [
      {
        id: deviceId("stagebox-1"),
        kind: "stagebox",
        label: "Stagebox 1",
        inputs: 16,
        aes50: { bus: "A", offset: 0 },
      },
      {
        id: deviceId("stagebox-2"),
        kind: "stagebox",
        label: "Stagebox 2",
        inputs: 16,
        aes50: { bus: "A", offset: 16 },
      },
      {
        id: deviceId("front-left"),
        kind: "passive-panel",
        label: "Front Left",
        inputs: 8,
      },
    ],
    connections: [
      { from: panelInput("front-left", 1), to: stageboxInput("stagebox-1", 1) },
      { from: panelInput("front-left", 3), to: stageboxInput("stagebox-1", 3) },
      { from: panelInput("front-left", 8), to: stageboxInput("stagebox-2", 7) },
    ],
  };
}

/** An AES50-A source. */
function a(channel: number): MixerSourceRef {
  return { kind: "aes50", bus: "A", channel };
}

/** A full 32-channel state; channels not named are OFF. */
function channels(
  sources: Record<number, MixerSourceRef>,
): MixerChannelState[] {
  return Array.from({ length: MIXER_CHANNEL_COUNT }, (_unused, index) => {
    const channel = index + 1;
    return {
      channel: mixerChannelId(channel),
      name: `CH ${channel}`,
      source: sources[channel] ?? { kind: "off" },
    };
  });
}

function id(value: string): EndpointId {
  return value as EndpointId;
}

/** The single route through an endpoint — fails if there is not exactly one. */
function routeAt(index: RouteIndex, endpoint: string): SignalRoute {
  const routes = index.byEndpoint.get(id(endpoint)) ?? [];
  expect(routes).toHaveLength(1);
  return routes[0] as SignalRoute;
}

function routeOf(index: RouteIndex, channel: number): SignalRoute {
  const route = index.byMixerChannel.get(mixerChannelId(channel));
  expect(route).toBeDefined();
  return route as SignalRoute;
}

/** Full structural snapshot, including map insertion order. */
function serialize(index: RouteIndex): string {
  return JSON.stringify({
    byMixerChannel: [...index.byMixerChannel.entries()],
    byEndpoint: [...index.byEndpoint.entries()],
  });
}

describe("buildRouteIndex: a simple route", () => {
  const index = buildRouteIndex(routingInstallation(), channels({ 12: a(3) }));

  it("traces panel → stagebox → aes50 → mixer, upstream first", () => {
    expect(routeOf(index, 12).endpoints).toEqual([
      "panel:front-left:3",
      "stagebox:stagebox-1:3",
      "aes50:A:3",
      "mixer:12",
    ]);
  });

  it("reports the panel socket as the physical input", () => {
    const route = routeOf(index, 12);
    expect(route.physicalInputs).toEqual([panelInput("front-left", 3)]);
    expect(route.mixerChannels).toEqual([12]);
    expect(route.unmappedSource).toBeUndefined();
  });

  it("yields the identical route from every endpoint on the path", () => {
    const fromChannel = routeOf(index, 12);
    expect(routeAt(index, "panel:front-left:3")).toBe(fromChannel);
    expect(routeAt(index, "stagebox:stagebox-1:3")).toBe(fromChannel);
    expect(routeAt(index, "aes50:A:3")).toBe(fromChannel);
    expect(routeAt(index, "mixer:12")).toBe(fromChannel);
  });
});

describe("buildRouteIndex: dual consumer", () => {
  const index = buildRouteIndex(
    routingInstallation(),
    // Listed out of order on purpose: the route must not depend on it.
    channels({ 28: a(3), 12: a(3) }),
  );

  it("builds one shared route ending in both channels", () => {
    expect(routeOf(index, 12).endpoints).toEqual([
      "panel:front-left:3",
      "stagebox:stagebox-1:3",
      "aes50:A:3",
      "mixer:12",
      "mixer:28",
    ]);
  });

  it("lists both consumers ascending, on one shared route object", () => {
    const route = routeOf(index, 12);
    expect(route.mixerChannels).toEqual([12, 28]);
    expect(routeOf(index, 28)).toBe(route);
  });

  it("yields both channels from any endpoint on the path", () => {
    for (const endpoint of [
      "panel:front-left:3",
      "stagebox:stagebox-1:3",
      "aes50:A:3",
      "mixer:12",
      "mixer:28",
    ]) {
      expect(routeAt(index, endpoint).mixerChannels).toEqual([12, 28]);
    }
  });
});

describe("buildRouteIndex: sources with no physical input", () => {
  const unmappedSources: MixerSourceRef[] = [
    { kind: "local", input: 1 },
    { kind: "card", input: 5 },
    { kind: "aux", input: 2 },
    { kind: "usb", side: "L" },
    { kind: "fx", ret: 3 },
    { kind: "bus", bus: 4 },
    { kind: "talkback", which: "int" },
    { kind: "off" },
  ];

  it("resolves a Card channel to the channel alone, without throwing", () => {
    const build = (): RouteIndex =>
      buildRouteIndex(
        routingInstallation(),
        channels({ 5: { kind: "card", input: 5 } }),
      );
    expect(build).not.toThrow();

    const route = routeOf(build(), 5);
    expect(route.endpoints).toEqual(["mixer:5"]);
    expect(route.physicalInputs).toEqual([]);
    expect(route.unmappedSource).toEqual({ kind: "card", input: 5 });
  });

  it("resolves an OFF channel the same way", () => {
    const route = routeOf(
      buildRouteIndex(routingInstallation(), channels({})),
      32,
    );
    expect(route.endpoints).toEqual(["mixer:32"]);
    expect(route.physicalInputs).toEqual([]);
    expect(route.unmappedSource).toEqual({ kind: "off" });
  });

  it("handles every unmapped source kind without throwing", () => {
    const sources: Record<number, MixerSourceRef> = {};
    unmappedSources.forEach((source, index) => {
      sources[index + 1] = source;
    });
    const index = buildRouteIndex(routingInstallation(), channels(sources));

    unmappedSources.forEach((source, position) => {
      const route = routeOf(index, position + 1);
      expect(route.endpoints).toEqual([`mixer:${position + 1}`]);
      expect(route.physicalInputs).toEqual([]);
      expect(route.unmappedSource).toEqual(source);
    });
  });

  it("gives each unmapped channel its own route", () => {
    const index = buildRouteIndex(
      routingInstallation(),
      channels({
        29: { kind: "card", input: 1 },
        30: { kind: "card", input: 2 },
      }),
    );
    expect(routeOf(index, 29)).not.toBe(routeOf(index, 30));
    expect(routeOf(index, 30).endpoints).toEqual(["mixer:30"]);
  });

  it("keeps an AES50 channel no stagebox occupies hoverable", () => {
    // The boxes cover A1–A32; nothing lands on A40.
    const index = buildRouteIndex(routingInstallation(), channels({ 20: a(40) }));
    const route = routeOf(index, 20);

    expect(route.endpoints).toEqual(["aes50:A:40", "mixer:20"]);
    expect(route.physicalInputs).toEqual([]);
    expect(route.unmappedSource).toEqual({ kind: "aes50", bus: "A", channel: 40 });
    expect(routeAt(index, "aes50:A:40")).toBe(route);
  });

  it("shares one route between consumers of the same unoccupied channel", () => {
    const index = buildRouteIndex(
      routingInstallation(),
      channels({ 20: a(40), 21: a(40) }),
    );
    const route = routeOf(index, 20);
    expect(route).toBe(routeOf(index, 21));
    expect(route.mixerChannels).toEqual([20, 21]);
    expect(route.endpoints).toEqual(["aes50:A:40", "mixer:20", "mixer:21"]);
  });

  it("treats an out-of-range AES50 channel as unmapped rather than fatal", () => {
    const source: MixerSourceRef = { kind: "aes50", bus: "A", channel: 99 };
    const index = buildRouteIndex(routingInstallation(), channels({ 4: source }));
    const route = routeOf(index, 4);

    expect(route.endpoints).toEqual(["mixer:4"]);
    expect(route.unmappedSource).toEqual(source);
  });
});

describe("buildRouteIndex: cascade and direct stage sockets", () => {
  it("resolves AES50-A 23 through stagebox-2 input 7 and its panel socket", () => {
    const index = buildRouteIndex(routingInstallation(), channels({ 7: a(23) }));
    const route = routeOf(index, 7);

    expect(route.endpoints).toEqual([
      "panel:front-left:8",
      "stagebox:stagebox-2:7",
      "aes50:A:23",
      "mixer:7",
    ]);
    expect(route.physicalInputs).toEqual([panelInput("front-left", 8)]);
  });

  it("resolves the same cascade on the shared venue fixture", () => {
    const index = buildRouteIndex(venueInstallation(), channels({ 7: a(23) }));
    expect(routeOf(index, 7).endpoints).toEqual([
      "panel:front-left:8",
      "stagebox:stagebox-2:7",
      "aes50:A:23",
      "mixer:7",
    ]);
  });

  it("uses an uncabled stagebox input itself as the physical input", () => {
    // Stagebox 1 input 9 has no panel feeding it: it is a direct stage socket.
    const index = buildRouteIndex(routingInstallation(), channels({ 9: a(9) }));
    const route = routeOf(index, 9);

    expect(route.endpoints).toEqual([
      "stagebox:stagebox-1:9",
      "aes50:A:9",
      "mixer:9",
    ]);
    expect(route.physicalInputs).toEqual([stageboxInput("stagebox-1", 9)]);
  });
});

describe("buildRouteIndex: channel coverage", () => {
  it("resolves all 32 channels for a mixed snapshot", () => {
    const index = buildRouteIndex(
      routingInstallation(),
      channels({
        1: a(1),
        12: a(3),
        28: a(3),
        20: a(40),
        29: { kind: "card", input: 1 },
      }),
    );

    expect(index.byMixerChannel.size).toBe(MIXER_CHANNEL_COUNT);
    for (let channel = 1; channel <= MIXER_CHANNEL_COUNT; channel += 1) {
      const route = routeOf(index, channel);
      expect(route.mixerChannels).toContain(channel);
      expect(route.endpoints).toContain(`mixer:${channel}`);
    }
  });

  it("still resolves channels the caller left out", () => {
    const index = buildRouteIndex(routingInstallation(), [
      { channel: mixerChannelId(1), name: "Kick", source: a(1) },
    ]);

    expect(index.byMixerChannel.size).toBe(MIXER_CHANNEL_COUNT);
    const route = routeOf(index, 2);
    expect(route.endpoints).toEqual(["mixer:2"]);
    expect(route.physicalInputs).toEqual([]);
    // Nothing is known about CH2 — it is not claimed to be on an unmapped source.
    expect(route.unmappedSource).toBeUndefined();
  });
});

describe("buildRouteIndex: chains no channel consumes", () => {
  const index = buildRouteIndex(routingInstallation(), channels({ 12: a(3) }));

  it("indexes a cabled chain that reaches AES50 unconsumed", () => {
    const route = routeAt(index, "panel:front-left:1");

    expect(route.endpoints).toEqual([
      "panel:front-left:1",
      "stagebox:stagebox-1:1",
      "aes50:A:1",
    ]);
    expect(route.mixerChannels).toEqual([]);
    expect(route.unmappedSource).toBeUndefined();
    expect(route.physicalInputs).toEqual([panelInput("front-left", 1)]);
    expect(routeAt(index, "stagebox:stagebox-1:1")).toBe(route);
    expect(routeAt(index, "aes50:A:1")).toBe(route);
  });

  it("indexes an unconsumed direct stage socket", () => {
    const route = routeAt(index, "stagebox:stagebox-1:10");
    expect(route.endpoints).toEqual([
      "stagebox:stagebox-1:10",
      "aes50:A:10",
    ]);
    expect(route.physicalInputs).toEqual([stageboxInput("stagebox-1", 10)]);
    expect(route.mixerChannels).toEqual([]);
  });

  it("indexes a panel socket cabled to nothing", () => {
    const route = routeAt(index, "panel:front-left:4");
    expect(route.endpoints).toEqual(["panel:front-left:4"]);
    expect(route.mixerChannels).toEqual([]);
    expect(route.physicalInputs).toEqual([panelInput("front-left", 4)]);
  });

  it("does not add a second route to a consumed chain", () => {
    expect(index.byEndpoint.get(id("panel:front-left:3"))).toHaveLength(1);
    expect(index.byEndpoint.get(id("aes50:A:3"))).toHaveLength(1);
  });

  it("covers every physical socket of the installation", () => {
    for (let input = 1; input <= 8; input += 1) {
      expect(index.byEndpoint.has(id(`panel:front-left:${input}`))).toBe(true);
    }
    for (let input = 1; input <= 16; input += 1) {
      expect(index.byEndpoint.has(id(`stagebox:stagebox-1:${input}`))).toBe(true);
      expect(index.byEndpoint.has(id(`stagebox:stagebox-2:${input}`))).toBe(true);
    }
    for (let channel = 1; channel <= 32; channel += 1) {
      expect(index.byEndpoint.has(id(`aes50:A:${channel}`))).toBe(true);
    }
  });
});

describe("buildRouteIndex: routing change", () => {
  const installation = routingInstallation();
  const before = buildRouteIndex(installation, channels({ 12: a(3), 28: a(3) }));
  const after = buildRouteIndex(installation, channels({ 12: a(8), 28: a(3) }));

  it("resolves the moved channel through its new source", () => {
    const route = routeOf(after, 12);
    expect(route.endpoints).toEqual([
      "stagebox:stagebox-1:8",
      "aes50:A:8",
      "mixer:12",
    ]);
    expect(route.physicalInputs).toEqual([stageboxInput("stagebox-1", 8)]);
  });

  it("drops the moved channel from the old source's route", () => {
    const route = routeAt(after, "aes50:A:3");
    expect(route.mixerChannels).toEqual([28]);
    expect(route.endpoints).not.toContain("mixer:12");
    for (const routes of after.byEndpoint.values()) {
      for (const candidate of routes) {
        if (candidate.endpoints.includes(id("aes50:A:3"))) {
          expect(candidate.mixerChannels).not.toContain(12);
        }
      }
    }
  });

  it("leaves the previously built index untouched", () => {
    expect(routeOf(before, 12).endpoints).toEqual([
      "panel:front-left:3",
      "stagebox:stagebox-1:3",
      "aes50:A:3",
      "mixer:12",
      "mixer:28",
    ]);
  });

  it("re-indexes the abandoned chain as unconsumed when nothing is left", () => {
    const abandoned = buildRouteIndex(installation, channels({ 12: a(8) }));
    const route = routeAt(abandoned, "aes50:A:3");
    expect(route.mixerChannels).toEqual([]);
    expect(route.endpoints).toEqual([
      "panel:front-left:3",
      "stagebox:stagebox-1:3",
      "aes50:A:3",
    ]);
  });
});

describe("buildRouteIndex: determinism", () => {
  const sources: Record<number, MixerSourceRef> = {
    1: a(1),
    7: a(23),
    9: a(9),
    12: a(3),
    20: a(40),
    28: a(3),
    29: { kind: "card", input: 1 },
  };

  it("produces identical output for identical input", () => {
    const first = buildRouteIndex(routingInstallation(), channels(sources));
    const second = buildRouteIndex(routingInstallation(), channels(sources));
    expect(serialize(second)).toBe(serialize(first));
  });

  it("does not depend on the order of channels, devices or connections", () => {
    const baseline = buildRouteIndex(routingInstallation(), channels(sources));

    const shuffled = routingInstallation();
    shuffled.devices.reverse();
    shuffled.connections.reverse();
    const reordered = buildRouteIndex(
      shuffled,
      [...channels(sources)].reverse(),
    );

    expect(serialize(reordered)).toBe(serialize(baseline));
  });
});
