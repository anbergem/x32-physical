import { describe, expect, it } from "vitest";

import { parseArgs } from "./build-msi.mjs";
import { assertSemverTriple } from "./lib/version.mjs";

// build-msi.mjs's `main()` runs `wix build`, which only exists on Windows —
// this test file exercises only its pure, platform-independent helpers. The
// end-to-end MSI build is verified by .github/workflows/release.yml's
// `build` job on windows-latest (docs/plan.md step 19).

describe("parseArgs", () => {
  it("parses --key value pairs", () => {
    expect(parseArgs(["--app", "dist/release/app", "--version", "1.2.3"])).toEqual({
      app: "dist/release/app",
      version: "1.2.3",
    });
  });

  it("returns an empty object for no args", () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe("assertSemverTriple", () => {
  it("accepts plain x.y.z", () => {
    expect(() => assertSemverTriple("1.2.3")).not.toThrow();
    expect(() => assertSemverTriple("0.0.0")).not.toThrow();
    expect(() => assertSemverTriple("10.20.300")).not.toThrow();
  });

  it("rejects a leading 'v'", () => {
    expect(() => assertSemverTriple("v1.2.3")).toThrow(/not a plain x\.y\.z version/);
  });

  it("rejects a pre-release/build suffix", () => {
    expect(() => assertSemverTriple("1.2.3-rc1")).toThrow(/not a plain x\.y\.z version/);
    expect(() => assertSemverTriple("1.2.3+abc123")).toThrow(/not a plain x\.y\.z version/);
  });

  it("rejects a two-component version", () => {
    expect(() => assertSemverTriple("1.2")).toThrow(/not a plain x\.y\.z version/);
  });
});
