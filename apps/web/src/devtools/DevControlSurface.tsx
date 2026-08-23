/**
 * Dev-only mock control surface (plan step 8, mock mode only).
 *
 * This is a debugging aid for the debugging tool, not part of the schematic
 * (CLAUDE.md invariant 4/5, architecture.md §6): production code never writes
 * to the mixer, and this panel is the one place in the app that is allowed
 * to. It drives `MockMixerClient.simulate*` exclusively — never the store
 * directly — so every change here takes the exact same event path a real
 * console press would (`LocalMockGateway` → `applyToStore`), matching
 * architecture.md §8's event flow instead of shortcutting around it.
 *
 * Rendered only when the resolved gateway mode is `mock` (main.tsx decides
 * that, once, at bootstrap); this module is never reachable in live mode.
 */

import type { MixerChannelId, MixerSourceRef } from "@x32/domain";
import { MIXER_CHANNEL_COUNT, mixerChannelId } from "@x32/domain";
import type { MockMixerClient } from "@x32/mixer-contracts";
import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";

import { formatMixerSource } from "../format/source";
import { selectChannels, selectConnection, selectSelectedChannel } from "../state/selectors";
import { useAppStore } from "../state/storeContext";

/** Channel name is at most 12 characters on an X32 (docs/x32-protocol.md). */
const NAME_MAX_LENGTH = 12;

/** AES50 bus channels, 1-based (docs/x32-protocol.md). */
const AES50_CHANNELS = Array.from({ length: 48 }, (_, index) => index + 1);

/** Console Local (XLR) and Card inputs, 1-based (docs/x32-protocol.md). */
const CONSOLE_INPUTS = Array.from({ length: 32 }, (_, index) => index + 1);

const ALL_CHANNELS: MixerChannelId[] = Array.from(
  { length: MIXER_CHANNEL_COUNT },
  (_, index) => mixerChannelId(index + 1),
);

/** Encodes a source picker option as a stable string `<select>` value. */
function sourceOptionValue(kind: string, ...parts: (string | number)[]): string {
  return [kind, ...parts].join(":");
}

/**
 * The inverse of `sourceOptionValue`: turns the picked option back into a
 * proper `MixerSourceRef`, exactly the shape `simulateSourceChange` expects.
 * Every value this parses comes from an `<option>` rendered below, so an
 * unrecognised value can only mean this file's own two halves drifted apart.
 */
function parseSourceOption(value: string): MixerSourceRef {
  const [kind, a, b] = value.split(":");
  switch (kind) {
    case "aes50":
      return { kind: "aes50", bus: a as "A" | "B", channel: Number(b) };
    case "card":
      return { kind: "card", input: Number(a) };
    case "local":
      return { kind: "local", input: Number(a) };
    case "off":
      return { kind: "off" };
    default:
      throw new Error(`Unrecognised source picker value "${value}"`);
  }
}

function ChannelOptions() {
  const channels = useAppStore(selectChannels);
  return (
    <>
      {ALL_CHANNELS.map((channel) => {
        const name = channels.find((c) => c.channel === channel)?.name;
        return (
          <option key={channel} value={channel}>
            {`CH${channel}${name ? ` — ${name}` : ""}`}
          </option>
        );
      })}
    </>
  );
}

function SelectedChannelControl({ mock }: { mock: MockMixerClient }) {
  const selectedChannel = useAppStore(selectSelectedChannel);

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const { value } = event.target;
    mock.simulateSelect(value === "" ? null : mixerChannelId(Number(value)));
  }

  return (
    <div className="devtools__section">
      <span className="devtools__section-title">Selected channel</span>
      <div className="devtools__row">
        <select value={selectedChannel ?? ""} onChange={handleChange}>
          <option value="">None</option>
          <ChannelOptions />
        </select>
      </div>
    </div>
  );
}

