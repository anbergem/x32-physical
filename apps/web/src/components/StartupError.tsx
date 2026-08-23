/**
 * Full-page startup failure — for the failures that leave nothing to render.
 * A mixer that cannot be reached is *not* one of them: the topology and the
 * last known configuration stay on screen (architecture.md §7).
 *
 * The message is shown verbatim; the loaders already name the layer and the
 * offending device/connection. What to *do* about it varies per failure, so
 * the hint comes from the failure site rather than being assumed here — a
 * gateway that refuses to start is not fixed by editing YAML.
 */

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = error.cause;
  const causeMessage =
    cause instanceof Error && !error.message.includes(cause.message)
      ? `\n\nCaused by: ${cause.message}`
      : "";

  return `${error.message}${causeMessage}`;
}

export function StartupError({
  error,
  hint,
}: {
  error: unknown;
  /** What the operator can do about *this* failure. Omitted when unknown. */
  hint?: string;
}) {
  return (
    <main className="startup-error">
      <h1 className="startup-error__title">Cannot start</h1>
      <pre className="startup-error__detail">{describe(error)}</pre>
      {hint !== undefined && <p className="startup-error__hint">{hint}</p>}
    </main>
  );
}
