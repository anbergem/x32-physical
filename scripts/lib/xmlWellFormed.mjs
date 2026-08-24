/**
 * A minimal, hand-rolled XML well-formedness check — NOT a spec-conformant
 * XML parser and NOT schema-aware. It exists because no XML-parsing package
 * is available anywhere in this repo's dependency tree (checked: neither
 * directly nor transitively via Vite/Vitest/esbuild/yaml/Zod), and pulling
 * one in would be a new dependency outside the agreed stack (CLAUDE.md) just
 * to sanity-check `.wxs`/`.xml` files on macOS, where the real authority —
 * `wix build`'s own schema-validating parser — cannot run anyway (WiX is
 * Windows-only). This is deliberately a *tag-balance* checker: it verifies
 * every element opens and closes correctly (including proper nesting) and
 * that there is exactly one root element. It does NOT validate attribute
 * values, entity references beyond the five predefined ones, DTDs/schemas,
 * or namespace correctness — those remain unverified until the real `wix
 * build` runs on windows-latest CI (docs/plan.md step 19).
 *
 * Throws `Error` with a description on the first problem found; returns
 * normally (no value) when well-formed by this checker's definition.
 */
export function assertXmlWellFormed(xml, { label = "<xml>" } = {}) {
  // Strip comments and CDATA sections first so tag-like text inside them
  // (e.g. a comment mentioning "<File>") isn't mistaken for real markup.
  const withoutCommentsAndCdata = xml
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  const tagPattern = /<([^>]+)>/g;
  const stack = [];
  let rootCount = 0;
  let match;

  while ((match = tagPattern.exec(withoutCommentsAndCdata)) !== null) {
    const inner = match[1].trim();

    // XML declaration / processing instruction / DOCTYPE — not an element.
    if (inner.startsWith("?") || inner.startsWith("!")) continue;

    if (inner.startsWith("/")) {
      // Closing tag.
      const name = inner.slice(1).trim();
      const expected = stack.pop();
      if (expected === undefined) {
        throw new Error(`${label}: unexpected closing tag </${name}> with no matching open tag`);
      }
      if (expected !== name) {
        throw new Error(`${label}: mismatched closing tag: expected </${expected}>, found </${name}>`);
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const nameMatch = /^([^\s/]+)/.exec(body);
    if (nameMatch === null) {
      throw new Error(`${label}: malformed tag: <${inner}>`);
    }
    const name = nameMatch[1];

    if (!selfClosing) {
      stack.push(name);
      if (stack.length === 1) rootCount += 1;
    } else if (stack.length === 0) {
      rootCount += 1;
    }
  }

  if (stack.length > 0) {
    throw new Error(`${label}: unclosed tag(s): ${stack.join(", ")}`);
  }
  if (rootCount === 0) {
    throw new Error(`${label}: no root element found`);
  }
  if (rootCount > 1) {
    throw new Error(`${label}: ${rootCount} top-level elements found — XML must have exactly one root`);
  }

  // Bare '&' not starting a recognised entity/char reference is malformed.
  const strippedTags = withoutCommentsAndCdata.replaceAll(/<[^>]*>/g, " ");
  const badAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(strippedTags);
  if (badAmpersand !== null) {
    throw new Error(`${label}: unescaped '&' in text content (not a valid entity reference)`);
  }
}
