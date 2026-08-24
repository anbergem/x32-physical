/**
 * Per-installation memo of `aes50ChannelsByEndpoint` (architecture.md §3), so
 * `Stagebox` and `PhysicalInputPanel` share exactly one answer to "what AES50
 * channel does this socket reach" — a panel label and a stagebox label can
 * never disagree — without recomputing it per socket or per render.
 *
 * `installation` is structural: set once at startup and never replaced
 * (CLAUDE.md invariant 1). A `WeakMap` keyed on that one object computes the
 * map exactly once for the app's whole lifetime, however many components ask
 * for it — nothing here goes in the store (runtime/derived slices have their
 * own lifecycle; this never changes at all).
 */

import type { Aes50ChannelRef, EndpointId, Installation } from "@x32/domain";
import { aes50ChannelsByEndpoint } from "@x32/domain";

const cache = new WeakMap<Installation, Map<EndpointId, Aes50ChannelRef>>();

export function aes50LabelsFor(
  installation: Installation,
): Map<EndpointId, Aes50ChannelRef> {
  const cached = cache.get(installation);
  if (cached !== undefined) return cached;

  const computed = aes50ChannelsByEndpoint(installation);
  cache.set(installation, computed);
  return computed;
}
