import { MockMixerClient } from "@x32/mixer-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createMixerClient,
  DEFAULT_BASELINE_FILE,
  DEFAULT_X32_PORT,
  pickDiscoveredHost,
  resolveBaselineFilePath,
  resolveDemoMode,
  resolveMixerMode,
  resolvePort,
  resolveWebDistPath,
  resolveX32HostOverride,
  resolveX32Port,
} from "./config";
import type { X32Discovered } from "./x32/discovery";
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

describe("createMixerClient", () => {
  it("mock mode returns a MockMixerClient", () => {
    expect(createMixerClient("mock", {})).toBeInstanceOf(MockMixerClient);
  });

  it("x32 mode with X32_HOST set returns an X32MixerClient wired to it directly, no discovery", async () => {
    const discover = vi.fn();
    const client = createMixerClient(
      "x32",
      { X32_HOST: "192.168.1.10", X32_PORT: "10024" },
      discover,
    );
    try {
      expect(client).toBeInstanceOf(X32MixerClient);
      expect(client.getConnectionState()).toBe("disconnected");
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await client.disconnect();
    }
  });

  it("x32 mode without X32_HOST returns an X32MixerClient that discovers on connect (step 18)", async () => {
    const discover = vi.fn().mockResolvedValue([discovered("192.168.1.10")]);
    const client = createMixerClient("x32", {}, discover);
    try {
      expect(client).toBeInstanceOf(X32MixerClient);
      expect(client.getConnectionState()).toBe("disconnected");
      // Discovery is deferred to connect()/reconnect, not construction.
      expect(discover).not.toHaveBeenCalled();
    } finally {
      await client.disconnect();
    }
  });

  it("x32 mode without X32_HOST or any discovery response still constructs a client (starts disconnected)", () => {
    const discover = vi.fn().mockResolvedValue([]);
    expect(() => createMixerClient("x32", {}, discover)).not.toThrow();
  });
});
