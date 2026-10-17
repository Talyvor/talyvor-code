// S11 workspace-root confinement, extracted VS Code-free so it is unit-testable (node:test) without the
// VS Code integration harness — mirrors the Go agent's confine() (agent/internal/codebase Confine).
import * as fs from "fs";
import * as path from "path";

// absolutise resolves p under the workspace root and REFUSES (throws) any target outside it: an absolute
// path outside root, a "../" escape, or a symlink inside root that points out of it. Containment is
// enforced here, independent of the approval prompt. An absolute path that legitimately lies under root
// is allowed.
//
// ⚠ LEXICAL CONTAINMENT IS NOT ENOUGH: `link -> /etc` passes the ".." check and reads /etc/passwd as
// link/passwd. So the deepest part of the path that exists is resolved with its symlinks and must still
// lie under the resolved root; a dangling symlink is refused, because writing through it would create
// its target wherever that is.
export function absolutise(p: string, root: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- this IS the traversal check: the result is refused below unless it stays under root
  const rootAbs = path.resolve(root || ".");
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- this IS the traversal check: the result is refused below unless it stays under root
  const abs = path.resolve(rootAbs, p); // absolute p honored as-is; relative p resolves under root
  const refuse = (): Error => new Error(`refusing path outside workspace root: ${p}`);
  if (!within(rootAbs, abs)) throw refuse();
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootAbs);
  } catch {
    return abs; // no root on disk, so nothing under it exists to link anywhere
  }
  for (let cur = abs; cur !== rootAbs && cur !== path.dirname(cur); cur = path.dirname(cur)) {
    try {
      fs.lstatSync(cur);
    } catch {
      continue; // not created yet; its nearest existing ancestor decides
    }
    let real: string;
    try {
      real = fs.realpathSync(cur);
    } catch {
      throw refuse(); // dangling symlink
    }
    if (!within(rootReal, real)) throw refuse();
    break;
  }
  return abs;
}

function within(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}
