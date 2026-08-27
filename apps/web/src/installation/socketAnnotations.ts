/**
 * Per-installation memo of every declared socket annotation (issue #12),
 * keyed by the socket's own `EndpointId` so `PhysicalInputPanel` and the
 * tooltip formatter share one answer to "is this socket broken or unused,
 * and why" — purely descriptive, never a routing fact (`Device.sockets`,
 * `SocketAnnotation` — `@x32/domain`).
 *
 * Same caching shape as `aes50Labels.ts`/`outputCabling.ts`: `installation`
 * is structural (CLAUDE.md invariant 1), so a `WeakMap` computes this once
 * per installation object for the app's whole lifetime.
 */

import type { EndpointId, Installation, SocketAnnotation } from "@x32/domain";
import { endpointId, localInput, panelInput, stageboxInput } from "@x32/domain";

const cache = new WeakMap<Installation, Map<EndpointId, SocketAnnotation>>();

function computeSocketAnnotations(
  installation: Installation,
): Map<EndpointId, SocketAnnotation> {
  const map = new Map<EndpointId, SocketAnnotation>();

  for (const device of installation.devices) {
    if (device.sockets === undefined) continue;
    for (const annotation of device.sockets) {
      const ref =
        device.kind === "passive-panel"
          ? panelInput(device.id, annotation.input)
          : device.kind === "console"
            ? localInput(device.id, annotation.input)
            : stageboxInput(device.id, annotation.input);
      map.set(endpointId(ref), annotation);
    }
  }

  return map;
}

/**
 * Every annotated socket in the installation, keyed by `EndpointId`. A
 * socket absent from this map carries no declared annotation — a normal
 * socket, whether cabled or not.
 */
export function socketAnnotationsFor(
  installation: Installation,
): Map<EndpointId, SocketAnnotation> {
  const cached = cache.get(installation);
  if (cached !== undefined) return cached;

  const computed = computeSocketAnnotations(installation);
  cache.set(installation, computed);
  return computed;
}
