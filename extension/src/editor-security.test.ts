import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { stripGenerated } from "./commands/shell-pure";
import { cspMeta } from "./panels/csp-pure";
import { setSecret, type PlaintextStore, type SecretStore } from "./secrets-pure";

// B50.11 — tokens, webviews and commands. One test per line of the item's checklist that code can
// hold; the dependency audit and the history secret scan run in CI.

const SRC = path.join(__dirname, "..", "..", "src");
const sources = (): { file: string; text: string }[] =>
  fs
    .readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(SRC, f), "utf8") }));

test("Set API Key puts the token in secret storage and nowhere in settings", async () => {
  const secrets = new Map<string, string>();
  const plaintext = new Map<string, string>([["lensApiKey", "old-plaintext"]]);
  const s: SecretStore = {
    get: async (k) => secrets.get(k),
    store: async (k, v) => void secrets.set(k, v),
    delete: async (k) => void secrets.delete(k),
  };
  const p: PlaintextStore = { read: (k) => plaintext.get(k) ?? "", clear: async (k) => void plaintext.delete(k) };

  await setSecret(p, s, "lensApiKey", "  tlv_typed  ");
  assert.equal(secrets.get("lensApiKey"), "tlv_typed");
  assert.equal(plaintext.has("lensApiKey"), false, "a plaintext copy survived");

  await setSecret(p, s, "lensApiKey", "");
  assert.equal(secrets.has("lensApiKey"), false, "an empty box should remove the key");
});

test("every webview carries a strict content security policy and loads no remote script", () => {
  const panels = sources().filter((s) => s.text.includes("createWebviewPanel("));
  assert.ok(panels.length >= 7, `found ${panels.length} webview files, expected at least 7`);
  for (const { file, text } of panels) assert.match(text, /\$\{cspMeta\(/, `${file} renders a webview without cspMeta`);
  for (const { file, text } of sources()) {
    for (const tag of text.match(/<script\b[^>]*>/g) ?? []) {
      assert.equal(tag, '<script nonce="${nonce}">', `${file}: ${tag} has no nonce, or loads a src`);
    }
  }
  const policy = cspMeta("abc");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'nonce-abc';/);
  assert.doesNotMatch(policy, /https?:|\*|unsafe-eval/);
  assert.match(cspMeta(), /script-src 'none';/);
});

test("no shell command is built from workspace or server text", () => {
  // The Shell command stages the model's answer in a terminal for the user to run. A \r, or an ESC
  // sequence ending a bracketed paste, would run it without them.
  for (const raw of ["ls\rrm -rf ~", "ls\u2028rm -rf ~", "echo hi\x1b[201~\x0d", "echo a\x03b"]) {
    const out = stripGenerated(raw);
    assert.doesNotMatch(out, /[\x00-\x1f\x7f-\x9f\u2028\u2029]/, JSON.stringify(raw));
  }
  assert.equal(stripGenerated("ls\rrm -rf ~"), "ls");
  // Every process the extension starts gets an argument list: no exec/execSync, no shell option.
  for (const { file, text } of sources()) {
    assert.doesNotMatch(text, /\b(exec|execSync)\s*\(\s*[`"']/, `${file} runs a command line through a shell`);
    assert.doesNotMatch(text, /\bshell\s*:\s*true/, `${file} asks child_process for a shell`);
    assert.doesNotMatch(text, /import\s*\{[^}]*\bexec(Sync)?\b[^}]*\}\s*from\s*"child_process"/, file);
  }
});

test("the extension updates only from the signed Marketplace package", () => {
  for (const { file, text } of sources()) {
    assert.doesNotMatch(text, /installExtension|\.vsix/i, `${file} installs or fetches an extension package itself`);
  }
  const listing = fs.readFileSync(path.join(SRC, "..", "README.md"), "utf8");
  assert.doesNotMatch(listing, /--install-extension\s+\S*\.vsix/, "the Marketplace listing tells users to side-load a .vsix");
  assert.match(listing, /code --install-extension talyvor\.talyvor-code/);
});
