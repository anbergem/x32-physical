import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { resolveStagedVersion } from "./release-build.mjs";

// release-build.mjs's `main()` runs a full Vite + esbuild release build —
// this file exercises only the pure version-resolution helper. The staged
// output is verified end to end by .github/workflows/release.yml, whose
// `verify` job installs the resulting MSI on windows-latest and asserts the
// installed VERSION matches the release (issue #30).

describe("resolveStagedVersion", () => {
  it("uses the given --version", () => {
    expect(resolveStagedVersion(["--version", "1.2.3"], "abc1234")).toBe("1.2.3+abc1234");
  });

  it("falls back to `dev` when --version is absent", () => {
    expect(resolveStagedVersion([], "abc1234")).toBe("dev+abc1234");
  });

  /*
   * The regression that issue #30 is about. The fallback must not parse as a
   * version at all: `updateCheck.ts`'s `parseVersionTriple` scans for the
   * first `x.y.z` anywhere in the string, so the old `0.0.0+<hash>` fallback
   * made every published release compare as newer, forever. `dev+<hash>`
   * gives it nothing to find, which disables the check instead.
   */
  it("produces a fallback containing no x.y.z triple", () => {
    expect(/(\d+)\.(\d+)\.(\d+)/.test(resolveStagedVersion([], "abc1234"))).toBe(false);
  });

  it("rejects a leading 'v'", () => {
    expect(() => resolveStagedVersion(["--version", "v1.2.3"], "abc1234")).toThrow(
      /not a plain x\.y\.z version/,
    );
  });

  it("rejects a two-component version", () => {
    expect(() => resolveStagedVersion(["--version", "1.2"], "abc1234")).toThrow(
      /not a plain x\.y\.z version/,
    );
  });

  it("rejects a pre-release suffix", () => {
    expect(() => resolveStagedVersion(["--version", "1.2.3-rc1"], "abc1234")).toThrow(
      /not a plain x\.y\.z version/,
    );
  });

  it("rejects --version with no value", () => {
    expect(() => resolveStagedVersion(["--version"], "abc1234")).toThrow(
      /--version was given without a value/,
    );
  });

  it("names the calling script in the failure", () => {
    expect(() => resolveStagedVersion(["--version", "nope"], "abc1234")).toThrow(
      /^release:build:/,
    );
  });
});

describe("module side effects", () => {
  /*
   * The `isMain` guard: importing this module (as the tests above do) must
   * never start a real release build. Checked in a child process rather than
   * by looking for `dist/release`, which may legitimately exist from an
   * earlier real build on a developer's machine — a stale directory must not
   * decide whether this passes. If the guard regresses, `main()` runs on
   * import and its `release:build:` progress lines appear on stdout (and the
   * build far outlives the timeout).
   */
  it("importing the module does not run the build", () => {
    const moduleUrl = new URL("./release-build.mjs", import.meta.url).href;
    const source = `await import(${JSON.stringify(moduleUrl)}); console.log("imported");`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      { timeout: 30_000, encoding: "utf8" },
    );

    expect(output).toContain("imported");
    expect(output).not.toMatch(/release:build:/);
  });
});
