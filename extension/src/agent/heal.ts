// heal.ts is the vscode-bound side of the self-healing loop:
//   - Detects the workspace's build/test command from on-disk markers.
//   - Runs the command via Node's child_process, streaming output
//     into a dedicated OutputChannel so the user can watch it.
//   - Returns a structured result the AgentMode can hand to Lens.
//
// The pure logic (markers → plan, prompt builder, JSON parser)
// lives in heal-pure.ts so it stays unit-testable.

import * as vscode from "vscode";
import { runPlanned } from "./exec-plan";
import {
  detectBuildCommandFromMarkers,
  type BuildPlan,
  type HealLanguage,
} from "./heal-pure";

const BUILD_TIMEOUT_MS = 60_000;

export interface HealExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// detectBuildCommand walks the workspace root for the usual
// marker files and returns a BuildPlan, or undefined when no
// system can be detected.
export async function detectBuildCommand(rootFsPath: string): Promise<BuildPlan | undefined> {
  const candidates = [
    "go.mod",
    "Cargo.toml",
    "requirements.txt",
    "pyproject.toml",
    "Gemfile",
    "package.json",
    "tsconfig.json",
  ];
  const markers = new Set<string>();
  await Promise.all(
    candidates.map(async (name) => {
      try {
        const uri = vscode.Uri.file(joinPath(rootFsPath, name));
        await vscode.workspace.fs.stat(uri);
        markers.add(name);
      } catch {
        // missing — fine
      }
    }),
  );
  const hasTest = markers.has("package.json")
    ? await hasNpmTestScript(joinPath(rootFsPath, "package.json"))
    : false;
  return detectBuildCommandFromMarkers(markers, hasTest);
}

// runBuild executes the command WITHOUT a shell (exec-plan: argument lists, never sh -c or
// powershell), streaming combined output into the supplied OutputChannel. The 60s timeout is the
// same as the Go side.
export async function runBuild(
  command: string,
  workDir: string,
  channel: vscode.OutputChannel,
): Promise<HealExecutionResult> {
  channel.appendLine(`\n$ ${command}`);
  const start = Date.now();
  const r = await runPlanned(command, workDir, BUILD_TIMEOUT_MS, (t) => channel.append(t));
  return { command, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: Date.now() - start };
}

// stitchOutput combines stderr + stdout the same way the Go side
// does — most build tools write diagnostics to stderr but some
// (notably Go test) put them on stdout.
export function stitchOutput(r: HealExecutionResult): string {
  if (r.stderr && r.stdout) return `${r.stderr}\n${r.stdout}`;
  return r.stderr || r.stdout || "";
}

export function languageFromPlan(plan: BuildPlan | undefined): HealLanguage {
  return plan ? plan.language : "";
}

async function hasNpmTestScript(path: string): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    const raw = new TextDecoder().decode(bytes);
    const json = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Boolean(json.scripts && json.scripts.test);
  } catch {
    return false;
  }
}

function joinPath(root: string, name: string): string {
  if (!root) return name;
  const sep = root.endsWith("/") || root.endsWith("\\") ? "" : "/";
  return root + sep + name;
}
