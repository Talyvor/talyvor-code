// Package runner powers the self-healing loop. Two responsibilities:
//
//  1. Detect a project's build/test command (`go build ./...`,
//     `npm test`, …) from on-disk markers.
//  2. Run that command, capture stdout/stderr/exit code, enforce
//     a timeout, and report a structured result.
//
// The healing logic lives in healer.go; this file is the IO side.
package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/talyvor/code/internal/cmdguard"
)

// Language is a typed enum so callers don't have to remember the
// stringly-typed identifiers used elsewhere in the codebase.
type Language string

const (
	LangGo         Language = "go"
	LangTypeScript Language = "typescript"
	LangJavaScript Language = "javascript"
	LangPython     Language = "python"
	LangRust       Language = "rust"
	LangRuby       Language = "ruby"
)

// ExecutionResult is the output of a single command invocation.
// Duration is wall-clock, useful for telemetry / "took 3.2s" UI.
type ExecutionResult struct {
	Command  string
	Stdout   string
	Stderr   string
	ExitCode int
	Duration time.Duration
}

// DetectBuildCommand inspects root for the conventional marker
// files and returns the canonical build/test command + the
// language it implies. Returns an error when no marker is found
// — callers should treat that as "skip healing" rather than a
// hard failure.
func DetectBuildCommand(root string) (string, Language, error) {
	root = stringsOrDot(root)
	// Order matters: Go > Rust > Python > Ruby > JS/TS, picking
	// the most-specific marker first. JS/TS comes last because
	// a Go monorepo with a tooling package.json shouldn't shadow
	// the Go build.
	if exists(root, "go.mod") {
		return "go build ./...", LangGo, nil
	}
	if exists(root, "Cargo.toml") {
		return "cargo check", LangRust, nil
	}
	if exists(root, "requirements.txt") || exists(root, "pyproject.toml") {
		return "python -m pytest", LangPython, nil
	}
	if exists(root, "Gemfile") {
		return "bundle exec rspec", LangRuby, nil
	}
	if exists(root, "package.json") {
		// Only claim npm test when the package.json actually has
		// a "test" script — bare manifests are common in monorepo
		// roots and `npm test` would just print "Error: no test
		// specified".
		hasTest, err := hasNPMTestScript(filepath.Join(root, "package.json"))
		if err != nil {
			return "", "", fmt.Errorf("runner: %w", err)
		}
		if !hasTest {
			return "", "", fmt.Errorf("runner: cannot detect build system (package.json has no `test` script)")
		}
		// Prefer TypeScript when a tsconfig.json sits alongside.
		lang := LangJavaScript
		if exists(root, "tsconfig.json") {
			lang = LangTypeScript
		}
		return "npm test", lang, nil
	}
	return "", "", errors.New("runner: cannot detect build system (no go.mod / Cargo.toml / requirements.txt / Gemfile / package.json)")
}

func exists(root, name string) bool {
	_, err := os.Stat(filepath.Join(root, name))
	return err == nil
}

func stringsOrDot(s string) string {
	if s == "" {
		return "."
	}
	return s
}

// hasNPMTestScript decodes package.json's scripts map far enough
// to check whether a "test" entry exists.
func hasNPMTestScript(path string) (bool, error) {
	buf, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(buf, &pkg); err != nil {
		// Treat unreadable manifest as "no test script" rather
		// than failing the whole heal flow.
		return false, nil
	}
	_, ok := pkg.Scripts["test"]
	return ok, nil
}

// Run executes `command` WITHOUT a shell. cmdguard.Plan splits it into simple commands joined by |,
// &&, || and ;, and each one starts as a program with an argument list — so no string, model-authored
// or typed, ever reaches sh -c or powershell, and a metacharacter Plan does not interpret arrives at
// the program as a literal argument instead of being executed. Stdout + stderr are captured verbatim;
// a non-zero exit is NOT an error — the caller decides what to do with the captured output. A command
// Plan refuses exits 2 and a program that cannot start exits 127, as they would under a shell, so the
// caller sees an observation rather than an error. The timeout kills every process still running.
func Run(ctx context.Context, command, workDir string, timeout time.Duration) (*ExecutionResult, error) {
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var stdout bytes.Buffer
	stderr := &lockedBuffer{}
	start := time.Now()
	exitCode := 0
	steps, err := cmdguard.Plan(command)
	if err != nil {
		fmt.Fprintf(stderr, "not run: %v\n", err)
		exitCode = 2
	}
	// Shell list semantics: && runs on success, || on failure, ; always; the status is the last
	// pipeline's that ran.
	for i := 0; i < len(steps); {
		j := i + 1
		for j < len(steps) && steps[j].Op == "|" {
			j++
		}
		op := steps[i].Op
		if i == 0 || op == ";" || (op == "&&" && exitCode == 0) || (op == "||" && exitCode != 0) {
			exitCode = runPipeline(rctx, steps[i:j], workDir, &stdout, stderr)
		}
		i = j
	}
	if rctx.Err() == context.DeadlineExceeded {
		exitCode = 124
	}
	return &ExecutionResult{
		Command:  command,
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		ExitCode: exitCode,
		Duration: time.Since(start),
	}, nil
}

// runPipeline starts each step with its stdout piped into the next one's stdin and returns the last
// step's exit status.
func runPipeline(ctx context.Context, steps []cmdguard.Step, dir string, stdout, stderr io.Writer) int {
	cmds := make([]*exec.Cmd, len(steps))
	for i, st := range steps {
		// nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command -- an argument list from cmdguard.Plan, never a shell; the agent's run tool admits the program through cmdguard.Check or the user's confirmation
		c := exec.CommandContext(ctx, st.Argv[0], st.Argv[1:]...)
		c.Dir = dir
		if len(st.Env) > 0 {
			c.Env = append(os.Environ(), st.Env...)
		}
		c.Stderr = stderr
		cmds[i] = c
	}
	last := len(cmds) - 1
	cmds[last].Stdout = stdout
	var ends []*os.File
	defer func() {
		for _, f := range ends {
			_ = f.Close()
		}
	}()
	for i := 0; i < last; i++ {
		r, w, err := os.Pipe()
		if err != nil {
			fmt.Fprintf(stderr, "pipe: %v\n", err)
			return 1
		}
		cmds[i].Stdout, cmds[i+1].Stdin = w, r
		ends = append(ends, r, w)
	}
	started := make([]bool, len(cmds))
	code := 0
	for i, c := range cmds {
		if err := c.Start(); err != nil {
			fmt.Fprintf(stderr, "%s: %v\n", steps[i].Argv[0], err)
			if i == last {
				code = 127
			}
			continue
		}
		started[i] = true
	}
	// The children hold their own copies; ours must close so each reader sees EOF.
	for _, f := range ends {
		_ = f.Close()
	}
	ends = nil
	for i, c := range cmds {
		if !started[i] {
			continue
		}
		err := c.Wait()
		if i != last {
			continue
		}
		var ee *exec.ExitError
		switch {
		case err == nil:
			code = 0
		case errors.As(err, &ee):
			code = ee.ExitCode()
		default:
			fmt.Fprintf(stderr, "%s: %v\n", steps[i].Argv[0], err)
			code = 1
		}
	}
	return code
}

// lockedBuffer lets every process in a pipeline write stderr into one buffer: os/exec copies each
// Cmd's output on its own goroutine.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// IsSuccess returns true when the process exited cleanly.
// nil-safe so callers can chain Run → IsSuccess without an
// intermediate nil-check.
func IsSuccess(r *ExecutionResult) bool {
	return r != nil && r.ExitCode == 0
}
