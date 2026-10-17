package agentloop

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestRunTool_NoShellInterpretsModelText — B42.8: the run tool never hands model text to a shell.
// Each command is APPROVED (the confirm prompt says yes), so only the runner stands between it and a
// shell; if any metacharacter were interpreted, a `pwned` file would appear in the workspace or
// outside it, or a variable/glob would come back expanded.
func TestRunTool_NoShellInterpretsModelText(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX programs")
	}
	root := t.TempDir()
	outside := filepath.Join(filepath.Dir(root), "pwned-b428")
	t.Cleanup(func() { os.Remove(outside) })
	tool := NewRunToolWithConfirm(root, func(string, string) bool { return true })
	run := func(cmd string) string {
		t.Helper()
		args, _ := json.Marshal(map[string]any{"cmd": cmd})
		obs, err := tool.Run(context.Background(), args)
		if err != nil {
			t.Fatalf("%s: %v", cmd, err)
		}
		return obs
	}

	for _, cmd := range []string{
		"printf x > pwned",
		"printf x >> ../pwned-b428",
		"go version $(touch pwned)",
		"go version `touch pwned`",
		"touch pwned &",
		"git status 2>&1 > pwned",
		`go version \; touch pwned`,
		"cat < /etc/passwd",
	} {
		run(cmd)
	}
	if _, err := os.Stat(filepath.Join(root, "pwned")); err == nil {
		t.Error("a shell construct created a file in the workspace")
	}
	if _, err := os.Stat(outside); err == nil {
		t.Error("a shell construct wrote outside the workspace")
	}

	// Variables, globs and ~ reach the program literally.
	if err := os.WriteFile(filepath.Join(root, "a.go"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	obs := run(`printf %s- $HOME *.go ~`)
	if !strings.Contains(obs, "$HOME-*.go-~-") {
		t.Errorf("metacharacters were expanded, want them literal:\n%s", obs)
	}

	// The operators the guard parses still work, without a shell: pipes, && and ||.
	if obs := run(`printf "b\na\n" | sort`); !strings.Contains(obs, "a\nb") {
		t.Errorf("pipe did not connect the two programs:\n%s", obs)
	}
	run("false && touch and-ran")
	run("false || touch or-ran")
	if _, err := os.Stat(filepath.Join(root, "and-ran")); err == nil {
		t.Error("&& ran its right side after a failure")
	}
	if _, err := os.Stat(filepath.Join(root, "or-ran")); err != nil {
		t.Error("|| did not run its right side after a failure")
	}
}
