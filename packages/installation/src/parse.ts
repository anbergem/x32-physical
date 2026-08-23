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

import type { Device, Installation, TopologyEdge } from "@x32/domain";
import {
  assertValidInstallation,
  deviceId,
  panelInput,
  stageboxInput,
} from "@x32/domain";
import { parse as parseYamlText } from "yaml";
import type { z } from "zod";

import type { DeviceDocument, InstallationDocument } from "./schema";
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
  const installation = toInstallation(parsed, source);

  try {
    assertValidInstallation(installation);
  } catch (cause) {
    throw new Error(
      `Invalid installation topology in ${source}: ${messageOf(cause)}`,
      { cause },
    );
  }

  return installation;
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
 * Layer 3a: document → domain model. The endpoint constructors enforce the
 * 1-based socket numbering the schema deliberately leaves open, so their
 * throws are relabelled with the connection they came from.
 */
function toInstallation(
  document: InstallationDocument,
  source: string,
): Installation {
  const devices: Device[] = Object.entries(document.devices).map(([id, device]) =>
    toDevice(id, device),
  );

  const connections: TopologyEdge[] = document.connections.map(
    (connection, index) => {
      try {
        return {
          from: panelInput(connection.from.device, connection.from.input),
          to: stageboxInput(connection.to.device, connection.to.input),
        };
      } catch (cause) {
        throw new Error(
          `Invalid installation topology in ${source}: connection #${index + 1} ` +
            `(${connection.from.device} input ${connection.from.input} → ` +
            `${connection.to.device} input ${connection.to.input}): ` +
            messageOf(cause),
          { cause },
        );
      }
    },
  );

  return { devices, connections };
}

function toDevice(id: string, document: DeviceDocument): Device {
  const base = {
    id: deviceId(id),
    label: document.label,
    inputs: document.inputs,
  };

  return document.kind === "stagebox"
    ? { ...base, kind: "stagebox", aes50: { ...document.aes50 } }
    : { ...base, kind: "passive-panel" };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
