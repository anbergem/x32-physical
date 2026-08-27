/**
 * `installation.yaml` → domain `Installation`.
 *
 * Browser-safe: no `node:fs`, no `node:path`. File loading lives in
 * `./node` (`@x32/installation/node`), so a web bundle never pulls in `fs`.
 *
 * Three layers, each failing fast with its own prefix so a broken file says
 * *which* stage rejected it:
 *
 * 1. **YAML syntax** — `yaml` reports line/column.
 * 2. **Schema** — Zod reports the document path (`devices.front-left.aes50`).
 * 3. **Topology** — `@x32/domain` reports the offending device or connection.
 */

import type {
  Device,
  EndpointRef,
  Installation,
  SocketAnnotation,
  TopologyEdge,
} from "@x32/domain";
import {
  assertValidInstallation,
  consoleOutput,
  destination,
  deviceId,
  localInput,
  mixerOutput,
  panelInput,
  stageboxInput,
  stageboxOutput,
} from "@x32/domain";
import { parse as parseYamlText } from "yaml";
import type { z } from "zod";

import type {
  DeviceDocument,
  FromEndpointDocument,
  InstallationDocument,
  ToEndpointDocument,
} from "./schema";
import { installationDocumentSchema } from "./schema";

/** Used in error messages when the caller does not name the source. */
const DEFAULT_SOURCE = "installation.yaml";

/**
 * Parses installation YAML into a validated domain `Installation`.
 *
 * @param text   the YAML document
 * @param source how to name the document in error messages — the bridge passes
 *               the file path; defaults to `installation.yaml`.
 * @throws Error on a YAML syntax error, a schema violation, or a topology rule
 *         violation. Nothing partial is ever returned.
 */
export function parseInstallationYaml(
  text: string,
  source: string = DEFAULT_SOURCE,
): Installation {
  const document = parseYaml(text, source);
  const parsed = validateShape(document, source);

  try {
    const installation = toInstallation(parsed);
    assertValidInstallation(installation);
    return installation;
  } catch (cause) {
    throw new Error(
      `Invalid installation topology in ${source}: ${messageOf(cause)}`,
      { cause },
    );
  }
}

/** Layer 1: YAML syntax. */
function parseYaml(text: string, source: string): unknown {
  try {
    return parseYamlText(text);
  } catch (cause) {
    throw new Error(
      `YAML syntax error in ${source}: ${messageOf(cause)}`,
      { cause },
    );
  }
}

/** Layer 2: document shape. */
function validateShape(
  document: unknown,
  source: string,
): InstallationDocument {
  const result = installationDocumentSchema.safeParse(document);
  if (result.success) return result.data;

  throw new Error(
    `Invalid installation schema in ${source}:\n${formatIssues(result.error)}`,
    { cause: result.error },
  );
}

