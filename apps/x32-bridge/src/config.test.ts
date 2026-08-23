import { MockMixerClient } from "@x32/mixer-contracts";
import { describe, expect, it } from "vitest";

import {
  createMixerClient,
  DEFAULT_X32_PORT,
  resolveDemoMode,
  resolveMixerMode,
  resolvePort,
  resolveX32Host,
  resolveX32Port,
} from "./config";
import { X32MixerClient } from "./x32/x32MixerClient";

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

describe("resolveX32Host", () => {
  it("requires X32_HOST", () => {
    expect(() => resolveX32Host({})).toThrow(/X32_HOST is required/);
    expect(() => resolveX32Host({ X32_HOST: "  " })).toThrow(/X32_HOST is required/);
  });

  it("returns the configured host", () => {
    expect(resolveX32Host({ X32_HOST: "192.168.1.10" })).toBe("192.168.1.10");
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

describe("createMixerClient", () => {
  it("mock mode returns a MockMixerClient", () => {
    expect(createMixerClient("mock", {})).toBeInstanceOf(MockMixerClient);
  });

  it("x32 mode requires X32_HOST", () => {
    expect(() => createMixerClient("x32", {})).toThrow(/X32_HOST is required/);
  });

  it("x32 mode returns an X32MixerClient wired to X32_HOST/X32_PORT", async () => {
    const client = createMixerClient("x32", { X32_HOST: "192.168.1.10", X32_PORT: "10024" });
    try {
      expect(client).toBeInstanceOf(X32MixerClient);
      expect(client.getConnectionState()).toBe("disconnected");
    } finally {
      await client.disconnect();
    }
  });
});
