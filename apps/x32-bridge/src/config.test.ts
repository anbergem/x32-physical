import { join } from "node:path";

import { MockMixerClient } from "@x32/mixer-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INSTALLATION_FILE,
  INSTALLATION_FILE_NAME,
  shippedInstallationSeedPath,
} from "./installationFile";
import {
  applySettingsFileOverrides,
  createMixerClient,
  DEFAULT_BASELINE_FILE,
  DEFAULT_X32_PORT,
  discoverAndLog,
  parseSettingsFileContents,
  pickDiscoveredHost,
  resolveBaselineFilePath,
  resolveDemoMode,
  resolveInstallationFileOverride,
  resolveInstallationFilePath,
  resolveMixerMode,
  resolvePort,
  resolveStateDirectory,
  resolveWebDistPath,
  resolveX32HostOverride,
  resolveX32Port,
} from "./config";
import type { X32Discoverer, X32Discovered } from "./x32/discovery";
import { X32MixerClient } from "./x32/x32MixerClient";

function discovered(host: string, overrides: Partial<X32Discovered> = {}): X32Discovered {
  return {
    host,
    serverVersion: "V2.05",
    serverName: "osc-server",
    model: "X32C",
    firmware: "2.08",
    ...overrides,
  };
}

/** A stub `X32Discoverer` for `createMixerClient` tests — no real socket, no backoff. */
function stubDiscoverer(found: X32Discovered[] = []) {
  return {
    discover: vi.fn().mockResolvedValue(found) as X32Discoverer["discover"],
    close: vi.fn() as X32Discoverer["close"],
  } satisfies X32Discoverer;
}

describe("resolveMixerMode", () => {
  it("defaults to mock", () => {
    expect(resolveMixerMode({})).toBe("mock");
    expect(resolveMixerMode({ X32_MIXER: "mock" })).toBe("mock");
  });

  it("accepts x32", () => {
    expect(resolveMixerMode({ X32_MIXER: "x32" })).toBe("x32");
  });

  it("rejects anything else", () => {
    expect(() => resolveMixerMode({ X32_MIXER: "bogus" })).toThrow(/Unrecognised X32_MIXER/);
  });
});

describe("resolveX32HostOverride", () => {
  it("is undefined when unset or blank — discovery (step 18) fills in", () => {
    expect(resolveX32HostOverride({})).toBeUndefined();
    expect(resolveX32HostOverride({ X32_HOST: "  " })).toBeUndefined();
  });

  it("returns the configured override", () => {
    expect(resolveX32HostOverride({ X32_HOST: "192.168.1.10" })).toBe("192.168.1.10");
  });
});

describe("pickDiscoveredHost", () => {
  it("returns undefined for no responders", () => {
    expect(pickDiscoveredHost([])).toBeUndefined();
  });

  it("returns the single responder", () => {
    const only = discovered("192.168.1.10");
    expect(pickDiscoveredHost([only])).toBe(only);
  });

  it("picks the lowest IP, deterministically, among several responders", () => {
    const low = discovered("192.168.1.2");
    const mid = discovered("192.168.1.10");
    const high = discovered("192.168.1.200");
    expect(pickDiscoveredHost([mid, high, low])).toBe(low);
    expect(pickDiscoveredHost([high, low, mid])).toBe(low); // order-independent
  });
});

describe("resolveX32Port", () => {
  it("defaults to 10023", () => {
    expect(resolveX32Port({})).toBe(DEFAULT_X32_PORT);
    expect(DEFAULT_X32_PORT).toBe(10023);
  });

  it("accepts a valid override", () => {
    expect(resolveX32Port({ X32_PORT: "10024" })).toBe(10024);
  });

  it("rejects an invalid port", () => {
    expect(() => resolveX32Port({ X32_PORT: "not-a-number" })).toThrow(/Invalid X32_PORT/);
    expect(() => resolveX32Port({ X32_PORT: "-1" })).toThrow(/Invalid X32_PORT/);
    expect(() => resolveX32Port({ X32_PORT: "70000" })).toThrow(/Invalid X32_PORT/);
  });
});

