/**
 * Zod schema for `installation.yaml` v1 (docs/installation.md §schema).
 *
 * Layering: this schema validates **shape only** — key names, value types, and
 * which fields each device kind may carry. Every semantic rule (`inputs ≥ 1`,
 * AES50 bounds and overlaps, connection direction, unknown devices, duplicate
 * feeds, in-range sockets) belongs to `validateInstallation` in `@x32/domain`
 * and is deliberately *not* restated here: one rule, one owner.
 */

import { z } from "zod";

/**
 * Mirrors `deviceId()` in `@x32/domain`. Checked here as well so a malformed
 * key is reported with its YAML path instead of as a bare constructor throw.
 */
const DEVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const deviceIdSchema = z
  .string()
  .regex(DEVICE_ID_PATTERN, 'must be a kebab-case device id (e.g. "front-left")');

const aes50Schema = z.strictObject({
  bus: z.enum(["A", "B"]),
  /**
   * `offset: int ≥ 0` is part of the declared field shape. Whether the
   * resulting channel range fits the bus, or collides with another box, is a
   * topology rule and stays in the domain.
   */
  offset: z.number().int().min(0),
});

/** `inputs` is typed here; `inputs ≥ 1` is a domain rule. */
const deviceFields = {
  label: z.string(),
  inputs: z.number().int(),
};

const stageboxSchema = z.strictObject({
  kind: z.literal("stagebox"),
  ...deviceFields,
  aes50: aes50Schema,
});

const passivePanelSchema = z.strictObject({
  kind: z.literal("passive-panel"),
  ...deviceFields,
  // No `aes50` key: the strict object rejects one, because only a stagebox
  // reaches an AES50 bus.
});

const deviceSchema = z.discriminatedUnion("kind", [
  stageboxSchema,
  passivePanelSchema,
]);

/**
 * One end of a cabled connection: a device and one of its input sockets.
 *
 * Socket numbers are 1-based, so `≥ 1` is part of the shape — a zero or
 * negative socket is not a topology question. Whether the socket exists on
 * *that* device is, and stays with the domain.
 */
const connectionEndpointSchema = z.strictObject({
  device: deviceIdSchema,
  input: z.number().int().min(1),
});

const connectionSchema = z.strictObject({
  from: connectionEndpointSchema,
  to: connectionEndpointSchema,
});

/**
 * The whole document. `devices` is a map keyed by `DeviceId`; stagebox→AES50
 * edges are derived from `aes50.offset` and are never written in YAML.
 */
export const installationDocumentSchema = z.strictObject({
  version: z.literal(1),
  devices: z.record(deviceIdSchema, deviceSchema),
  connections: z.array(connectionSchema),
});

/** The YAML document's shape, before it becomes a domain `Installation`. */
export type InstallationDocument = z.infer<typeof installationDocumentSchema>;

export type DeviceDocument = z.infer<typeof deviceSchema>;
