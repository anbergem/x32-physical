/**
 * Topology validation rules (architecture.md §3 "Validation").
 *
 * The rules live in the domain; the installation loader (plan step 3) calls
 * them after parsing YAML and fails fast with the resulting messages. Every
 * message names the offending device or connection so it is actionable
 * without reading code.
 *
 * Input-side rules (device ids, AES50 ranges, panel→stagebox cabling) are
 * untouched by the output milestone. Output-side rules (destination devices,
 * stagebox output blocks, the three output-side connection pairs) are
 * additive, dispatched by each connection's `from.kind`.
 */

import type {
  ConsoleOutputRef,
  DestinationRef,
  EndpointRef,
  LocalInputRef,
  MixerOutputRef,
  PanelInputRef,
  StageboxInputRef,
  StageboxOutputRef,
} from "./endpoints";
import { endpointId } from "./endpoints";
import type { DeviceId, EndpointId } from "./ids";
import { AES50_CHANNEL_COUNT, MIXER_OUTPUT_COUNT } from "./ids";
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
  | "stagebox-input-multiple-sources"
  | "output-out-of-range"
  | "console-output-multiple-sources"
  | "physical-output-multiple-destinations"
  | "invalid-output-block"
  | "output-block-overlap"
  | "unexpected-destination-fields"
  | "multiple-console-devices"
  | "local-input-multiple-sources";

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

interface OutputBlockRange {
  device: Device;
  first: number;
  last: number;
}

/** How a connection endpoint is described in messages. */
function describe(ref: EndpointRef): string {
  switch (ref.kind) {
    case "panel-input":
    case "stagebox-input":
    case "local-input":
      return `${ref.device} input ${ref.input}`;
    case "aes50-channel":
      return `AES50-${ref.bus} channel ${ref.channel}`;
    case "mixer-channel":
      return `mixer channel ${ref.channel}`;
    case "mixer-output":
      return `output slot ${ref.output}`;
    case "console-output":
      return `console XLR out ${ref.output}`;
    case "stagebox-output":
      return `${ref.device} out ${ref.output}`;
    case "destination":
      return `destination ${ref.device}`;
  }
}

/** Endpoints that name a device and one of its input sockets. */
function isDeviceEndpoint(
  ref: EndpointRef,
): ref is PanelInputRef | StageboxInputRef | LocalInputRef {
  return (
    ref.kind === "panel-input" ||
    ref.kind === "stagebox-input" ||
    ref.kind === "local-input"
  );
}

const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  "passive-panel": "passive panel",
  stagebox: "stagebox",
  destination: "destination",
  console: "console",
};

const VALID_CONNECTION_PAIRS_DESCRIPTION =
  "panel-input → stagebox-input, panel-input → local-input, " +
  "mixer-output → console-output, stagebox-output → destination, or " +
  "console-output → destination";

/**
 * One of the four connection shapes a `from`/`to` pair may take. `deviceKind`
 * is absent for endpoints with no device (mixer-output, console-output): a
 * console Out slot and a console XLR are addressed by number alone.
 */
interface ConnectionPair {
  fromKind: EndpointRef["kind"];
  toKind: EndpointRef["kind"];
  fromDeviceKind?: DeviceKind;
  toDeviceKind?: DeviceKind;
}

