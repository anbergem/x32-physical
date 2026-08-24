/**
 * Tooltip wording against the venue topology and the mock's default snapshot —
 * the same data the browser shows, so these assertions are what an operator
 * reads on screen.
 *
 * The mock's default snapshot (mixer-contracts) is faithful to the real patch
 * sheet and has no dual-consumer channel by default; the tests that need one
 * build a local `sharedContext` fixture with CH23/CH28 forced onto the same
 * source, rather than leaning on the default.
 */

import type { MixerChannelState } from "@x32/domain";
import {
  buildRouteIndex,
  endpointId,
  mixerChannel,
  mixerChannelId,
  panelInput,
  stageboxInput,
} from "@x32/domain";
import type { RoutingDiscrepancy } from "@x32/domain";
import { createDefaultMockSnapshot } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import { venueInstallation } from "../__fixtures__/venue";

import type { TooltipContext } from "./tooltip";
import { describeEndpoint } from "./tooltip";

const installation = venueInstallation();
const { channels } = createDefaultMockSnapshot();
const context: TooltipContext = {
  installation,
  routeIndex: buildRouteIndex(installation, channels),
  channels,
  discrepancies: [],
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
};

describe("describeEndpoint · mixer channel", () => {
  it("shows the source and the physical socket it comes from", () => {
    expect(describeEndpoint(endpointId(mixerChannel(5)), context)).toEqual({
      title: "CH5 · Vokal V1",
      lines: ["AES50-A 1", "Front Left · Input 1"],
    });
  });

  it("falls back to the stagebox socket when nothing is cabled to it", () => {
    // AES50-A 23 is stagebox-2 input 7, a direct stage socket.
    expect(describeEndpoint(endpointId(mixerChannel(16)), context)).toEqual({
      title: "CH16 · Vokal H6",
      lines: ["AES50-A 23", "Stagebox 2 · Input 7"],
    });
  });

  it("says so when the source reaches no physical input", () => {
    expect(describeEndpoint(endpointId(mixerChannel(1)), context)).toEqual({
      title: "CH1 · Bøyle",
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
    };

    expect(describeEndpoint(endpointId(mixerChannel(32)), offContext)).toEqual({
      title: "CH32 · OH H",
      lines: ["OFF", "No mapped physical input"],
    });
  });

  it("describes a channel the mixer has not reported yet", () => {
    const empty: TooltipContext = {
      installation,
      routeIndex: buildRouteIndex(installation, []),
      channels: [],
      discrepancies: [],
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
      title: "CH5 · Vokal V1",
      lines: [
        "AES50-A 1",
        "Front Left · Input 1",
        "Expected: Local 9 / Actual: AES50-A 1",
      ],
    });
  });

  it("appends a baseline-name line for a name-mismatch, never a badge-worthy line", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      { kind: "name-mismatch", channel: mixerChannelId(5), expected: "Vokal Old", actual: "Vokal V1" },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(5)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH5 · Vokal V1",
      lines: ["AES50-A 1", "Front Left · Input 1", "Baseline name: Vokal Old"],
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
      title: "CH23 · Aux Scene L",
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
      lines: ["→ AES50-A 10", "CH23 Aux Scene L, CH28 Hihat"],
    });
  });

  it("describes a panel socket by where its cable ends up", () => {
    expect(
      describeEndpoint(endpointId(panelInput("front-left", 3)), context),
    ).toEqual({
      title: "Front Left · Input 3",
      lines: ["→ AES50-A 3", "CH7 Vokal V3"],
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
