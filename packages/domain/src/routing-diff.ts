/**
 * Routing diff (architecture.md §3 "Routing diff").
 *
 * Compares a blessed baseline (§7, plan step 13) against the live mixer
 * state, entirely in the domain — no OSC, no store, no baseline persistence
 * here. Pure, order-stable, and defensive: malformed or partial input (a
 * channel missing from one side, a duplicate channel entry) is skipped
 * rather than thrown on, because a stray adapter/baseline value must not
 * blank the whole diagnostics panel.
 */

import type { MixerChannelId } from "./ids";
import type { MixerChannelState, MixerSourceRef } from "./mixer";
import { mixerSourceRefEquals } from "./mixer";

export type RoutingDiscrepancy =
  | {
      kind: "source-mismatch";
      channel: MixerChannelId;
      expected: MixerSourceRef;
      actual: MixerSourceRef;
    } // error
  | {
      kind: "name-mismatch";
      channel: MixerChannelId;
      expected: string;
      actual: string;
    } // informational
  | {
      kind: "unexpected-shared-source";
      source: MixerSourceRef;
      channels: MixerChannelId[];
    }; // shared in actual but not in expected

/** Fixed ordering for the two per-channel discrepancy kinds, error first. */
const PER_CHANNEL_KIND_ORDER: Record<
  "source-mismatch" | "name-mismatch",
  number
> = {
  "source-mismatch": 0,
  "name-mismatch": 1,
};

/**
 * Last entry for a channel wins, mirroring `buildRouteIndex`'s treatment of
 * a repeated channel — defensive against malformed input, never fatal.
 */
function toChannelMap(
  states: MixerChannelState[],
): Map<MixerChannelId, MixerChannelState> {
  const map = new Map<MixerChannelId, MixerChannelState>();
  for (const state of states) {
    map.set(state.channel, state);
  }
  return map;
}

/**
 * A canonical string per distinct `MixerSourceRef` value: doubles as a
 * dedupe key for grouping and a locale-independent sort key (plain string
 * comparison, not `localeCompare` — same reasoning as `routing.ts`'s
 * `compareEndpoints`: ordering must not vary with the host locale).
 */
function sourceSortKey(source: MixerSourceRef): string {
  const pad = (n: number) => String(n).padStart(4, "0");
  switch (source.kind) {
    case "aes50":
      return `aes50:${source.bus}:${pad(source.channel)}`;
    case "local":
      return `local:${pad(source.input)}`;
    case "card":
      return `card:${pad(source.input)}`;
    case "aux":
      return `aux:${pad(source.input)}`;
    case "usb":
      return `usb:${source.side}`;
    case "fx":
      return `fx:${pad(source.ret)}`;
    case "bus":
      return `bus:${pad(source.bus)}`;
    case "talkback":
      return `talkback:${source.which}`;
    case "off":
      return "off";
  }
}

interface SourceGroup {
  source: MixerSourceRef;
  channels: MixerChannelId[];
}

/**
 * Every non-`off` source with its consuming channels. `off` is excluded
 * because two channels both being off is never "sharing" a source.
 */
function groupBySource(
  byChannel: Map<MixerChannelId, MixerChannelState>,
): Map<string, SourceGroup> {
  const groups = new Map<string, SourceGroup>();
  for (const state of byChannel.values()) {
    if (state.source.kind === "off") continue;
    const key = sourceSortKey(state.source);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { source: state.source, channels: [state.channel] });
    } else {
      group.channels.push(state.channel);
    }
  }
  return groups;
}

/**
 * Diffs a baseline (`expected`) against live state (`actual`). Never
 * throws — a channel present on only one side is skipped rather than
 * flagged, since `MixerSnapshot` always carries all 32 and a mismatched
 * count here means the caller passed something malformed, not a real
 * discrepancy.
 */
export function compareRouting(
  expected: MixerChannelState[],
  actual: MixerChannelState[],
): RoutingDiscrepancy[] {
  const expectedByChannel = toChannelMap(expected);
  const actualByChannel = toChannelMap(actual);

  const perChannel: Array<
    Extract<RoutingDiscrepancy, { kind: "source-mismatch" | "name-mismatch" }>
  > = [];

  for (const [channel, exp] of expectedByChannel) {
    const act = actualByChannel.get(channel);
    if (act === undefined) continue;

    if (!mixerSourceRefEquals(exp.source, act.source)) {
      perChannel.push({
        kind: "source-mismatch",
        channel,
        expected: exp.source,
        actual: act.source,
      });
    }
    if (exp.name !== act.name) {
      perChannel.push({
        kind: "name-mismatch",
        channel,
        expected: exp.name,
        actual: act.name,
      });
    }
  }

  perChannel.sort(
    (a, b) =>
      a.channel - b.channel ||
      PER_CHANNEL_KIND_ORDER[a.kind] - PER_CHANNEL_KIND_ORDER[b.kind],
  );

  const expectedGroups = groupBySource(expectedByChannel);
  const actualGroups = groupBySource(actualByChannel);

  const shared: Array<
    Extract<RoutingDiscrepancy, { kind: "unexpected-shared-source" }>
  > = [];

  for (const [key, group] of actualGroups) {
    if (group.channels.length < 2) continue;
    const expectedGroup = expectedGroups.get(key);
    if (expectedGroup !== undefined && expectedGroup.channels.length >= 2) {
      continue; // shared in both — intentional, no flag.
    }
    shared.push({
      kind: "unexpected-shared-source",
      source: group.source,
      channels: [...group.channels].sort((a, b) => a - b),
    });
  }

  shared.sort((a, b) => {
    const keyA = sourceSortKey(a.source);
    const keyB = sourceSortKey(b.source);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  return [...perChannel, ...shared];
}
