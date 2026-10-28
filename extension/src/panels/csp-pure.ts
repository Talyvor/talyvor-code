// csp-pure.ts — the content security policy every Talyvor webview carries.
//
// The panels render text that came from Lens, Track, Docs and the workspace. The policy is what keeps
// a script tag smuggled into that text from running: nothing loads from anywhere (default-src 'none'),
// and a script runs only if it carries this render's nonce, which only the panel's own script tag
// does. Inline styles stay allowed because the panels set colours with style="…" attributes.

import { randomBytes } from "crypto";

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

// cspMeta is the <meta> tag for a webview's <head>. Without a nonce no script runs at all.
export function cspMeta(nonce?: string): string {
  const script = nonce ? `'nonce-${nonce}'` : "'none'";
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${script}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`;
}
