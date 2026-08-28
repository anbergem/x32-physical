/**
 * Tooltip wording against the venue topology and the mock's default snapshot —
 * the same data the browser shows, so these assertions are what an operator
 * reads on screen.
 *
 * The mock's default snapshot (mixer-contracts) gives every channel its own
 * source and so has no dual-consumer channel by default; the tests that need one
 * build a local `sharedContext` fixture with CH23/CH28 forced onto the same
 * source, rather than leaning on the default.
 */

import type { MixerChannelState } from "@x32/domain";
import {
  buildOutputRouteIndex,
  buildRouteIndex,
  consoleOutput,
  destination,
  endpointId,
  mixerChannel,
  mixerChannelId,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "@x32/domain";
import type { RoutingDiscrepancy } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { exampleRig } from "../__fixtures__/example-rig";

import type { TooltipContext } from "./tooltip";
import { describeEndpoint } from "./tooltip";

const installation = exampleRig();
const { channels, outputs } = createDefaultMockSnapshot();
const context: TooltipContext = {
  installation,
  routeIndex: buildRouteIndex(installation, channels),
  channels,
  discrepancies: [],
  outputRouteIndex: buildOutputRouteIndex(installation, outputs ?? []),
  outputs: outputs ?? [],
};

const CH23 = mixerChannelId(23);
const CH28 = mixerChannelId(28);

/** CH23 and CH28 both forced onto AES50-A 10 (stagebox-1 input 10, unconsumed by default). */
const sharedChannels: MixerChannelState[] = channels.map((channel) =>
  channel.channel === CH23 || channel.channel === CH28
    ? { ...channel, source: { kind: "aes50", bus: "A", channel: 10 } }
    : channel,
);
const sharedContext: TooltipContext = {
  installation,
  routeIndex: buildRouteIndex(installation, sharedChannels),
  channels: sharedChannels,
  discrepancies: [],
  outputRouteIndex: buildOutputRouteIndex(installation, outputs ?? []),
  outputs: outputs ?? [],
};

describe("describeEndpoint · mixer channel", () => {
  it("shows the source and the physical socket it comes from", () => {
    expect(describeEndpoint(endpointId(mixerChannel(5)), context)).toEqual({
      title: "CH5 · Vox 1",
      lines: ["AES50-A 1", "Front Left · Input 1"],
    });
  });

  it("falls back to the stagebox socket when nothing is cabled to it", () => {
    // AES50-A 23 is stagebox-2 input 7, a direct stage socket.
    expect(describeEndpoint(endpointId(mixerChannel(16)), context)).toEqual({
      title: "CH16 · Speech 6",
      lines: ["AES50-A 23", "Stagebox 2 · Input 7"],
    });
  });

  it("says so when the source reaches no physical input", () => {
    expect(describeEndpoint(endpointId(mixerChannel(1)), context)).toEqual({
      title: "CH1 · Lectern",
      lines: ["Local 1", "No mapped physical input"],
    });
  });

  it("describes a channel with no source at all", () => {
    const offChannels: MixerChannelState[] = channels.map((channel) =>
      channel.channel === mixerChannelId(32)
        ? { ...channel, source: { kind: "off" } }
        : channel,
    );
    const offContext: TooltipContext = {
      installation,
      routeIndex: buildRouteIndex(installation, offChannels),
      channels: offChannels,
      discrepancies: [],
      outputRouteIndex: buildOutputRouteIndex(installation, outputs ?? []),
      outputs: outputs ?? [],
    };

    expect(describeEndpoint(endpointId(mixerChannel(32)), offContext)).toEqual({
      title: "CH32 · OH R",
      lines: ["OFF", "No mapped physical input"],
    });
  });

  it("describes a channel the mixer has not reported yet", () => {
    const empty: TooltipContext = {
      installation,
      routeIndex: buildRouteIndex(installation, []),
      channels: [],
      discrepancies: [],
      outputRouteIndex: buildOutputRouteIndex(installation, []),
      outputs: [],
    };

    expect(describeEndpoint(endpointId(mixerChannel(12)), empty)).toEqual({
      title: "CH12",
      lines: ["No mixer data yet"],
    });
  });

  it("appends an Expected/Actual line for a source-mismatch discrepancy", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      {
        kind: "source-mismatch",
        channel: mixerChannelId(5),
        expected: { kind: "local", input: 9 },
        actual: { kind: "aes50", bus: "A", channel: 1 },
      },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(5)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH5 · Vox 1",
      lines: [
        "AES50-A 1",
        "Front Left · Input 1",
        "Expected: Local 9 / Actual: AES50-A 1",
      ],
    });
  });

  it("appends a baseline-name line for a name-mismatch, never a badge-worthy line", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      { kind: "name-mismatch", channel: mixerChannelId(5), expected: "Vox Old", actual: "Vox 1" },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(5)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH5 · Vox 1",
      lines: ["AES50-A 1", "Front Left · Input 1", "Baseline name: Vox Old"],
    });
  });

  it("appends a sharing explanation for unexpected-shared-source", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      {
        kind: "unexpected-shared-source",
        source: { kind: "aes50", bus: "A", channel: 10 },
        channels: [CH23, CH28],
      },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(23)), { ...sharedContext, discrepancies }),
    ).toEqual({
      title: "CH23 · Playback L",
      lines: ["AES50-A 10", "Stagebox 1 · Input 10", "Unexpectedly shares its source with CH28"],
    });
  });
});

