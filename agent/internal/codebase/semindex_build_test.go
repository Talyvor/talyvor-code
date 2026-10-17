package codebase

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestConfine_RejectsEscape — the S11 gate: Confine accepts in-root paths and
// rejects `..` escapes and absolute paths outside the root.
func TestConfine_RejectsEscape(t *testing.T) {
	root := t.TempDir()
	if _, err := Confine(root, "../secret.txt"); err == nil {
		t.Error("Confine must reject ../ escape")
	}
	if _, err := Confine(root, "/etc/passwd"); err == nil {
		t.Error("Confine must reject an absolute path outside root")
	}
	p, err := Confine(root, "internal/auth/login.go")
	if err != nil || !strings.HasPrefix(p, root) {
		t.Errorf("Confine must accept an in-root path; got %q err=%v", p, err)
	}
}

// TestConfine_RefusesSymlinkOutOfRoot — B42.8: a symlink inside the root that points out of it
// passes a ".." check, so Confine must resolve it. Directory link, file link, a file not yet created
// under a directory link, and a dangling link are all refused; a link that stays inside is allowed.
func TestConfine_RefusesSymlinkOutOfRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(outside, "secret"), []byte("s"), 0o644))
	must(os.Mkdir(filepath.Join(root, "real"), 0o755))
	must(os.Symlink(outside, filepath.Join(root, "dirlink")))
	must(os.Symlink(filepath.Join(outside, "secret"), filepath.Join(root, "filelink")))
	must(os.Symlink(filepath.Join(outside, "not-yet"), filepath.Join(root, "dangling")))
	must(os.Symlink(filepath.Join(root, "real"), filepath.Join(root, "inlink")))

	for _, p := range []string{"dirlink/secret", "filelink", "dirlink/new/file.go", "dangling", "real/../dirlink/secret"} {
		if _, err := Confine(root, p); err == nil {
			t.Errorf("Confine(%q) must refuse: it resolves outside the root", p)
		}
	}
	for _, p := range []string{"inlink/x.go", "real/new/file.go", filepath.Join(root, "real")} {
		if _, err := Confine(root, p); err != nil {
			t.Errorf("Confine(%q) must allow an in-root path: %v", p, err)
		}
	}
}

// TestBuildFromRoot_ConfinedAndChunks — building the index over a real tree stays
// INSIDE the root (S11): a secret file living OUTSIDE the root is never read into
// the index, and every indexed chunk's file confines to the root.
func TestBuildFromRoot_ConfinedAndChunks(t *testing.T) {
	root := t.TempDir()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(root, "internal/auth"), 0o755))
	must(os.WriteFile(filepath.Join(root, "internal/auth/login.go"),
		[]byte("package auth\n\nfunc Login() string { return \"authentication session token\" }\n"), 0o644))
	must(os.WriteFile(filepath.Join(root, "readme.md"),
		[]byte("This project handles authentication and user login flows.\n"), 0o644))
	// A secret OUTSIDE the root — must NEVER enter the index.
	outside := t.TempDir()
	must(os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("SUPER_SECRET_TOKEN_XYZ"), 0o644))

	idx, err := BuildFromRoot(context.Background(), bagEmbedder{dim: 64}, root, 100)
	if err != nil {
		t.Fatalf("BuildFromRoot: %v", err)
	}
	if len(idx.Chunks) == 0 {
		t.Fatal("expected chunks from the in-root files")
	}
	for _, c := range idx.Chunks {
		if strings.Contains(c.Content, "SUPER_SECRET_TOKEN_XYZ") {
			t.Fatal("index read a file OUTSIDE the root — S11 confinement breached")
		}
		if _, err := Confine(root, c.File); err != nil {
			t.Errorf("chunk file %q does not confine to root", c.File)
		}
	}
}
