/**
 * `cloneSnapshot` regression tests.
 *
 * These assert a **round trip** — clone a fully-populated snapshot and expect
 * deep equality — rather than checking fields one by one. That choice is the
 * point of the file: issue #31 shipped a clone that silently dropped
 * `outputs`, and a field-by-field test would have passed the whole time it
 * was broken. Deep equality fails the moment any future field is forgotten
 * the same way.
 */

import { describe, expect, it } from "vitest";

import { mixerChannelId } from "@x32/domain";
import type { MixerSnapshot } from "@x32/mixer-contracts";

import { cloneSnapshot } from "./snapshot";

function populatedSnapshot(): MixerSnapshot {
  return {
    channels: [
      {
        channel: mixerChannelId(1),
        name: "Taler 1",
        source: { kind: "local", input: 2 },
      },
    ],
    outputs: [
      { output: 1, source: { kind: "matrix", matrix: 1 } },
      { output: 15, source: { kind: "main", side: "L" } },
    ],
    selectedChannel: mixerChannelId(1),
    aes50LinkState: {
      buses: [
        { bus: "A", audioError: false, auxError: false },
        { bus: "B", audioError: false, auxError: false },
      ],
      locked: true,
    },
    aes50Chain: [
      { bus: "A", boxes: [{ position: 1, model: "S16", rawLetter: "N" }] },
    ],
  };
}

describe("cloneSnapshot", () => {
  it("round-trips a fully-populated snapshot to a deep-equal value", () => {
    const snapshot = populatedSnapshot();
    expect(cloneSnapshot(snapshot)).toEqual(snapshot);
  });

  it("carries output routing through, the field issue #31 dropped", () => {
    const clone = cloneSnapshot(populatedSnapshot());
    expect(clone.outputs).toHaveLength(2);
    expect(clone.outputs?.[1]).toEqual({
      output: 15,
      source: { kind: "main", side: "L" },
    });
  });

  it("copies outputs rather than aliasing them", () => {
    const snapshot = populatedSnapshot();
    const clone = cloneSnapshot(snapshot);

    // Mutating the clone's source must not reach back into the bridge's cache.
    (clone.outputs?.[0] as { source: unknown }).source = { kind: "off" };

    expect(snapshot.outputs?.[0]?.source).toEqual({ kind: "matrix", matrix: 1 });
  });

  // Tolerating an *absent* `outputs` is no longer this function's job:
  // `MixerSnapshot.outputs` is required (issue #31), and the one place a
  // snapshot can legitimately arrive without it — a `baseline.json` written
  // before the field existed — is normalised at the parse boundary instead.
  // That case is covered in `packages/protocol/src/parse.test.ts`.
});
