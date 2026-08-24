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