type ZodIssue = z.ZodError["issues"][number];

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${formatPath(issue.path)}: ${describeIssue(issue)}`)
    .join("\n");
}

/**
 * A bad map key (`devices:` is a record) is reported by Zod as a bare
 * "Invalid key in record"; the reason lives in nested issues, so it is folded
 * back into the one line the reader sees.
 */
function describeIssue(issue: ZodIssue): string {
  if (issue.code !== "invalid_key" || issue.issues.length === 0) {
    return issue.message;
  }
  return `${issue.message} (${issue.issues.map((nested) => nested.message).join("; ")})`;
}

/** `["devices", "front-left", "aes50"]` → `devices.front-left.aes50`. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(document root)";
  return path.reduce<string>((rendered, segment) => {
    if (typeof segment === "number") return `${rendered}[${segment}]`;
    return rendered === "" ? String(segment) : `${rendered}.${String(segment)}`;
  }, "");
}

/**
 * Layer 3a: document → domain model.
 *
 * The schema has already guaranteed kebab-case ids and 1-based integer
 * sockets, so the endpoint constructors reject nothing that reaches here.
 * Their throws are still caught by the caller and labelled as a topology
 * failure, in case schema and constructors ever drift apart.
 */
function toInstallation(document: InstallationDocument): Installation {
  const devices: Device[] = Object.entries(document.devices).map(([id, device]) =>
    toDevice(id, device),
  );

  // The `to` endpoint's shape (`{ device, input }`) is identical for a
  // stagebox input and a console local-input; which domain constructor
  // applies depends on the named device's declared kind, so the document is
  // consulted here rather than guessed from the connection alone.
  const deviceKindById = new Map(
    Object.entries(document.devices).map(([id, device]) => [id, device.kind]),
  );

  const connections: TopologyEdge[] = document.connections.map((connection) => ({
    from: toFromEndpoint(connection.from),
    to: toToEndpoint(connection.to, deviceKindById),
  }));

  // Console XLR outs are addressed by number alone in YAML (no console
  // device — docs/installation.md §schema), and slot→XLR is the console's
  // identity default (Out n carries on console XLR n). That identity edge is
  // never written in YAML; it is derived here, once per console XLR the file
  // actually references, so `deriveOutputEdges`'s declared-connections pass
  // (@x32/domain topology.ts) has a mixer-output→console-output edge to
  // carry through, exactly as if it had been declared.
  const consoleOutputNumbers = new Set<number>();
  for (const connection of document.connections) {
    if (connection.from.consoleOutput !== undefined) {
      consoleOutputNumbers.add(connection.from.consoleOutput);
    }
  }
  for (const output of [...consoleOutputNumbers].sort((a, b) => a - b)) {
    connections.push({ from: mixerOutput(output), to: consoleOutput(output) });
  }

  return { devices, connections };
}

/**
 * The document's `sockets` map (string socket-number keys, since a YAML
 * mapping's keys land as JS object keys either way) → the domain's array
 * form. Shape only — `validateInstallation` checks range, duplicates and
 * "not also cabled".
 */
function toSocketAnnotations(
  sockets: Record<string, { status: "broken" | "unused"; note?: string }>,
): SocketAnnotation[] {
  return Object.entries(sockets).map(([input, annotation]) => ({
    input: Number(input),
    status: annotation.status,
    ...(annotation.note !== undefined ? { note: annotation.note } : {}),
  }));
}

function toDevice(id: string, document: DeviceDocument): Device {
  // The schema has already trimmed `group` and normalised an empty or
  // whitespace-only value to `undefined`, so the key is simply omitted when
  // the device is ungrouped (issue #20).
  const group =
    document.group !== undefined ? { group: document.group } : {};

  if (document.kind === "destination") {
    // `inputs: 0` is an internal detail the mapper supplies — the YAML never
    // asks a human to type it for a loudspeaker (issue #9 decisions).
    return {
      id: deviceId(id),
      kind: "destination",
      label: document.label,
      inputs: 0,
      ...group,
    };
  }

  const base = {
    id: deviceId(id),
    label: document.label,
    inputs: document.inputs,
    ...(document.sockets !== undefined
      ? { sockets: toSocketAnnotations(document.sockets) }
      : {}),
    ...group,
  };

  if (document.kind === "passive-panel") {
    return { ...base, kind: "passive-panel" };
  }

  if (document.kind === "console") {
    return { ...base, kind: "console" };
  }

  return {
    ...base,
    kind: "stagebox",
    aes50: { ...document.aes50 },
    ...(document.outputs !== undefined ? { outputs: document.outputs } : {}),
    ...(document.outputBlock !== undefined
      ? { outputBlock: { ...document.outputBlock } }
      : {}),
  };
}

/**
 * `from` side of a connection: a panel/stagebox input socket (existing form),
 * a stagebox XLR out, or a console XLR out. Which form a document carries is
 * already guaranteed by the schema's shape refinement — see
 * `fromEndpointSchema` — so exactly one branch matches.
 */
function toFromEndpoint(document: FromEndpointDocument): EndpointRef {
  if (document.consoleOutput !== undefined) {
    return consoleOutput(document.consoleOutput);
  }
  if (document.output !== undefined) {
    return stageboxOutput(document.device as string, document.output);
  }
  return panelInput(document.device as string, document.input as number);
}

/**
 * `to` side of a connection: a stagebox input socket or a console
 * local-input socket (both `{ device, input }`, disambiguated by the named
 * device's declared kind) or a destination device (`{ device }` alone, no
 * socket number).
 */
function toToEndpoint(
  document: ToEndpointDocument,
  deviceKindById: Map<string, DeviceDocument["kind"]>,
): EndpointRef {
  if (document.input !== undefined) {
    return deviceKindById.get(document.device) === "console"
      ? localInput(document.device, document.input)
      : stageboxInput(document.device, document.input);
  }
  return destination(document.device);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
