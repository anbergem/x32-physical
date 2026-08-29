/**
 * The write pipeline (issue #27): steps 2–5 pure, steps 1–6 against a
 * repository. "Nothing is written" is asserted on the repository's stored
 * bytes, not merely on the returned result — a rejection that still wrote
 * would be the one failure this pipeline exists to prevent.
 */

import { deviceId } from "@x32/domain";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyInstallationEdit, editInstallationText, STALE_BASE_VERSION_REASON } from "./edit";
import type { InstallationOperation } from "./operations";
import {
  InMemoryInstallationRepository,
  InstallationVersionConflictError,
  installationFileState,
  installationVersion,
} from "./repository";

const SAMPLE_YAML = readFileSync(
  fileURLToPath(new URL("../../../config/installation.sample.yaml", import.meta.url)),
  "utf8",
);

const RENAME_PIT_BOX: InstallationOperation = {
  kind: "set-device-label",
  device: deviceId("pit-box"),
  label: "Pit Box B",
};

/**
 * Schema-valid, domain-invalid: `pit-wall` sockets 1 *and* 2 are both cabled
 * into `pit-box` input 1, which `validateInstallation` rejects as
 * `stagebox-input-multiple-sources`. Nothing about its *shape* is wrong, so
 * only validating the whole resulting document catches it — the epic's
 * "cabling a socket that another connection already feeds", frozen into a
 * fixture.
 */
const DOMAIN_INVALID_YAML = `version: 1

devices:
  # A comment, so a mangled write would be visible too.
  pit-box:
    kind: stagebox
    label: "Pit Box"
    inputs: 16
    aes50: { bus: A, offset: 0 }

  pit-wall:
    kind: passive-panel
    label: "Pit Wall Plate"
    inputs: 6

connections:
  - from: { device: pit-wall, input: 1 }
    to: { device: pit-box, input: 1 }
  - from: { device: pit-wall, input: 2 }
    to: { device: pit-box, input: 1 }
`;

describe("installationVersion", () => {
  it("is stable for the same bytes and differs for different bytes", () => {
    expect(installationVersion(SAMPLE_YAML)).toBe(installationVersion(SAMPLE_YAML));
    expect(installationVersion(SAMPLE_YAML)).not.toBe(
      installationVersion(`${SAMPLE_YAML}\n# one more comment\n`),
    );
  });

  it("notices a change as small as one character", () => {
    expect(installationVersion("version: 1\n")).not.toBe(installationVersion("version: 2\n"));
  });
});

describe("editInstallationText (steps 2-5, pure)", () => {
  it("applies the operation and returns the validated result", () => {
    const current = installationFileState(SAMPLE_YAML);

    const result = editInstallationText(current, current.version, RENAME_PIT_BOX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.installation?.devices.find((d) => d.id === "pit-box")?.label).toBe(
      "Pit Box B",
    );
    expect(result.state.version).not.toBe(current.version);
  });

  it("rejects a stale baseVersion before touching the document", () => {
    const current = installationFileState(SAMPLE_YAML);

    const result = editInstallationText(current, "0000000000000000", RENAME_PIT_BOX);

    expect(result).toEqual({ ok: false, reason: STALE_BASE_VERSION_REASON });
  });

  it("rejects an operation naming a device that does not exist, with a message naming it", () => {
    const current = installationFileState(SAMPLE_YAML);

    const result = editInstallationText(current, current.version, {
      kind: "set-device-label",
      device: deviceId("ghost-box"),
      label: "Nowhere",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("ghost-box");
  });

  it("rejects an edit whose RESULT fails domain validation, however sensible the operation", () => {
    const current = installationFileState(DOMAIN_INVALID_YAML);
    expect(current.installation).toBeNull();

    // A plain rename — nothing wrong with it in isolation.
    const result = editInstallationText(current, current.version, RENAME_PIT_BOX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("leave the installation invalid");
    expect(result.reason).toContain("pit-box");
  });
});

describe("applyInstallationEdit (steps 1-6, against a repository)", () => {
  it("writes the edited document and reports the new version", async () => {
    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);
    const { version } = await repository.read();

    const result = await applyInstallationEdit(repository, version, RENAME_PIT_BOX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(repository.text).toBe(result.state.text);
    expect(repository.text).toContain("Pit Box B");
    expect(result.state.version).toBe(installationVersion(repository.text));
  });

  it("preserves every comment through a repository round trip", async () => {
    const commentsOf = (text: string) =>
      text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("#"));

    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);
    const { version } = await repository.read();

    await applyInstallationEdit(repository, version, RENAME_PIT_BOX);

    expect(commentsOf(repository.text)).toEqual(commentsOf(SAMPLE_YAML));
  });

  it("rejects a stale baseVersion and writes nothing", async () => {
    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);

    const result = await applyInstallationEdit(repository, "0000000000000000", RENAME_PIT_BOX);

    expect(result).toEqual({ ok: false, reason: STALE_BASE_VERSION_REASON });
    expect(repository.text).toBe(SAMPLE_YAML);
  });

  it("rejects an unknown device and writes nothing", async () => {
    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);
    const { version } = await repository.read();

    const result = await applyInstallationEdit(repository, version, {
      kind: "set-device-label",
      device: deviceId("ghost-box"),
      label: "Nowhere",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("ghost-box");
    expect(repository.text).toBe(SAMPLE_YAML);
  });

  it("rejects an edit whose result fails validation and writes nothing", async () => {
    const repository = new InMemoryInstallationRepository(DOMAIN_INVALID_YAML);
    const { version } = await repository.read();

    const result = await applyInstallationEdit(repository, version, RENAME_PIT_BOX);

    expect(result.ok).toBe(false);
    expect(repository.text).toBe(DOMAIN_INVALID_YAML);
  });

  it("reports a write-time conflict in the same words as a stale baseVersion", async () => {
    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);
    const { version } = await repository.read();

    // Somebody else's edit lands between this caller's read and its write.
    const racing: typeof repository.write = async () => {
      throw new InstallationVersionConflictError(version, "deadbeefdeadbeef");
    };
    Object.defineProperty(repository, "write", { value: racing });

    const result = await applyInstallationEdit(repository, version, RENAME_PIT_BOX);

    expect(result).toEqual({ ok: false, reason: STALE_BASE_VERSION_REASON });
    expect(repository.text).toBe(SAMPLE_YAML);
  });

  it("reports an unreadable repository rather than throwing", async () => {
    const broken = {
      read: () => Promise.reject(new Error("disk on fire")),
      write: () => Promise.reject(new Error("never called")),
    };

    const result = await applyInstallationEdit(broken, "whatever", RENAME_PIT_BOX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("disk on fire");
  });
});

describe("InMemoryInstallationRepository", () => {
  it("refuses a write against a stale expectedVersion", async () => {
    const repository = new InMemoryInstallationRepository(SAMPLE_YAML);

    await expect(repository.write("version: 1\n", "0000000000000000")).rejects.toBeInstanceOf(
      InstallationVersionConflictError,
    );
    expect(repository.text).toBe(SAMPLE_YAML);
  });

  it("reports an invalid document as a value, never a throw", async () => {
    const repository = new InMemoryInstallationRepository("not: [valid, yaml");

    const state = await repository.read();

    expect(state.installation).toBeNull();
    expect(state.error).not.toBeNull();
    expect(state.text).toBe("not: [valid, yaml");
  });
});