function RenameControl({ mock }: { mock: MockMixerClient }) {
  const [channel, setChannel] = useState<MixerChannelId>(mixerChannelId(1));
  const [name, setName] = useState("");

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    mock.simulateRename(channel, name.slice(0, NAME_MAX_LENGTH));
  }

  return (
    <form className="devtools__section" onSubmit={handleSubmit}>
      <span className="devtools__section-title">Rename channel</span>
      <div className="devtools__row">
        <select
          value={channel}
          onChange={(event) => setChannel(mixerChannelId(Number(event.target.value)))}
        >
          <ChannelOptions />
        </select>
      </div>
      <div className="devtools__row">
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          placeholder="New name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit">Rename</button>
      </div>
    </form>
  );
}

function SourceControl({ mock }: { mock: MockMixerClient }) {
  const channels = useAppStore(selectChannels);
  const [channel, setChannel] = useState<MixerChannelId>(mixerChannelId(1));
  const [source, setSource] = useState(sourceOptionValue("off"));

  const current = channels.find((c) => c.channel === channel)?.source;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    mock.simulateSourceChange(channel, parseSourceOption(source));
  }

  return (
    <form className="devtools__section" onSubmit={handleSubmit}>
      <span className="devtools__section-title">Change source</span>
      <div className="devtools__row">
        <select
          value={channel}
          onChange={(event) => setChannel(mixerChannelId(Number(event.target.value)))}
        >
          <ChannelOptions />
        </select>
      </div>
      {current !== undefined && (
        <span className="devtools__hint">Currently {formatMixerSource(current)}</span>
      )}
      <div className="devtools__row">
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value={sourceOptionValue("off")}>OFF</option>
          <optgroup label="AES50-A">
            {AES50_CHANNELS.map((n) => (
              <option key={`a${n}`} value={sourceOptionValue("aes50", "A", n)}>
                AES50-A {n}
              </option>
            ))}
          </optgroup>
          <optgroup label="AES50-B">
            {AES50_CHANNELS.map((n) => (
              <option key={`b${n}`} value={sourceOptionValue("aes50", "B", n)}>
                AES50-B {n}
              </option>
            ))}
          </optgroup>
          <optgroup label="Card">
            {CONSOLE_INPUTS.map((n) => (
              <option key={`c${n}`} value={sourceOptionValue("card", n)}>
                Card {n}
              </option>
            ))}
          </optgroup>
          <optgroup label="Local">
            {CONSOLE_INPUTS.map((n) => (
              <option key={`l${n}`} value={sourceOptionValue("local", n)}>
                Local {n}
              </option>
            ))}
          </optgroup>
        </select>
        <button type="submit">Set</button>
      </div>
    </form>
  );
}

function ConnectionControl({ mock }: { mock: MockMixerClient }) {
  const connection = useAppStore(selectConnection);

  return (
    <div className="devtools__section">
      <span className="devtools__section-title">Connection · {connection}</span>
      <div className="devtools__buttons">
        <button type="button" onClick={() => mock.simulateConnectionLoss()}>
          Disconnect
        </button>
        <button type="button" onClick={() => mock.simulateConnecting()}>
          Connecting
        </button>
        <button type="button" onClick={() => mock.simulateReconnect()}>
          Reconnect
        </button>
      </div>
    </div>
  );
}

/**
 * @param mock the same `MockMixerClient` the active `LocalMockGateway` wraps
 *   — passed in rather than constructed here, so every `simulate*` call is
 *   witnessed by the gateway's own subscription and flows through the real
 *   event → store path (never a shortcut into the store).
 */
export function DevControlSurface({ mock }: { mock: MockMixerClient }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="devtools">
      {open && (
        <div className="devtools__panel">
          <SelectedChannelControl mock={mock} />
          <RenameControl mock={mock} />
          <SourceControl mock={mock} />
          <ConnectionControl mock={mock} />
        </div>
      )}
      <button
        type="button"
        className="devtools__toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? "Mock X32 ▾" : "Mock X32 ▸"}
      </button>
    </div>
  );
}
