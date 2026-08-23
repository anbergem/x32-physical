/**
 * Branded identifiers (architecture.md §3).
 *
 * The brands exist so unrelated ids cannot be mixed accidentally. The
 * constructors below are the sanctioned way to create them: they validate the
 * documented ranges and are the only place that performs the brand cast.
 */

/** Id of a device in the installation (passive panel or stagebox). */
export type DeviceId = string & { __brand: "DeviceId" };

/** An X32 input channel, 1–32, 1-based. */
export type MixerChannelId = number & { __brand: "MixerChannelId" };

/** Canonical string encoding of an `EndpointRef` — see `endpointId`. */
export type EndpointId = string & { __brand: "EndpointId" };

/** The two AES50 buses the console exposes. */
export type Aes50Bus = "A" | "B";

/** X32 input channels, 1-based. */
export const MIXER_CHANNEL_COUNT = 32;

/** Channels carried by one AES50 bus, 1-based. */
export const AES50_CHANNEL_COUNT = 48;

/** Device ids are kebab-case (docs/installation.md §schema). */
const DEVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function deviceId(value: string): DeviceId {
  if (!DEVICE_ID_PATTERN.test(value)) {
    throw new Error(
      `Invalid device id "${value}": expected kebab-case ` +
        `(lowercase letters and digits separated by single hyphens).`,
    );
  }
  return value as DeviceId;
}

export function mixerChannelId(value: number): MixerChannelId {
  if (!Number.isInteger(value) || value < 1 || value > MIXER_CHANNEL_COUNT) {
    throw new Error(
      `Invalid mixer channel ${value}: expected an integer between 1 and ` +
        `${MIXER_CHANNEL_COUNT} (1-based).`,
    );
  }
  return value as MixerChannelId;
}

export function aes50Bus(value: string): Aes50Bus {
  if (value !== "A" && value !== "B") {
    throw new Error(`Invalid AES50 bus "${value}": expected "A" or "B".`);
  }
  return value;
}
