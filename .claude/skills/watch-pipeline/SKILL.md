---
name: watch-pipeline
description: >
  Watch a GitHub Actions run to completion without blocking, then report the
  result and — on failure — the actual error extracted from the failing step's
  log. Use when a CI/release run is in flight, when asked to wait for a
  pipeline, or when iterating on a workflow until it passes.
---

# Watching a GitHub Actions run

A run takes minutes; a foreground command that waits will hit the tool
timeout. **Always poll in the background** and let the harness notify you when
it exits.

## 1. Resolve the run id

Never render ids with `--template` — they are large integers and print in
scientific notation, which is unusable. Use `--jq`:

```bash
gh run list --workflow=<file.yml> --limit 1 --json databaseId --jq '.[0].databaseId'
```

For the run of a specific commit, add `--commit <sha>`. A newly triggered run
can take a few seconds to appear; if the list is empty, wait and retry once.

## 2. Poll in the background

```bash
RUN=<id>
until [ "$(gh run view "$RUN" --json status --jq .status)" = "completed" ]; do sleep 20; done
gh run view "$RUN" --json conclusion --jq .conclusion
```

Run this with `run_in_background: true`. The harness re-invokes you when it
exits — do **not** schedule extra wakeups or re-poll in the foreground while
it runs. `gh run watch` also works but redraws the terminal, which makes its
captured output hard to read; prefer the loop above.

While waiting, do other useful work rather than idling.

## 3. On failure, extract the real error

```bash
gh run view "$RUN" --json jobs --jq '.jobs[] | "\(.name): \(.status)/\(.conclusion)"'
gh run view "$RUN" --json jobs --jq '.jobs[] | select(.conclusion=="failure") | .steps[] | select(.conclusion=="failure") | .name'
gh run view "$RUN" --log-failed | tail -60
```

`--log-failed` is far better than downloading whole logs. The genuine error is
usually 10–40 lines from the end, buried under post-job cleanup noise — read
upward past the cleanup, and quote the actual message (exception, exit code,
missing file) rather than the last line printed.

Job-level `conclusion: skipped` on downstream jobs is normal when an upstream
job failed; the first failing job is the one to read.

## 4. Iterating

- Fix the cause in the repo, commit, push, and watch the **new** run — confirm
  you resolved a fresh id rather than re-reading the old one.
- Re-triggering without pushing: `gh run rerun <id> --failed` reruns only the
  failed jobs of an existing run; `gh workflow run <file.yml> -f <input>=<v>`
  starts a fresh `workflow_dispatch` run.
- **Prefer `workflow_dispatch` over publishing a release** while debugging a
  release pipeline, so a broken build does not produce user-visible artifacts.
- If the same step fails three times for different reasons, stop and
  reconsider the approach rather than continuing to patch symptoms.

## Cross-platform gotchas (common causes of green-locally / red-on-CI)

- **`ENOENT` spawning a tool on Windows**: Node's `execFileSync`/`spawnSync`
  will not resolve `.cmd`/`.bat` shims (`pnpm`, `npm`, `npx`) without
  `shell: true`. Works on macOS/Linux, fails on `windows-latest`.
- Path separators, case-sensitive paths, and `CRLF` line endings.
- A tool present on one runner image but not another.

## Reporting

State the conclusion, the failing job and step, and the **root cause** in one
sentence — not a log dump. If a fix is obvious, say what it is; if the failure
is environmental (a flaky download, a rate limit), say that instead of
inventing a code fix.
