/**
 * Tooltip wording against the venue topology and the mock's default snapshot —
 * the same data the browser shows, so these assertions are what an operator
 * reads on screen.
 */

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

describe("describeEndpoint · mixer channel", () => {
  it("shows the source and the physical socket it comes from", () => {
    expect(describeEndpoint(endpointId(mixerChannel(3)), context)).toEqual({
      title: "CH3 · Hi-Hat",
      lines: ["AES50-A 3", "Front Left · Input 3"],
    });
  });

  it("falls back to the stagebox socket when nothing is cabled to it", () => {
    // AES50-A 23 is stagebox-2 input 7, a direct stage socket.
    expect(describeEndpoint(endpointId(mixerChannel(23)), context)).toEqual({
      title: "CH23 · Podium",
      lines: ["AES50-A 23", "Stagebox 2 · Input 7"],
    });
  });

  it("says so when the source reaches no physical input", () => {
    expect(describeEndpoint(endpointId(mixerChannel(29)), context)).toEqual({
      title: "CH29 · Playback L",
      lines: ["Card 1", "No mapped physical input"],
    });
  });

  it("describes a channel with no source at all", () => {
    expect(describeEndpoint(endpointId(mixerChannel(32)), context)).toEqual({
      title: "CH32 · Spare 32",
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
        channel: mixerChannelId(3),
        expected: { kind: "local", input: 9 },
        actual: { kind: "aes50", bus: "A", channel: 3 },
      },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(3)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH3 · Hi-Hat",
      lines: [
        "AES50-A 3",
        "Front Left · Input 3",
        "Expected: Local 9 / Actual: AES50-A 3",
      ],
    });
  });

  it("appends a baseline-name line for a name-mismatch, never a badge-worthy line", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      { kind: "name-mismatch", channel: mixerChannelId(3), expected: "Kick", actual: "Hi-Hat" },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(3)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH3 · Hi-Hat",
      lines: ["AES50-A 3", "Front Left · Input 3", "Baseline name: Kick"],
    });
  });

  it("appends a sharing explanation for unexpected-shared-source", () => {
    const discrepancies: RoutingDiscrepancy[] = [
      {
        kind: "unexpected-shared-source",
        source: { kind: "aes50", bus: "A", channel: 23 },
        channels: [mixerChannelId(23), mixerChannelId(28)],
      },
    ];

    expect(
      describeEndpoint(endpointId(mixerChannel(23)), { ...context, discrepancies }),
    ).toEqual({
      title: "CH23 · Podium",
      lines: ["AES50-A 23", "Stagebox 2 · Input 7", "Unexpectedly shares its source with CH28"],
    });
  });
});

describe("describeEndpoint · physical socket", () => {
  it("lists every channel consuming a socket, in order", () => {
    expect(
      describeEndpoint(endpointId(stageboxInput("stagebox-2", 7)), context),
    ).toEqual({
      title: "Stagebox 2 · Input 7",
      lines: ["→ AES50-A 23", "CH23 Podium, CH28 Podium Rec"],
    });
  });

  it("describes a panel socket by where its cable ends up", () => {
    expect(
      describeEndpoint(endpointId(panelInput("front-left", 3)), context),
    ).toEqual({
      title: "Front Left · Input 3",
      lines: ["→ AES50-A 3", "CH3 Hi-Hat"],
    });
  });

  it("says when nothing is patched from a socket", () => {
    // AES50-A 28 is deliberately unconsumed in the default snapshot.
    expect(
      describeEndpoint(endpointId(stageboxInput("stagebox-2", 12)), context),
    ).toEqual({
      title: "Stagebox 2 · Input 12",
      lines: ["→ AES50-A 28", "No channel consumes this input"],
    });
  });
});
