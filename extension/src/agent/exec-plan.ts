// exec-plan runs a command WITHOUT a shell (B42.8) — the port of agent/internal/runner Run.
// cmdguard-pure's plan() splits it into simple commands joined by |, &&, || and ;, and each one is
// spawned as a program with an argument list, so no string, model-authored or not, ever reaches
// sh -c or powershell, and a metacharacter plan() does not interpret reaches the program literally.
//
// shortcut: on Windows, npm/yarn/pnpm are .cmd files that Node will not start without a shell, so
// they fail to spawn (exit 127); upgrade by resolving the .cmd shim to the node script it runs.
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { plan, Step } from "./cmdguard-pure";

export interface PlannedResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** runPlanned runs command in cwd. A command plan() refuses exits 2 and a program that cannot
 *  start exits 127, as under a shell; on timeout every live process is killed and it exits 124.
 *  onData sees stdout and stderr as they arrive. */
export async function runPlanned(
  command: string,
  cwd: string,
  timeoutMs: number,
  onData?: (text: string) => void,
): Promise<PlannedResult> {
  const res: PlannedResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  const out = (t: string): void => {
    res.stdout += t;
    onData?.(t);
  };
  const err = (t: string): void => {
    res.stderr += t;
    onData?.(t);
  };
  let steps: Step[];
  try {
    steps = plan(command);
  } catch (e) {
    err(`not run: ${e instanceof Error ? e.message : String(e)}\n`);
    res.exitCode = 2;
    return res;
  }
  const live = new Set<ChildProcess>();
  const timer = setTimeout(() => {
    res.timedOut = true;
    for (const c of live) c.kill("SIGKILL");
  }, timeoutMs);
  try {
    // Shell list semantics: && runs on success, || on failure, ; always.
    for (let i = 0; i < steps.length && !res.timedOut; ) {
      let j = i + 1;
      while (j < steps.length && steps[j].op === "|") j++;
      const op = steps[i].op;
      if (i === 0 || op === ";" || (op === "&&" && res.exitCode === 0) || (op === "||" && res.exitCode !== 0)) {
        res.exitCode = await runPipeline(steps.slice(i, j), cwd, live, out, err);
      }
      i = j;
    }
  } finally {
    clearTimeout(timer);
  }
  if (res.timedOut) res.exitCode = 124;
  return res;
}

/** resolveProgram finds a bare program name on PATH only. On Windows libuv looks in the cwd before
 *  PATH, so a go.exe planted in the workspace would otherwise run as `go`. Elsewhere it is unchanged. */
export function resolveProgram(name: string, platform = process.platform, env = process.env): string {
  if (platform !== "win32" || /[\\/]/.test(name)) return name;
  const exts = path.extname(name) ? [""] : (env.PATHEXT ?? ".COM;.EXE").split(";").filter((e) => e !== "");
  for (const dir of (env.PATH ?? env.Path ?? "").split(";")) {
    if (!path.win32.isAbsolute(dir)) continue; // a relative entry is the cwd by another name
    for (const ext of exts) {
      const p = path.win32.join(dir, name + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(`${name}: not found on PATH`);
}

function envFor(st: Step): NodeJS.ProcessEnv {
  if (st.env.length === 0) return process.env;
  const env = { ...process.env };
  for (const a of st.env) {
    const eq = a.indexOf("=");
    env[a.slice(0, eq)] = a.slice(eq + 1);
  }
  return env;
}

function runPipeline(
  steps: Step[],
  cwd: string,
  live: Set<ChildProcess>,
  out: (t: string) => void,
  err: (t: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    let pending = steps.length;
    let code = 0;
    let prev: ChildProcess | undefined;
    steps.forEach((st, i) => {
      const last = i === steps.length - 1;
      let failed = false;
      let program: string;
      try {
        program = resolveProgram(st.argv[0]);
      } catch (e) {
        failed = true;
        err(`${e instanceof Error ? e.message : String(e)}\n`);
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- a path that is never opened, only handed to spawn so it fails
        program = path.join(os.tmpdir(), "talyvor-not-found", st.argv[0]); // fails to spawn: exit 127, pipeline intact
      }
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- an argument list from plan(), no shell option; the run tool admits the program through check() or the user's confirmation
      const child = spawn(program, st.argv.slice(1), {
        cwd,
        env: envFor(st),
        stdio: [prev ? "pipe" : "ignore", "pipe", "pipe"],
      });
      live.add(child);
      if (prev?.stdout && child.stdin) {
        child.stdin.on("error", () => {}); // the reader exited early; the writer gets EPIPE, as in a shell
        prev.stdout.pipe(child.stdin);
      }
      if (last) child.stdout?.on("data", (b: Buffer) => out(b.toString()));
      child.stderr?.on("data", (b: Buffer) => err(b.toString()));
      child.on("error", (e) => {
        if (!failed) err(`${st.argv[0]}: ${e.message}\n`);
        failed = true;
      });
      child.on("close", (c, sig) => {
        live.delete(child);
        if (last) code = failed ? 127 : (c ?? (sig ? 128 + (os.constants.signals[sig] ?? 0) : 1));
        if (--pending === 0) resolve(code);
      });
      prev = child;
    });
  });
}
