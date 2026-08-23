/**
 * OSC address strings for the subset docs/x32-protocol.md §The messages we
 * track defines: builders for outgoing address-only reads, and a parser that
 * classifies an incoming address for `x32MixerClient.ts`'s single decode
 * handler (the same one snapshot replies and live `/xremote` pushes both go
 * through). An address outside this table classifies as `"unknown"` and is
 * ignored — e.g. `/config/routing/IN/AUX`, explicitly out of MVP scope.
 */

const IN_BLOCK_RANGES = ["1-8", "9-16", "17-24", "25-32"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function xinfoAddress(): string {
  return "/xinfo";
}

export function xremoteAddress(): string {
  return "/xremote";
}

export function routswitchAddress(): string {
  return "/config/routing/routswitch";
}

export function inBlockAddress(blockIndex: 0 | 1 | 2 | 3): string {
  return `/config/routing/IN/${IN_BLOCK_RANGES[blockIndex]}`;
}

/** `slot` is 1–32, matching the doc's `[01…32]` bracket notation. */
export function userRoutAddress(slot: number): string {
  return `/config/userrout/in/${pad2(slot)}`;
}

export function channelNameAddress(channel: number): string {
  return `/ch/${pad2(channel)}/config/name`;
}

export function channelSourceAddress(channel: number): string {
  return `/ch/${pad2(channel)}/config/source`;
}

export function selidxAddress(): string {
  return "/-stat/selidx";
}

export type ParsedAddress =
  | { kind: "xinfo" }
  | { kind: "routswitch" }
  | { kind: "in-block"; blockIndex: 0 | 1 | 2 | 3 }
  | { kind: "user-rout"; slot: number }
  | { kind: "channel-name"; channel: number }
  | { kind: "channel-source"; channel: number }
  | { kind: "selidx" }
  | { kind: "unknown" };

const USER_ROUT_PATTERN = /^\/config\/userrout\/in\/(\d{2})$/;
const CHANNEL_PATTERN = /^\/ch\/(\d{2})\/config\/(name|source)$/;

/** Classifies an incoming address; addresses we don't track come back `"unknown"`. */
export function parseAddress(address: string): ParsedAddress {
  if (address === "/xinfo") return { kind: "xinfo" };
  if (address === "/config/routing/routswitch") return { kind: "routswitch" };
  if (address === "/-stat/selidx") return { kind: "selidx" };

  const inBlockPrefix = "/config/routing/IN/";
  if (address.startsWith(inBlockPrefix)) {
    const range = address.slice(inBlockPrefix.length);
    const blockIndex = IN_BLOCK_RANGES.indexOf(range as (typeof IN_BLOCK_RANGES)[number]);
    if (blockIndex !== -1) return { kind: "in-block", blockIndex: blockIndex as 0 | 1 | 2 | 3 };
    return { kind: "unknown" }; // e.g. /config/routing/IN/AUX — out of MVP scope
  }

  const userRoutMatch = USER_ROUT_PATTERN.exec(address);
  if (userRoutMatch?.[1] !== undefined) {
    const slot = Number(userRoutMatch[1]);
    if (slot >= 1 && slot <= 32) return { kind: "user-rout", slot };
    return { kind: "unknown" };
  }

  const channelMatch = CHANNEL_PATTERN.exec(address);
  if (channelMatch?.[1] !== undefined && channelMatch[2] !== undefined) {
    const channel = Number(channelMatch[1]);
    if (channel < 1 || channel > 32) return { kind: "unknown" };
    return channelMatch[2] === "name"
      ? { kind: "channel-name", channel }
      : { kind: "channel-source", channel };
  }

  return { kind: "unknown" };
}
