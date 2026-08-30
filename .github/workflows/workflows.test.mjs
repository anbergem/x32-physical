import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Sanity that both workflow files are at least valid YAML with the expected
// top-level shape (docs/plan.md step 19, point 7). This does NOT validate
// GitHub Actions semantics (job dependency graphs, expression syntax,
// action inputs) — only the real GitHub Actions runner does that, along
// with `wix build`/`msiexec` themselves, which only run on windows-latest
// CI (see .github/workflows/release.yml).

const HERE = dirname(fileURLToPath(import.meta.url));

describe("release.yml", () => {
  it("parses as YAML", async () => {
    const raw = await readFile(join(HERE, "release.yml"), "utf8");
    const doc = parse(raw);
    expect(doc.name).toBe("Release");
  });

  it("triggers on release published and workflow_dispatch (not tag push)", async () => {
    const raw = await readFile(join(HERE, "release.yml"), "utf8");
    const doc = parse(raw);
    // yaml parses the bare `on:` key as boolean `true` unless quoted —
    // this repo's other workflow (ci.yml) hits the same thing, so read
    // via the boolean-true key like that file's own trigger.
    const on = doc.on ?? doc[true];
    expect(on.release?.types).toEqual(["published"]);
    expect(on).toHaveProperty("workflow_dispatch");
    expect(on.push).toBeUndefined();
  });

  it("has build, verify, and publish jobs, with verify/publish gated correctly", async () => {
    const raw = await readFile(join(HERE, "release.yml"), "utf8");
    const doc = parse(raw);
    expect(Object.keys(doc.jobs)).toEqual(["build", "verify", "publish"]);
    expect(doc.jobs.build["runs-on"]).toBe("windows-latest");
    expect(doc.jobs.verify["runs-on"]).toBe("windows-latest");
    expect(doc.jobs.verify.needs).toBe("build");
    const publishNeeds = doc.jobs.publish.needs;
    expect(publishNeeds).toContain("build");
    expect(publishNeeds).toContain("verify");
  });

  /*
   * Issue #30. The staged VERSION must name the release being built, which
   * takes three pieces of wiring that a reordering could silently break:
   * the version has to be derived before the build that consumes it, it has
   * to actually be passed, and the installed result has to be asserted while
   * the install still exists. Ordering is the part unit tests cannot see, so
   * it is asserted here on step indices.
   */
  it("derives the version before staging, and passes it to release:build", async () => {
    const raw = await readFile(join(HERE, "release.yml"), "utf8");
    const doc = parse(raw);
    const steps = doc.jobs.build.steps;

    const deriveIndex = steps.findIndex((step) => step.name === "Derive version");
    const buildIndex = steps.findIndex((step) => step.run?.includes("pnpm release:build"));

    expect(deriveIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(deriveIndex).toBeLessThan(buildIndex);
    expect(steps[buildIndex].run).toContain("--version");
    expect(steps[buildIndex].run).toContain("steps.version.outputs.version");
  });

  it("asserts the installed VERSION while the install still exists", async () => {
    const raw = await readFile(join(HERE, "release.yml"), "utf8");
    const doc = parse(raw);
    const steps = doc.jobs.verify.steps;

    const assertIndex = steps.findIndex(
      (step) => step.name === "Assert the installed VERSION matches the release",
    );
    const installIndex = steps.findIndex((step) => step.name === "Install silently");
    const uninstallIndex = steps.findIndex((step) => step.name === "Uninstall silently");

    expect(assertIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeLessThan(assertIndex);
    expect(assertIndex).toBeLessThan(uninstallIndex);
    expect(steps[assertIndex].run).toContain("needs.build.outputs.version");
  });
});

describe("ci.yml", () => {
  it("parses as YAML and is unchanged in shape (typecheck+test on main)", async () => {
    const raw = await readFile(join(HERE, "ci.yml"), "utf8");
    const doc = parse(raw);
    expect(doc.name).toBe("CI");
    const on = doc.on ?? doc[true];
    expect(on.push?.branches).toEqual(["main"]);
  });
});