describe("describeEndpoint · physical socket", () => {
  it("lists every channel consuming a socket, in order", () => {
    expect(
      describeEndpoint(endpointId(stageboxInput("stagebox-1", 10)), sharedContext),
    ).toEqual({
      title: "Stagebox 1 · Input 10",
      lines: ["→ AES50-A 10", "CH23 Playback L, CH28 Hi-Hat"],
    });
  });

  it("describes a panel socket by where its cable ends up", () => {
    expect(
      describeEndpoint(endpointId(panelInput("front-left", 3)), context),
    ).toEqual({
      title: "Front Left · Input 3",
      lines: ["→ AES50-A 3", "CH7 Vox 3"],
    });
  });

  it("says when nothing is patched from a socket", () => {
    // AES50-A 10 is deliberately unconsumed in the default snapshot.
    expect(
      describeEndpoint(endpointId(stageboxInput("stagebox-1", 10)), context),
    ).toEqual({
      title: "Stagebox 1 · Input 10",
      lines: ["→ AES50-A 10", "No channel consumes this input"],
    });
  });
});

describe("describeEndpoint · socket annotations (issue #12)", () => {
  /**
   * front-left socket 8 with a declared annotation, its base-fixture
   * connection removed first — an annotated socket cannot also be cabled
   * (a domain rule `validateInstallation` enforces).
   */
  function annotatedContext(status: "broken" | "unused", note?: string): TooltipContext {
    const withAnnotation = exampleRig();
    withAnnotation.connections = withAnnotation.connections.filter(
      (connection) =>
        !(
          connection.from.kind === "panel-input" &&
          connection.from.device === "front-left" &&
          connection.from.input === 8
        ),
    );
    const panel = withAnnotation.devices.find((device) => device.id === "front-left")!;
    panel.sockets = [
      { input: 8, status, ...(note === undefined ? {} : { note }) },
    ];

    const { channels: annotatedChannels, outputs: annotatedOutputs } =
      createDefaultMockSnapshot();
    return {
      installation: withAnnotation,
      routeIndex: buildRouteIndex(withAnnotation, annotatedChannels),
      channels: annotatedChannels,
      discrepancies: [],
      outputRouteIndex: buildOutputRouteIndex(withAnnotation, annotatedOutputs ?? []),
      outputs: annotatedOutputs ?? [],
    };
  }

  it("reports a broken socket, its note, and no consumers — distinct from a normal socket", () => {
    const ctx = annotatedContext("broken", "Defekt — ikke i bruk");

    expect(describeEndpoint(endpointId(panelInput("front-left", 8)), ctx)).toEqual({
      title: "Front Left · Input 8",
      lines: [
        "Broken, do not use",
        "Defekt — ikke i bruk",
        "Not cabled to a stagebox",
        "No channel consumes this input",
      ],
    });
  });

  it("reports an unused socket with wording distinct from broken", () => {
    const ctx = annotatedContext("unused");
    const description = describeEndpoint(endpointId(panelInput("front-left", 8)), ctx);

    expect(description.lines[0]).toBe("Unused — nothing patched here");
  });

  it("differs from a merely-uncabled socket's tooltip", () => {
    const uncabledInstallation = exampleRig();
    uncabledInstallation.connections = uncabledInstallation.connections.filter(
      (connection) =>
        !(
          connection.from.kind === "panel-input" &&
          connection.from.device === "front-left" &&
          connection.from.input === 8
        ),
    );
    const { channels: uncabledChannels, outputs: uncabledOutputs } =
      createDefaultMockSnapshot();
    const uncabledDescription = describeEndpoint(
      endpointId(panelInput("front-left", 8)),
      {
        installation: uncabledInstallation,
        routeIndex: buildRouteIndex(uncabledInstallation, uncabledChannels),
        channels: uncabledChannels,
        discrepancies: [],
        outputRouteIndex: buildOutputRouteIndex(uncabledInstallation, uncabledOutputs ?? []),
        outputs: uncabledOutputs ?? [],
      },
    );

    const brokenDescription = describeEndpoint(
      endpointId(panelInput("front-left", 8)),
      annotatedContext("broken"),
    );

    expect(uncabledDescription.lines).toEqual([
      "Not cabled to a stagebox",
      "No channel consumes this input",
    ]);
    expect(brokenDescription.lines).not.toEqual(uncabledDescription.lines);
    expect(brokenDescription.lines[0]).toBe("Broken, do not use");
  });
});

