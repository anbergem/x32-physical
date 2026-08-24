import { describe, expect, it } from "vitest";

import { assertXmlWellFormed } from "./xmlWellFormed.mjs";

describe("assertXmlWellFormed", () => {
  it("accepts a simple well-formed document", () => {
    expect(() =>
      assertXmlWellFormed('<?xml version="1.0"?><a><b/><c>text</c></a>'),
    ).not.toThrow();
  });

  it("accepts self-closing and nested elements, comments, and CDATA", () => {
    const xml = `<?xml version="1.0"?>
<!-- a comment with <fake> tags in it -->
<Wix>
  <Fragment>
    <DirectoryRef Id="X">
      <Component Guid="*">
        <File Source="a.txt" />
      </Component>
    </DirectoryRef>
  </Fragment>
  <![CDATA[ <not a real tag> ]]>
</Wix>`;
    expect(() => assertXmlWellFormed(xml)).not.toThrow();
  });

  it("rejects an unclosed tag", () => {
    expect(() => assertXmlWellFormed("<a><b></a>")).toThrow(/mismatched closing tag/);
  });

  it("rejects a tag closed twice", () => {
    expect(() => assertXmlWellFormed("<a></a></a>")).toThrow(/unexpected closing tag/);
  });

  it("rejects more than one root element", () => {
    expect(() => assertXmlWellFormed("<a/><b/>")).toThrow(/exactly one root/);
  });

  it("rejects a document with nothing but a declaration", () => {
    expect(() => assertXmlWellFormed('<?xml version="1.0"?>')).toThrow(/no root element/);
  });

  it("rejects an unescaped ampersand in text", () => {
    expect(() => assertXmlWellFormed("<a>Betania & Sons</a>")).toThrow(/unescaped/);
  });

  it("accepts properly escaped entities", () => {
    expect(() => assertXmlWellFormed("<a>Betania &amp; Sons &#169;</a>")).not.toThrow();
  });

  it("catches an unclosed root — the exact class of bug a hand-edit could introduce", () => {
    expect(() => assertXmlWellFormed("<Wix><Fragment></Fragment>")).toThrow(/unclosed tag/);
  });
});
