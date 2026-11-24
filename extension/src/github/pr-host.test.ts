import { test } from "node:test";
import assert from "node:assert/strict";
import { isGitHub } from "./pr-pure";

// B67.7 (CodeQL #13): isGitHub asked whether "github.com" appeared anywhere in the remote URL,
// so a remote on another host that merely mentions github.com passed as GitHub.
test("isGitHub is true only when the remote's host is github.com", () => {
  assert.equal(isGitHub("https://github.com/a/b"), true);
  assert.equal(isGitHub("https://github.com/a/b.git"), true);
  assert.equal(isGitHub("git@github.com:a/b.git"), true);
  assert.equal(isGitHub("ssh://git@github.com/a/b.git"), true);
  assert.equal(isGitHub("https://github.com.attacker.example/a/b"), false);
  assert.equal(isGitHub("https://attacker.example/github.com/a/b"), false);
  assert.equal(isGitHub("git@attacker.example:github.com/b.git"), false);
  assert.equal(isGitHub("git@gitlab.com:a/b"), false);
  assert.equal(isGitHub(""), false);
});
