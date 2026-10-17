import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { newRunTool } from "./loop-tools";

// B42.8 — the run tool never hands model text to a shell. Every command is APPROVED, so only the
// executor stands between it and a shell; any interpreted metacharacter would leave a `pwned` file
// in the workspace or beside it, or come back expanded. The TS twin of agentloop/noshell_test.go.
test("approved commands with shell metacharacters run no shell", { skip: process.platform === "win32" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "talyvor-noshell-"));
  const outside = path.join(path.dirname(root), path.basename(root) + "-pwned");
  const tool = newRunTool(root, 20_000, async () => true);
  const run = (cmd: string): Promise<string> => tool.run(JSON.stringify({ cmd }));

  for (const cmd of [
    "printf x > pwned",
    `printf x >> ${outside}`,
    "node --version $(touch pwned)",
    "node --version `touch pwned`",
    "touch pwned &",
    "git status 2>&1 > pwned",
    String.raw`node --version \; touch pwned`,
    "cat < /etc/passwd",
  ]) {
    await run(cmd);
  }
  assert.equal(fs.existsSync(path.join(root, "pwned")), false, "a shell construct created a file in the workspace");
  assert.equal(fs.existsSync(outside), false, "a shell construct wrote outside the workspace");

  fs.writeFileSync(path.join(root, "a.ts"), "");
  const lit = await run("printf %s- $HOME *.ts ~");
  assert.match(lit, /\$HOME-\*\.ts-~-/, `metacharacters were expanded, want them literal:\n${lit}`);

  assert.match(await run('printf "b\\na\\n" | sort'), /a\nb/, "pipe did not connect the two programs");
  await run("false && touch and-ran");
  await run("false || touch or-ran");
  assert.equal(fs.existsSync(path.join(root, "and-ran")), false, "&& ran its right side after a failure");
  assert.equal(fs.existsSync(path.join(root, "or-ran")), true, "|| did not run its right side after a failure");
});
