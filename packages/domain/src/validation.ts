/**
 * Topology validation rules (architecture.md §3 "Validation").
 *
 * The rules live in the domain; the installation loader (plan step 3) calls
 * them after parsing YAML and fails fast with the resulting messages. Every
 * message names the offending device or connection so it is actionable
 * without reading code.
 */

import type { EndpointRef, PanelInputRef, StageboxInputRef } from "./endpoints";
import { endpointId } from "./endpoints";
import type { DeviceId, EndpointId } from "./ids";
import { AES50_CHANNEL_COUNT } from "./ids";
import type { Device, DeviceKind, Installation } from "./topology";

export type InstallationValidationErrorCode =
  | "duplicate-device-id"
  | "invalid-input-count"
  | "missing-aes50"
  | "unexpected-aes50"
  | "invalid-aes50-offset"
  | "aes50-range-out-of-bounds"
  | "aes50-range-overlap"
  | "unsupported-connection"
  | "unknown-device"
  | "device-kind-mismatch"
  | "input-out-of-range"
  | "stagebox-input-multiple-sources";

export interface InstallationValidationError {
  code: InstallationValidationErrorCode;
  /** Human-actionable message naming the offending device or connection. */
  message: string;
  device?: DeviceId;
  /** 0-based index into `installation.connections`. */
  connectionIndex?: number;
}

interface Aes50Range {
  device: Device;
  bus: string;
  first: number;
  last: number;
}

/** How a connection endpoint is described in messages. */
function describe(ref: EndpointRef): string {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
      return `${ref.device} input ${ref.input}`;
    case "aes50-channel":
      return `AES50-${ref.bus} channel ${ref.channel}`;
    case "mixer-channel":
      return `mixer channel ${ref.channel}`;
  }
}

/** Endpoints that name a device and one of its input sockets. */
function isDeviceEndpoint(
  ref: EndpointRef,
): ref is PanelInputRef | StageboxInputRef {
  return ref.kind === "panel-input" || ref.kind === "stagebox-input";
}

const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  "passive-panel": "passive panel",
  stagebox: "stagebox",
};

/**
 * Validates an installation against every documented topology rule.
 * Returns the full list of problems — empty means valid.
 */
export function validateInstallation(
  installation: Installation,
): InstallationValidationError[] {
  const errors: InstallationValidationError[] = [];
  const devices = new Map<DeviceId, Device>();
  const ranges: Aes50Range[] = [];

  for (const device of installation.devices) {
    if (devices.has(device.id)) {
      errors.push({
        code: "duplicate-device-id",
        device: device.id,
        message: `Duplicate device id "${device.id}": device ids must be unique.`,
      });
    } else {
      devices.set(device.id, device);
    }

    const inputsValid = Number.isInteger(device.inputs) && device.inputs >= 1;
    if (!inputsValid) {
      errors.push({
        code: "invalid-input-count",
        device: device.id,
        message:
          `Device "${device.id}" declares inputs=${device.inputs}: ` +
          `a device must have at least 1 input.`,
      });
    }

    if (device.kind === "stagebox" && device.aes50 === undefined) {
      errors.push({
        code: "missing-aes50",
        device: device.id,
        message:
          `Stagebox "${device.id}" is missing its aes50 mapping: ` +
          `stageboxes must declare { bus, offset }.`,
      });
    }

    if (device.kind === "passive-panel" && device.aes50 !== undefined) {
      errors.push({
        code: "unexpected-aes50",
        device: device.id,
        message:
          `Passive panel "${device.id}" declares an aes50 mapping: ` +
          `only stageboxes connect to an AES50 bus.`,
      });
    }

    const aes50 = device.aes50;
    if (aes50 === undefined) continue;

    const offsetValid = Number.isInteger(aes50.offset) && aes50.offset >= 0;
    if (!offsetValid) {
      errors.push({
        code: "invalid-aes50-offset",
        device: device.id,
        message:
          `Device "${device.id}" has AES50 offset ${aes50.offset}: ` +
          `the offset must be an integer of 0 or more.`,
      });
    }

    if (!offsetValid || !inputsValid) continue;

    const first = aes50.offset + 1;
    const last = aes50.offset + device.inputs;
    if (last > AES50_CHANNEL_COUNT) {
      errors.push({
        code: "aes50-range-out-of-bounds",
        device: device.id,
        message:
          `Device "${device.id}" occupies AES50-${aes50.bus} channels ` +
          `${first}–${last} (offset ${aes50.offset} + ${device.inputs} inputs), ` +
          `which exceeds the bus range 1–${AES50_CHANNEL_COUNT}.`,
      });
    }

    for (const other of ranges) {
      if (other.bus !== aes50.bus) continue;
      if (first > other.last || last < other.first) continue;
      errors.push({
        code: "aes50-range-overlap",
        device: device.id,
        message:
          `Devices "${other.device.id}" (AES50-${other.bus} ` +
          `${other.first}–${other.last}) and "${device.id}" (AES50-` +
          `${aes50.bus} ${first}–${last}) overlap on the same bus: ` +
          `adjust the cascade offsets.`,
      });
    }

    ranges.push({ device, bus: aes50.bus, first, last });
  }

  const fedStageboxInputs = new Map<EndpointId, EndpointRef>();

  installation.connections.forEach((connection, index) => {
    const from = checkEndpoint(
      connection.from,
      "from",
      "panel-input",
      "passive-panel",
      index,
      devices,
      errors,
    );
    const to = checkEndpoint(
      connection.to,
      "to",
      "stagebox-input",
      "stagebox",
      index,
      devices,
      errors,
    );

    if (to === undefined) return;

    const key = endpointId(to);
    const existing = fedStageboxInputs.get(key);
    if (existing !== undefined) {
      errors.push({
        code: "stagebox-input-multiple-sources",
        device: to.device,
        connectionIndex: index,
        message:
          `Stagebox input "${key}" is fed by more than one panel socket ` +
          `(${describe(existing)} and ${describe(connection.from)}): ` +
          `a stagebox input can have at most one feeding socket.`,
      });
      return;
    }

    if (from !== undefined) fedStageboxInputs.set(key, connection.from);
  });

  return errors;
}

