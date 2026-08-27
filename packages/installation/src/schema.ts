/**
 * Zod schema for `installation.yaml` v1/v2 (docs/installation.md §schema).
 *
 * Layering: this schema validates **shape only** — key names, value types, and
 * which fields each device kind may carry. Every semantic rule (`inputs ≥ 1`,
 * AES50 bounds and overlaps, output-block bounds and overlaps, connection
 * direction, unknown devices, duplicate feeds, in-range sockets) belongs to
 * `validateInstallation` in `@x32/domain` and is deliberately *not* restated
 * here: one rule, one owner.
 *
 * `version: 1` and `version: 2` are accepted and treated identically — every
 * addition below is optional, so a v1 file (no output content) remains valid.
 * `2` is only a signal that the file uses output features; it changes no
 * behavior (docs/installation.md §schema).
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

const outputBlockSchema = z.strictObject({
  /**
   * The first console Out slot (1–16) this box's block presents. In-range
   * and non-overlapping-with-other-boxes are topology rules, not shape ones.
   */
  start: z.number().int(),
});

/**
 * One declared socket annotation (issue #12): "this socket is broken" or
 * "this socket is deliberately unused". Shape only — in-range input, no
 * duplicates and "not also cabled" are domain rules in `validateInstallation`.
 */
const socketAnnotationSchema = z.strictObject({
  status: z.enum(["broken", "unused"]),
  note: z.string().optional(),
});

/**
 * `sockets` is a map keyed by socket number (as a string key, like `devices`
 * itself — YAML mapping keys become JS object keys either way). Only
 * annotated sockets appear; a socket absent from the map is a normal one.
 */
const socketsSchema = z.record(
  z.string().regex(/^[1-9][0-9]*$/, "must be a socket number (1-based integer)"),
  socketAnnotationSchema,
);

/**
 * The optional `group` name (issue #20), accepted on every device kind. Shape
 * only: any string is a valid group, so there is nothing for
 * `validateInstallation` to check.
 *
 * Trimmed, and an empty or whitespace-only value normalises to `undefined`
 * rather than to a group literally named `""` — a stray `group: ""` should
 * leave the device ungrouped, not create a nameless group that a renderer
 * would later draw with a blank heading.
 */
const groupSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  });

/** `inputs` is typed here; `inputs ≥ 1` is a domain rule. */
const deviceFields = {
  label: z.string(),
  inputs: z.number().int(),
  sockets: socketsSchema.optional(),
  group: groupSchema,
};

const stageboxSchema = z.strictObject({
  kind: z.literal("stagebox"),
  ...deviceFields,
  aes50: aes50Schema,
  /** How many physical XLR outs the box has. Domain rule: ≥ 1. */
  outputs: z.number().int().optional(),
  /**
   * The block of console Out slots the box presents on those outs. Optional
   * as a pair with `outputs` — a box that declares one without the other is
   * a shape error, checked below (`installationDocumentSchema`'s refine):
   * a box that presents a block must say how many outs it has, and vice
   * versa.
   */
  outputBlock: outputBlockSchema.optional(),
});

const passivePanelSchema = z.strictObject({
  kind: z.literal("passive-panel"),
  ...deviceFields,
  // No `aes50` key: the strict object rejects one, because only a stagebox
  // reaches an AES50 bus.
});

/**
 * The console's own local XLR inputs (issue #2), as a device: `label` and
 * `inputs` like a passive panel, but no `aes50` — the desk's local inputs
 * never reach an AES50 bus. At most one console device is a domain rule, not
 * a shape one.
 */
const consoleSchema = z.strictObject({
  kind: z.literal("console"),
  ...deviceFields,
});

/**
 * A powered speaker or zone: label only. No `inputs`, `aes50`, `outputs` or
 * `outputBlock` — a destination is a device-level endpoint with no sockets of
 * its own, and `inputs: 0` is an internal detail the mapper supplies, never
 * authored in YAML. `group` *is* accepted here, like on every other kind:
 * destinations are exactly the devices a venue most wants to group.
 */
const destinationSchema = z.strictObject({
  kind: z.literal("destination"),
  label: z.string(),
  group: groupSchema,
});