describe("describeEndpoint · output slot (issue #11)", () => {
  it("shows the slot's source and the destination it reaches", () => {
    expect(describeEndpoint(endpointId(mixerOutput(13)), context)).toEqual({
      title: "Out 13",
      lines: ["Bus 1", "→ Fill Left"],
    });
  });

  it("names every destination for a slot shared by two Out numbers", () => {
    expect(describeEndpoint(endpointId(mixerOutput(7)), context)).toEqual({
      title: "Out 7",
      lines: ["Bus 3", "→ Side Left, Side Right"],
    });
    expect(describeEndpoint(endpointId(mixerOutput(12)), context)).toEqual({
      title: "Out 12",
      lines: ["Bus 3", "→ Side Left, Side Right"],
    });
  });

  it("reports an off slot as unrouted, not merely uncabled", () => {
    expect(describeEndpoint(endpointId(mixerOutput(3)), context)).toEqual({
      title: "Out 3",
      lines: ["OFF", "OFF — not routed"],
    });
  });
});

describe("describeEndpoint · physical output socket — the wholesale-block distinction (issue #11)", () => {
  it("describes a cabled console XLR out", () => {
    expect(describeEndpoint(endpointId(consoleOutput(1)), context)).toEqual({
      title: "Console Out 1",
      lines: ["Carries Out 1 → Zone A"],
    });
  });

  it("describes a cabled stagebox XLR out", () => {
    expect(describeEndpoint(endpointId(stageboxOutput("stagebox-1", 5)), context)).toEqual({
      title: "Stagebox 1 · Out 5",
      lines: ["Carries Out 13 → Fill Left"],
    });
  });

  it("reads distinctly for a socket that carries a block wholesale but is not cabled", () => {
    // Stagebox 2 presents OUT1-8 wholesale; only console-out:1 is actually
    // cabled to Zone A — this socket must never claim to feed it too.
    expect(describeEndpoint(endpointId(stageboxOutput("stagebox-2", 1)), context)).toEqual({
      title: "Stagebox 2 · Out 1",
      lines: ["Carries Out 1 · nothing connected"],
    });
  });
});

describe("describeEndpoint · destination (issue #11)", () => {
  it("shows the full upstream chain for a simple 1:1 destination", () => {
    expect(describeEndpoint(endpointId(destination("fill-left")), context)).toEqual({
      title: "Fill Left",
      lines: ["Fill Left ← Stagebox 1 · Out 5 ← Out 13 ← Bus 1"],
    });
  });

  it("shows the chain for a console-XLR-fed destination", () => {
    expect(describeEndpoint(endpointId(destination("zone-b")), context)).toEqual({
      title: "Zone B",
      lines: ["Zone B ← Console Out 2 ← Out 2 ← Matrix 2"],
    });
  });
});