const CONNECTION_PAIRS: ConnectionPair[] = [
  {
    fromKind: "panel-input",
    toKind: "stagebox-input",
    fromDeviceKind: "passive-panel",
    toDeviceKind: "stagebox",
  },
  { fromKind: "mixer-output", toKind: "console-output" },
  {
    fromKind: "stagebox-output",
    toKind: "destination",
    fromDeviceKind: "stagebox",
    toDeviceKind: "destination",
  },
  {
    fromKind: "console-output",
    toKind: "destination",
    toDeviceKind: "destination",
  },
  {
    fromKind: "panel-input",
    toKind: "local-input",
    fromDeviceKind: "passive-panel",
    toDeviceKind: "console",
  },
];

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
  const outputBlockRanges: OutputBlockRange[] = [];
  let consoleDevice: Device | undefined;

  for (const device of installation.devices) {
    const isDuplicate = devices.has(device.id);
    if (isDuplicate) {
      errors.push({
        code: "duplicate-device-id",
        device: device.id,
        message: `Duplicate device id "${device.id}": device ids must be unique.`,
      });
    } else {
      devices.set(device.id, device);
    }

    if (device.kind === "destination") {
      if (
        device.inputs !== 0 ||
        device.aes50 !== undefined ||
        device.outputs !== undefined ||
        device.outputBlock !== undefined
      ) {
        errors.push({
          code: "unexpected-destination-fields",
          device: device.id,
          message:
            `Destination "${device.id}" declares inputs/aes50/outputs/` +
            `outputBlock: a destination is a device-level endpoint with no ` +
            `sockets of its own (inputs must be 0, and aes50, outputs and ` +
            `outputBlock must be unset).`,
        });
      }
      continue;
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

    if (device.kind === "console" && device.aes50 !== undefined) {
      errors.push({
        code: "unexpected-aes50",
        device: device.id,
        message:
          `Console "${device.id}" declares an aes50 mapping: only ` +
          `stageboxes connect to an AES50 bus.`,
      });
    }

    if (device.kind === "console") {
      if (consoleDevice !== undefined) {
        errors.push({
          code: "multiple-console-devices",
          device: device.id,
          message:
            `Multiple console devices declared ("${consoleDevice.id}" and ` +
            `"${device.id}"): at most one console device is allowed.`,
        });
      } else {
        consoleDevice = device;
      }
    }

    if (device.kind === "stagebox" && device.outputBlock !== undefined) {
      const { start } = device.outputBlock;
      const startValid =
        Number.isInteger(start) && start >= 1 && start + 8 - 1 <= MIXER_OUTPUT_COUNT;
      if (!startValid) {
        errors.push({
          code: "invalid-output-block",
          device: device.id,
          message:
            `Stagebox "${device.id}" declares outputBlock.start=${start}: ` +
            `it must be an integer between 1 and ${MIXER_OUTPUT_COUNT - 7} so ` +
            `the 8 slots it presents (start … start + 7) fit within 1–` +
            `${MIXER_OUTPUT_COUNT}.`,
        });
      } else {
        const first = start;
        const last = start + 7;
        for (const other of outputBlockRanges) {
          if (first > other.last || last < other.first) continue;
          errors.push({
            code: "output-block-overlap",
            device: device.id,
            message:
              `Stageboxes "${other.device.id}" (Out ${other.first}–` +
              `${other.last}) and "${device.id}" (Out ${first}–${last}) ` +
              `present overlapping output blocks: adjust outputBlock.start.`,
          });
        }
        outputBlockRanges.push({ device, first, last });
      }
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

    // A duplicate id is the error to fix first; comparing its range against
    // its own twin would only add a misleading self-overlap.
    if (!offsetValid || !inputsValid || isDuplicate) continue;

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
  const fedLocalInputs = new Map<EndpointId, EndpointRef>();
  const fedConsoleOutputs = new Map<EndpointId, EndpointRef>();
  const fedDestinations = new Map<EndpointId, EndpointRef>();

  installation.connections.forEach((connection, index) => {
    // `panel-input` is `fromKind` for two shapes (stagebox-input and
    // local-input targets), so match on both `from` and `to` kind first; a
    // malformed connection (wrong `to` kind) falls back to the first pair
    // sharing its `fromKind`, which is what produces the "unsupported
    // connection" error below.
    const pair =
      CONNECTION_PAIRS.find(
        (p) => p.fromKind === connection.from.kind && p.toKind === connection.to.kind,
      ) ??
      CONNECTION_PAIRS.find((p) => p.fromKind === connection.from.kind) ??
      CONNECTION_PAIRS[0]!;

    const from = checkEndpoint(
      connection.from,
      "from",
      pair.fromKind,
      pair.fromDeviceKind,
      index,
      devices,
      errors,
    );
    const to = checkEndpoint(
      connection.to,
      "to",
      pair.toKind,
      pair.toDeviceKind,
      index,
      devices,
      errors,
    );

    if (pair === CONNECTION_PAIRS[0]) {
      // panel-input → stagebox-input: a stagebox input has at most one
      // feeding panel socket.
      if (to === undefined) return;
      const key = endpointId(to);
      const existing = fedStageboxInputs.get(key);
      if (existing !== undefined) {
        errors.push({
          code: "stagebox-input-multiple-sources",
          device: (to as StageboxInputRef).device,
          connectionIndex: index,
          message:
            `Stagebox input "${key}" is fed by more than one panel socket ` +
            `(${describe(existing)} and ${describe(connection.from)}): ` +
            `a stagebox input can have at most one feeding socket.`,
        });
        return;
      }
      if (from !== undefined) fedStageboxInputs.set(key, connection.from);
      return;
    }

    if (pair === CONNECTION_PAIRS[1]) {
      // mixer-output → console-output: a console Out slot may appear on at
      // most one console XLR.
      if (from === undefined || to === undefined) return;
      const key = endpointId(from);
      const existing = fedConsoleOutputs.get(key);
      if (existing !== undefined) {
        errors.push({
          code: "console-output-multiple-sources",
          connectionIndex: index,
          message:
            `Output slot "${key}" is declared on more than one console XLR ` +
            `out (${describe(existing)} and ${describe(to)}): a console Out ` +
            `slot may appear on at most one console XLR.`,
        });
        return;
      }
      fedConsoleOutputs.set(key, to);
      return;
    }

    if (pair === CONNECTION_PAIRS[4]) {
      // panel-input → local-input: a console input has at most one feeding
      // panel socket, mirroring the stagebox-input rule above.
      if (to === undefined) return;
      const key = endpointId(to);
      const existing = fedLocalInputs.get(key);
      if (existing !== undefined) {
        errors.push({
          code: "local-input-multiple-sources",
          device: (to as LocalInputRef).device,
          connectionIndex: index,
          message:
            `Console input "${key}" is fed by more than one panel socket ` +
            `(${describe(existing)} and ${describe(connection.from)}): ` +
            `a console input can have at most one feeding socket.`,
        });
        return;
      }
      if (from !== undefined) fedLocalInputs.set(key, connection.from);
      return;
    }

    // stagebox-output → destination, console-output → destination: a
    // physical output feeds at most one destination.
    if (from === undefined || to === undefined) return;
    const key = endpointId(from);
    const existing = fedDestinations.get(key);
    if (existing !== undefined) {
      errors.push({
        code: "physical-output-multiple-destinations",
        connectionIndex: index,
        message:
          `Physical output "${key}" is cabled to more than one destination ` +
          `(${describe(existing)} and ${describe(to)}): a physical output ` +
          `feeds at most one destination.`,
      });
      return;
    }
    fedDestinations.set(key, to);
  });

  return errors;
}

/**
 * Checks one side of a connection. Returns the ref when it is usable (right
 * kind, existing device of the right kind when it has one, in-range number).
 */
function checkEndpoint(
  ref: EndpointRef,
  side: "from" | "to",
  expectedKind: EndpointRef["kind"],
  expectedDeviceKind: DeviceKind | undefined,
  index: number,
  devices: Map<DeviceId, Device>,
  errors: InstallationValidationError[],
): EndpointRef | undefined {
  const where = `Connection #${index + 1}`;

  if (ref.kind !== expectedKind) {
    errors.push({
      code: "unsupported-connection",
      connectionIndex: index,
      message:
        `${where}: "${side}" is a ${ref.kind} (${describe(ref)}), which is ` +
        `not valid there — connections must run ` +
        `${VALID_CONNECTION_PAIRS_DESCRIPTION}.`,
    });
    return undefined;
  }

  // No device on this side (mixer-output, console-output): just the number
  // range, since there is no device to look up or match kinds against.
  if (expectedDeviceKind === undefined) {
    const numbered = ref as MixerOutputRef | ConsoleOutputRef;
    if (
      !Number.isInteger(numbered.output) ||
      numbered.output < 1 ||
      numbered.output > MIXER_OUTPUT_COUNT
    ) {
      errors.push({
        code: "output-out-of-range",
        connectionIndex: index,
        message:
          `${where}: "${side}" uses output ${numbered.output}, which must ` +
          `be between 1 and ${MIXER_OUTPUT_COUNT}.`,
      });
      return undefined;
    }
    return ref;
  }

  if (!isDeviceEndpoint(ref) && !isOutputDeviceEndpoint(ref)) {
    // Unreachable given the kind check above (every kind with a
    // `deviceKind` also carries a `device` field), but keeps this function
    // total without an unsafe cast.
    return undefined;
  }

  const deviceRef = ref as
    | PanelInputRef
    | StageboxInputRef
    | LocalInputRef
    | StageboxOutputRef
    | DestinationRef;
  const device = devices.get(deviceRef.device);

  if (device === undefined) {
    errors.push({
      code: "unknown-device",
      connectionIndex: index,
      device: deviceRef.device,
      message:
        `${where}: "${side}" references unknown device ` +
        `"${deviceRef.device}".`,
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

  if (deviceRef.kind === "destination") {
    // A destination has no socket number to range-check.
    return deviceRef;
  }

  const maxNumber =
    deviceRef.kind === "stagebox-output" ? (device.outputs ?? 0) : device.inputs;
  const number =
    deviceRef.kind === "stagebox-output" ? deviceRef.output : deviceRef.input;
  const code =
    deviceRef.kind === "stagebox-output" ? "output-out-of-range" : "input-out-of-range";
  const noun = deviceRef.kind === "stagebox-output" ? "output" : "input";

  if (!Number.isInteger(number) || number < 1 || number > maxNumber) {
    errors.push({
      code,
      connectionIndex: index,
      device: device.id,
      message:
        `${where}: "${side}" uses ${noun} ${number} of device ` +
        `"${device.id}", which has ${noun}s 1–${maxNumber}.`,
    });
    return undefined;
  }

  return deviceRef;
}

/** Endpoints on the output side that name a device (stagebox-output, destination). */
function isOutputDeviceEndpoint(
  ref: EndpointRef,
): ref is StageboxOutputRef | DestinationRef {
  return ref.kind === "stagebox-output" || ref.kind === "destination";
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
