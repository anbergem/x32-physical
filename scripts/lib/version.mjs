/**
 * The release version format shared by the two release scripts.
 *
 * Both `scripts/build-msi.mjs` and `scripts/release-build.mjs` are handed the
 * same value — the release tag with its leading `v` stripped, derived once by
 * `.github/workflows/release.yml`'s `Derive version` step — and both must
 * reject anything that is not a plain `x.y.z`. It lives here rather than in
 * either script because one executable script importing another is worse
 * coupling than a shared helper (`scripts/lib/` already exists for exactly
 * this, see `xmlWellFormed.mjs`).
 *
 * Why `x.y.z` only: MSI `ProductVersion` (via `Package/@Version`) requires
 * numeric dotted components, so a `v` prefix or a pre-release/build suffix
 * (`1.2.3-rc1`, `1.2.3+abc123`) is invalid and must be stripped or rejected
 * before it reaches `wix build`. `release-build.mjs` holds itself to the same
 * rule so the `VERSION` file it stages and the MSI's `ProductVersion` can
 * never disagree about which release a build is.
 */

/**
 * Throws unless `version` is a plain `x.y.z`. `script` names the caller in the
 * message so the failure points at the command the operator actually ran.
 */
export function assertSemverTriple(version, script = "build-msi") {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `${script}: --version "${version}" is not a plain x.y.z version (MSI ProductVersion requires numeric dotted components; strip any leading "v" or pre-release suffix before calling this script).`,
    );
  }
}
