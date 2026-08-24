/**
 * `UpdateNotice`'s own URL guard (docs/plan.md step 20). A pure function so
 * it is directly testable — the component has no test harness in this repo
 * (no React Testing Library/jsdom dependency, and CLAUDE.md forbids adding
 * one), so the safety-critical bit of that component lives here instead,
 * exercised head-on by `updateNotice.test.ts`.
 *
 * `@x32/protocol`'s parser (`parse.ts`) is the primary guard — a non-https
 * `url` never survives parsing a wire message. This is defense in depth for
 * any other path that might one day set `updateAvailable` directly (a
 * future dev tool, a test double, ...): the component must never render a
 * link it has not itself re-checked.
 */
export function isSafeUpdateUrl(url: string): boolean {
  return url.startsWith("https://");
}
