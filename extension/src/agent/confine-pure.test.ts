import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { absolutise } from "./confine-pure";

// S11 behavioral test — the TS twin of the Go agent's s11_confinement_test.go. Previously the TS
// containment only COMPILED; this exercises it: a "../" escape or an absolute path outside the workspace
// root must be REFUSED (throws), while an in-root path is allowed and resolved under the root.
const root = path.resolve("/home/user/project");

test("absolutise refuses a ../ escape", () => {
  assert.throws(() => absolutise("../evil.txt", root), /refusing path outside workspace root/);
});

test("absolutise refuses a nested ../ climb out of root", () => {
  assert.throws(() => absolutise("sub/../../escape.txt", root), /refusing path outside workspace root/);
});

test("absolutise refuses an absolute path outside root", () => {
  assert.throws(() => absolutise("/etc/passwd", root), /refusing path outside workspace root/);
});

test("absolutise allows an in-root relative path", () => {
  assert.equal(absolutise("sub/ok.txt", root), path.join(root, "sub", "ok.txt"));
});

test("absolutise allows an absolute path that legitimately lies under root", () => {
  assert.equal(absolutise(path.join(root, "sub", "ok.txt"), root), path.join(root, "sub", "ok.txt"));
});

// B42.8 — a symlink inside the root that points out of it passes the ".." check, so absolutise must
// resolve it: a directory link, a file link, a not-yet-created file under a directory link and a
// dangling link are all refused; a link that stays inside is allowed.
test("absolutise refuses a symlink out of the workspace", { skip: process.platform === "win32" }, () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "talyvor-confine-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "talyvor-outside-"));
  fs.writeFileSync(path.join(outside, "secret"), "s");
  fs.mkdirSync(path.join(ws, "real"));
  fs.symlinkSync(outside, path.join(ws, "dirlink"));
  fs.symlinkSync(path.join(outside, "secret"), path.join(ws, "filelink"));
  fs.symlinkSync(path.join(outside, "not-yet"), path.join(ws, "dangling"));
  fs.symlinkSync(path.join(ws, "real"), path.join(ws, "inlink"));
  for (const p of ["dirlink/secret", "filelink", "dirlink/new/file.ts", "dangling", "real/../dirlink/secret"]) {
    assert.throws(() => absolutise(p, ws), /refusing path outside workspace root/, p);
  }
  for (const p of ["inlink/x.ts", "real/new/file.ts", path.join(ws, "real")]) {
    assert.doesNotThrow(() => absolutise(p, ws), p);
  }
});
