import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHTML } from "./docs-pure";

// B67.7 (CodeQL #6–#12): DocsPanel puts escapeHTML's output inside double-quoted attributes
// (data-url, data-title, value, class). A doc whose title held a `"` closed the attribute and
// wrote its own after it, so a page title could replace the URL "Open in browser" opens.
test("escapeHTML leaves no quote that can close an attribute", () => {
  const title = `Runbook" data-url="https://attacker.example/" x='`;
  const out = escapeHTML(title);
  assert.ok(!out.includes(`"`), out);
  assert.ok(!out.includes(`'`), out);
  assert.equal(escapeHTML(`a & <b> "c" 'd'`), "a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;");
});
