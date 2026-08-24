/**
 * WebSocket message types shared between bridge and web (architecture.md §7).
 * No hand-duplicated JSON shapes: the wire types reuse domain and
 * mixer-contracts types directly, and every inbound message passes through
 * the guards below before anything downstream trusts it.
 */

export type { ClientMessage, ServerMessage, UpdateAvailable } from "./messages";
export { parseClientMessage, parseMixerSnapshot, parseServerMessage } from "./parse";