/**
 * Checks one side of a connection. Returns the ref when it is usable
 * (right kind, existing device of the right kind, in-range input).
 */
function checkEndpoint(
  ref: EndpointRef,
  side: "from" | "to",
  expectedKind: "panel-input" | "stagebox-input",
  expectedDeviceKind: DeviceKind,
  index: number,
  devices: Map<DeviceId, Device>,
  errors: InstallationValidationError[],
): PanelInputRef | StageboxInputRef | undefined {
  const where = `Connection #${index + 1}`;

  if (ref.kind !== expectedKind || !isDeviceEndpoint(ref)) {
    errors.push({
      code: "unsupported-connection",
      connectionIndex: index,
      message:
        `${where}: "${side}" is a ${ref.kind} (${describe(ref)}), ` +
        `but only ${expectedKind} is supported there — connections must run ` +
        `panel-input → stagebox-input.`,
    });
    return undefined;
  }

  const endpoint = ref;
  const device = devices.get(endpoint.device);

  if (device === undefined) {
    errors.push({
      code: "unknown-device",
      connectionIndex: index,
      device: endpoint.device,
      message:
        `${where}: "${side}" references unknown device ` +
        `"${endpoint.device}".`,
    });
    return undefined;
  }

  if (device.kind !== expectedDeviceKind) {
    errors.push({
      code: "device-kind-mismatch",
      connectionIndex: index,
      device: device.id,
      message:
        `${where}: "${side}" uses device "${device.id}" as a ` +
        `${DEVICE_KIND_LABEL[expectedDeviceKind]}, but it is declared as a ` +
        `${DEVICE_KIND_LABEL[device.kind]}.`,
    });
    return undefined;
  }

  if (
    !Number.isInteger(endpoint.input) ||
    endpoint.input < 1 ||
    endpoint.input > device.inputs
  ) {
    errors.push({
      code: "input-out-of-range",
      connectionIndex: index,
      device: device.id,
      message:
        `${where}: "${side}" uses input ${endpoint.input} of device ` +
        `"${device.id}", which has inputs 1–${device.inputs}.`,
    });
    return undefined;
  }

  return endpoint;
}

/** Fail-fast wrapper for loaders: throws with every message at once. */
export function assertValidInstallation(installation: Installation): void {
  const errors = validateInstallation(installation);
  if (errors.length === 0) return;
  throw new Error(
    `Invalid installation (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n` +
      errors.map((error) => `  - ${error.message}`).join("\n"),
  );
}
