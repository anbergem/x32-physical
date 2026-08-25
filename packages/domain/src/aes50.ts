/**
 * AES50 link state + detected box chain (issue #17; docs/x32-protocol.md
 * §The messages we track, `/-stat/aes50/[A,B]` and `/-stat/aes50/state`).
 *
 * These are domain-level shapes only — no OSC, no bitfield/letter decoding
 * here. `apps/x32-bridge/src/x32/aes50.ts` is the only place that turns the
 * console's raw string/int wire values into these types (CLAUDE.md
 * invariant 3: OSC knowledge stays in `src/x32/`).
 */

import type { Device, Installation } from "./topology";
import type { Aes50Bus, DeviceId } from "./ids";

/** One AES50 bus's audio/aux error bits, decoded from `/-stat/aes50/state`. */
export interface Aes50BusLinkState {
  bus: Aes50Bus;
  audioError: boolean;
  auxError: boolean;
}

/**
 * The full decode of `/-stat/aes50/state`: per-bus error bits, plus the
 * single `locked` bit (bit 4), which is not per-bus. Captured for
 * completeness but not surfaced in the UI yet (issue #17 "Out of scope").
 */
export interface Aes50LinkState {
  buses: Aes50BusLinkState[];
  locked: boolean;
}

/** One detected box in a bus's chain, from `/-stat/aes50/[A,B]`. */
export interface Aes50ChainBox {
  /** 1-based position in the 4-slot chain string. */
  position: number;
  /** The mapped model name, or `null` for an unrecognised device letter. */
  model: string | null;
  /** The raw letter as read off the wire, kept even when `model` is `null`. */
  rawLetter: string;
}

/** The detected chain for one AES50 bus. Positions with no box are omitted. */
export interface Aes50Chain {
  bus: Aes50Bus;
  boxes: Aes50ChainBox[];
}

export function aes50LinkStateEquals(a: Aes50LinkState, b: Aes50LinkState): boolean {
  if (a.locked !== b.locked) return false;
  if (a.buses.length !== b.buses.length) return false;
  return a.buses.every((busState, index) => {
    const other = b.buses[index];
    return (
      other !== undefined &&
      other.bus === busState.bus &&
      other.audioError === busState.audioError &&
      other.auxError === busState.auxError
    );
  });
}

export function aes50ChainEquals(a: Aes50Chain, b: Aes50Chain): boolean {
  if (a.bus !== b.bus) return false;
  if (a.boxes.length !== b.boxes.length) return false;
  return a.boxes.every((box, index) => {
    const other = b.boxes[index];
    return (
      other !== undefined &&
      other.position === box.position &&
      other.model === box.model &&
      other.rawLetter === box.rawLetter
    );
  });
}

/**
 * The known analog/digital input count for a subset of detected models
 * (docs/x32-protocol.md, "Verified facts"). Deliberately partial: a model
 * not in this table produces no discrepancy rather than a guessed one — an
 * unrecognised or unlisted model is our gap, not a venue fault (issue #17
 * "Unknown device letters must produce no finding").
 */
const KNOWN_MODEL_INPUT_COUNTS: Readonly<Record<string, number>> = {
  S16: 16,
  SD16: 16,
  DL16: 16,
  S32: 32,
  DL32: 32,
  SD8: 8,
};

export type Aes50ChainDiscrepancy =
  | {
      kind: "box-count-mismatch";
      bus: Aes50Bus;
      expected: number;
      actual: number;
    }
  | {
      kind: "input-count-mismatch";
      bus: Aes50Bus;
      position: number;
      device: DeviceId;
      expectedInputs: number;
      detectedModel: string;
      detectedInputs: number;
    };

interface DeclaredStagebox {
  device: Device;
  offset: number;
}

function declaredStageboxesByBus(installation: Installation): Map<Aes50Bus, DeclaredStagebox[]> {
  const byBus = new Map<Aes50Bus, DeclaredStagebox[]>();
  for (const device of installation.devices) {
    if (device.kind !== "stagebox" || device.aes50 === undefined) continue;
    const list = byBus.get(device.aes50.bus) ?? [];
    list.push({ device, offset: device.aes50.offset });
    byBus.set(device.aes50.bus, list);
  }
  for (const list of byBus.values()) {
    list.sort((a, b) => a.offset - b.offset);
  }
  return byBus;
}

/**
 * Cross-checks the console's detected AES50 chain against what
 * `installation.yaml` declares (issue #17 "Domain — chain cross-check").
 * Pure, order-stable, never throws.
 *
 * Only buses the installation actually declares stageboxes on are compared
 * — a bus absent from `installation.yaml` (this venue's AES50-B) has
 * nothing to check against, so it never produces a finding here (the UI
 * layer separately decides not to warn about an unused bus's *link* errors,
 * but this function simply has no declared expectation to compare).
 *
 * `chains` with no entry for a bus, or an empty array altogether, means
 * "no chain data yet" — absence is not evidence, so nothing is flagged
 * (issue #17's domain test: "Empty/absent chain data → no discrepancy").
 *
 * Never attempts to auto-correct `installation.yaml` — this only reports.
 */
export function compareAes50Chain(
  installation: Installation,
  chains: readonly Aes50Chain[],
): Aes50ChainDiscrepancy[] {
  const declaredByBus = declaredStageboxesByBus(installation);
  const findings: Aes50ChainDiscrepancy[] = [];

  const busOrder: Aes50Bus[] = ["A", "B"];
  for (const bus of busOrder) {
    const declared = declaredByBus.get(bus);
    if (declared === undefined || declared.length === 0) continue; // nothing declared on this bus

    const chain = chains.find((candidate) => candidate.bus === bus);
    if (chain === undefined) continue; // no chain data for this bus yet

    const detected = [...chain.boxes].sort((a, b) => a.position - b.position);
    // Zero detected boxes is indistinguishable at this layer from "no chain
    // data received yet" (the adapter may report an empty chain string
    // before the console has replied) — treat it the same as an absent
    // entry rather than flag it (issue #17: "absence is not evidence").
    if (detected.length === 0) continue;

    if (detected.length !== declared.length) {
      findings.push({
        kind: "box-count-mismatch",
        bus,
        expected: declared.length,
        actual: detected.length,
      });
      continue; // counts already disagree; per-box comparison would be meaningless
    }

    for (let i = 0; i < declared.length; i += 1) {
      const declaredBox = declared[i];
      const detectedBox = detected[i];
      if (declaredBox === undefined || detectedBox === undefined) continue;
      if (detectedBox.model === null) continue; // unrecognised letter — no finding

      const expectedInputs = KNOWN_MODEL_INPUT_COUNTS[detectedBox.model];
      if (expectedInputs === undefined) continue; // known letter, but not in the input-count table

      if (expectedInputs !== declaredBox.device.inputs) {
        findings.push({
          kind: "input-count-mismatch",
          bus,
          position: detectedBox.position,
          device: declaredBox.device.id,
          expectedInputs: declaredBox.device.inputs,
          detectedModel: detectedBox.model,
          detectedInputs: expectedInputs,
        });
      }
    }
  }

  return findings;
}
