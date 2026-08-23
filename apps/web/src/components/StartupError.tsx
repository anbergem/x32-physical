/**
 * Full-page startup failure.
 *
 * The installation is loaded and validated before anything renders; when that
 * fails there is no schematic to show, and a blank page would be the worst
 * possible answer. The loader's messages already name the layer and the
 * offending device/connection, so they are shown verbatim.
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

export function StartupError({ error }: { error: unknown }) {
  return (
    <main className="startup-error">
      <h1 className="startup-error__title">Cannot start</h1>
      <pre className="startup-error__detail">{describe(error)}</pre>
      <p className="startup-error__hint">
        Fix <code>config/installation.yaml</code> and reload.
      </p>
    </main>
  );
}