const deviceSchema = z.discriminatedUnion("kind", [
  stageboxSchema,
  passivePanelSchema,
  destinationSchema,
  consoleSchema,
]);

/**
 * One end of a cabled connection. `from` may be:
 *
 * - `{ device, input }` — a panel or stagebox input socket (unchanged from
 *   v1: panel-input → stagebox-input cabling).
 * - `{ device, output }` — a stagebox XLR out socket.
 * - `{ consoleOutput }` — a console XLR out, addressed by number alone (no
 *   console device — docs/installation.md §schema).
 *
 * Socket/output numbers are 1-based, so `≥ 1` is part of the shape. Which
 * form is legal for a given `to` (and whether the device exists and is the
 * right kind) is a topology rule and stays in the domain.
 */
const fromEndpointSchema = z
  .strictObject({
    device: deviceIdSchema.optional(),
    input: z.number().int().min(1).optional(),
    output: z.number().int().min(1).optional(),
    consoleOutput: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasDevice = value.device !== undefined;
    const hasInput = value.input !== undefined;
    const hasOutput = value.output !== undefined;
    const hasConsoleOutput = value.consoleOutput !== undefined;

    const isInputForm = hasDevice && hasInput && !hasOutput && !hasConsoleOutput;
    const isStageboxOutputForm =
      hasDevice && hasOutput && !hasInput && !hasConsoleOutput;
    const isConsoleOutputForm =
      hasConsoleOutput && !hasDevice && !hasInput && !hasOutput;

    if (isInputForm || isStageboxOutputForm || isConsoleOutputForm) return;

    ctx.addIssue({
      code: "custom",
      message:
        'must be exactly one of "{ device, input }", "{ device, output }" ' +
        `or "{ consoleOutput }" — got keys [${Object.keys(value).join(", ")}]`,
    });
  });

/**
 * One end of a cabled connection. `to` may be:
 *
 * - `{ device, input }` — a stagebox input socket (unchanged from v1) or,
 *   since issue #2, a console local-input socket. Which one depends on the
 *   named device's declared `kind`.
 * - `{ device }` alone — a destination device, which has no socket number of
 *   its own.
 *
 * Whether the device exists, is the right kind, and (for the input form) the
 * socket is in range are topology rules and stay in the domain.
 */
const toEndpointSchema = z.strictObject({
  device: deviceIdSchema,
  input: z.number().int().min(1).optional(),
});

const connectionSchema = z.strictObject({
  from: fromEndpointSchema,
  to: toEndpointSchema,
});

/**
 * The whole document. `devices` is a map keyed by `DeviceId`; stagebox→AES50
 * and (for a stagebox declaring `outputBlock`) mixer-output→stagebox-output
 * edges are both derived by the domain and are never written in YAML.
 *
 * `version: 1` and `version: 2` behave identically — see the module doc.
 */
export const installationDocumentSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    devices: z.record(deviceIdSchema, deviceSchema),
    connections: z.array(connectionSchema),
  })
  .superRefine((document, ctx) => {
    for (const [id, device] of Object.entries(document.devices)) {
      if (device.kind !== "stagebox") continue;
      const hasOutputs = device.outputs !== undefined;
      const hasOutputBlock = device.outputBlock !== undefined;
      if (hasOutputs === hasOutputBlock) continue;

      const missing = hasOutputBlock ? "outputs" : "outputBlock";
      const present = hasOutputBlock ? "outputBlock" : "outputs";
      ctx.addIssue({
        code: "custom",
        path: ["devices", id, missing],
        message:
          `Stagebox "${id}" declares "${present}" without "${missing}": a ` +
          `stagebox that presents an output block must say how many outs ` +
          `it has, and a declared output count needs a block to sit in.`,
      });
    }
  });

/** The YAML document's shape, before it becomes a domain `Installation`. */
export type InstallationDocument = z.infer<typeof installationDocumentSchema>;

export type DeviceDocument = z.infer<typeof deviceSchema>;
export type FromEndpointDocument = z.infer<typeof fromEndpointSchema>;
export type ToEndpointDocument = z.infer<typeof toEndpointSchema>;