describe("resolvePort / resolveDemoMode — unchanged by this step", () => {
  it("still resolve the bridge's own WebSocket port and demo flag", () => {
    expect(resolvePort({})).toBe(8765);
    expect(resolveDemoMode({ X32_DEMO: "1" })).toBe(true);
    expect(resolveDemoMode({})).toBe(false);
  });
});

describe("resolveBaselineFilePath", () => {
  it("defaults to data/baseline.json", () => {
    expect(resolveBaselineFilePath({})).toBe(DEFAULT_BASELINE_FILE);
    expect(DEFAULT_BASELINE_FILE).toBe("data/baseline.json");
  });

  it("returns the configured override", () => {
    expect(resolveBaselineFilePath({ X32_BASELINE_FILE: "/tmp/x32/baseline.json" })).toBe(
      "/tmp/x32/baseline.json",
    );
  });

  it("falls back to the default for a blank override", () => {
    expect(resolveBaselineFilePath({ X32_BASELINE_FILE: "   " })).toBe(DEFAULT_BASELINE_FILE);
  });
});

describe("resolveWebDistPath", () => {
  it("is unset by default (WS only)", () => {
    expect(resolveWebDistPath({})).toBeUndefined();
  });

  it("returns the configured override", () => {
    expect(resolveWebDistPath({ X32_WEB_DIST: "/opt/x32/web" })).toBe("/opt/x32/web");
  });

  it("treats a blank override as unset", () => {
    expect(resolveWebDistPath({ X32_WEB_DIST: "   " })).toBeUndefined();
  });
});

describe("resolveInstallationFileOverride (issue #3)", () => {
  it("is unset by default (the state-directory default applies)", () => {
    expect(resolveInstallationFileOverride({})).toBeUndefined();
  });

  it("returns the configured override", () => {
    expect(
      resolveInstallationFileOverride({
        X32_INSTALLATION_FILE: "C:\\ProgramData\\X32RoutingVisualizer\\installation.yaml",
      }),
    ).toBe("C:\\ProgramData\\X32RoutingVisualizer\\installation.yaml");
  });

  it("treats a blank override as unset", () => {
    expect(resolveInstallationFileOverride({ X32_INSTALLATION_FILE: "   " })).toBeUndefined();
  });
});

describe("the state directory (issue #26)", () => {
  it("defaults to the directory holding the default baseline", () => {
    expect(resolveStateDirectory({})).toBe("data");
  });

  it("follows the baseline wherever it is configured — the MSI's ProgramData directory", () => {
    // POSIX-form path so this asserts the derivation itself on any platform;
    // on Windows the same call resolves C:\ProgramData\X32RoutingVisualizer.
    expect(
      resolveStateDirectory({ X32_BASELINE_FILE: "/var/lib/x32/baseline.json" }),
    ).toBe("/var/lib/x32");
  });
});

describe("resolveInstallationFilePath (issue #26)", () => {
  it("the override wins when it is set", () => {
    expect(
      resolveInstallationFilePath({
        X32_INSTALLATION_FILE: "/etc/x32/venue.yaml",
        X32_BASELINE_FILE: "/var/lib/x32/baseline.json",
      }),
    ).toBe("/etc/x32/venue.yaml");
  });

  it("with no override, it is installation.yaml in the state directory", () => {
    expect(
      resolveInstallationFilePath({ X32_BASELINE_FILE: "/var/lib/x32/baseline.json" }),
    ).toBe(join("/var/lib/x32", INSTALLATION_FILE_NAME));
  });

  it("with neither set, it is the documented dev default under data/", () => {
    expect(resolveInstallationFilePath({})).toBe(DEFAULT_INSTALLATION_FILE);
    expect(DEFAULT_INSTALLATION_FILE).toBe(join("data", "installation.yaml"));
  });

  it("is never the copy next to the server module — that one only seeds", () => {
    expect(resolveInstallationFilePath({})).not.toBe(shippedInstallationSeedPath());
  });
});

describe("createMixerClient", () => {
  it("mock mode returns a MockMixerClient", () => {
    expect(createMixerClient("mock", {})).toBeInstanceOf(MockMixerClient);
  });

  it("x32 mode with X32_HOST set returns an X32MixerClient wired to it directly, no discovery", async () => {
    const discoverer = stubDiscoverer();
    const client = createMixerClient(
      "x32",
      { X32_HOST: "192.168.1.10", X32_PORT: "10024" },
      discoverer,
    );
    try {
      expect(client).toBeInstanceOf(X32MixerClient);
      expect(client.getConnectionState()).toBe("disconnected");
      expect(discoverer.discover).not.toHaveBeenCalled();
    } finally {
      await client.disconnect();
    }
    expect(discoverer.close).not.toHaveBeenCalled(); // never wired in — nothing to close
  });

  it("x32 mode without X32_HOST returns an X32MixerClient that discovers on connect (step 18)", async () => {
    const discoverer = stubDiscoverer([discovered("192.168.1.10")]);
    const client = createMixerClient("x32", {}, discoverer);
    try {
      expect(client).toBeInstanceOf(X32MixerClient);
      expect(client.getConnectionState()).toBe("disconnected");
      // Discovery is deferred to connect()/reconnect, not construction.
      expect(discoverer.discover).not.toHaveBeenCalled();
    } finally {
      await client.disconnect();
    }
    expect(discoverer.close).toHaveBeenCalledTimes(1); // disconnect() releases the discovery socket
  });

  it("x32 mode without X32_HOST or any discovery response still constructs a client (starts disconnected)", () => {
    const discoverer = stubDiscoverer([]);
    expect(() => createMixerClient("x32", {}, discoverer)).not.toThrow();
  });
});

describe("discoverAndLog", () => {
  it("logs the exact, doc/test-pinned success line for a single responder", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const discoverer = stubDiscoverer([discovered("192.168.1.10", { model: "X32", firmware: "4.06" })]);

    const chosen = await discoverAndLog(discoverer);

    expect(chosen?.host).toBe("192.168.1.10");
    expect(log).toHaveBeenCalledWith("x32-bridge: Found X32 at 192.168.1.10 (X32 fw 4.06)");
    log.mockRestore();
  });

  it("logs nothing itself on failure — that's the discoverer's job, throttled by backoff", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const discoverer = stubDiscoverer([]);

    const chosen = await discoverAndLog(discoverer);

    expect(chosen).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
  });
});

describe("parseSettingsFileContents (plan step 19 — MSI settings.env override)", () => {
  it("parses KEY=VALUE lines", () => {
    expect(parseSettingsFileContents("X32_HOST=192.168.1.10\nX32_BRIDGE_PORT=9000\n")).toEqual({
      X32_HOST: "192.168.1.10",
      X32_BRIDGE_PORT: "9000",
    });
  });

  it("ignores blank lines and #-comments, trims whitespace, tolerates CRLF", () => {
    const contents = [
      "# venue override file",
      "",
      "  X32_HOST = 192.168.1.10  ",
      "# X32_BRIDGE_PORT=9999 (disabled)",
    ].join("\r\n");
    expect(parseSettingsFileContents(contents)).toEqual({ X32_HOST: "192.168.1.10" });
  });

  it("ignores lines with no '='", () => {
    expect(parseSettingsFileContents("not a valid line\nX32_HOST=1.2.3.4")).toEqual({
      X32_HOST: "1.2.3.4",
    });
  });

  it("empty/whitespace-only contents yields no overrides", () => {
    expect(parseSettingsFileContents("")).toEqual({});
    expect(parseSettingsFileContents("   \n  \n")).toEqual({});
  });
});

describe("applySettingsFileOverrides", () => {
  it("fills in keys absent from env", () => {
    const merged = applySettingsFileOverrides({}, { X32_HOST: "192.168.1.10" });
    expect(merged.X32_HOST).toBe("192.168.1.10");
  });

  it("never overrides a key already present in env, even an empty string", () => {
    const merged = applySettingsFileOverrides(
      { X32_HOST: "10.0.0.1", X32_BRIDGE_PORT: "" },
      { X32_HOST: "192.168.1.10", X32_BRIDGE_PORT: "9000" },
    );
    expect(merged.X32_HOST).toBe("10.0.0.1");
    expect(merged.X32_BRIDGE_PORT).toBe("");
  });

  it("does not mutate the input env", () => {
    const env = {};
    applySettingsFileOverrides(env, { X32_HOST: "1.2.3.4" });
    expect(env).toEqual({});
  });
});
