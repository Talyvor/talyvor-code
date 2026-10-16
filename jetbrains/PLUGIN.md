# Talyvor Code for JetBrains — status

This document tracks what the JetBrains plugin actually does today,
how it is built, and how to verify the surfaces that can't be
unit-tested. It is the companion to `README.md` (install/configure).

The plugin ports some of the `extension/` VS Code extension's `*-pure`
modules to dependency-free Kotlin (unit-tested with JUnit) and wires
them into IDE surfaces.

## Architecture: pure core, thin IDE shell

The VS Code extension separates **pure** logic (no `vscode` import,
unit-tested) from VS Code-dependent glue. This plugin mirrors that:

| Pure Kotlin (JUnit-tested, no IntelliJ Platform dep) | Mirrors (VS Code) |
| --- | --- |
| `model/Models.kt` | `model/models-pure.ts` |
| `lens/SsePure.kt` | `lens/sse-pure.ts` |
| `testing/TestGenPure.kt` | `providers/test-generator-pure.ts` |
| `shell/ShellPure.kt` | `commands/shell-pure.ts` |

Keeping these in lock-step means the JetBrains, VS Code, and Go CLI
surfaces pick the same model defaults, parse the same SSE streams, name
test files the same way, and apply the same dangerous-command screen.
The JUnit suites are **direct ports** of the extension's tests, so a
divergence in behaviour fails a test on at least one side.

The IDE shell (`actions/`, `toolwindow/`, `*Settings`, `LensClient`)
depends on the IntelliJ Platform and is verified by compilation +
manual in-IDE checks (it can't be exercised without an IDE sandbox).

## What works today

| Surface | Entry point | Backed by | Verified by |
| --- | --- | --- | --- |
| Explain Code | Editor right-click → Talyvor | `LensClient.complete` | manual |
| Generate Tests (language-aware) | Editor right-click → Talyvor | `TestGenPure` + `Models` | unit + manual |
| Streaming chat | Tool window composer | `LensClient.completeStream` + `SsePure` | unit (parser) + manual |
| Open Chat | Editor right-click / tool window | — | manual |
| Generate Shell Command | Tools → Talyvor | `ShellPure` + `Models` | unit (helpers) + manual |
| Test Lens Connection | Tools → Talyvor | `LensClient.getStatus` + `LensClient.verifyCredential` → `ConnReportPure` | unit (`ConnReportPureTest`, `CredentialProbeTest`, `CredentialVerdictParityTest`) + manual |
| Select AI Model | Tools → Talyvor | `Models` catalogue | manual |
| Settings (Lens URL/key, workspace, issue, model) | Settings → Tools → Talyvor Code | `TalyvorSettings` | manual |
| Per-issue cost attribution | every Lens call | `X-Talyvor-{Feature,Workspace,Issue}` headers | manual |

### Notable behaviours

- **Language-aware tests.** Generate Tests derives the language from the
  file extension (`TestGenPure.canonicalLanguageId`), sends the
  language-tailored system prompt + fenced payload, and sanitises the
  reply (strips `Here are the tests:` preambles and code fences) before
  showing it, titled with the detected framework.
- **Streaming chat.** The composer renders a live assistant bubble that
  grows per delta. It falls back to a single chunk when Lens returns
  plain JSON instead of SSE (some proxies ignore `stream:true`).
- **Model defaults never drift.** Generate Tests upgrades the cheap
  Haiku default to Sonnet via `Models.defaultForCommand("test-gen")`,
  the same mapping the VS Code + CLI surfaces use.
- **Shell safety is advisory.** `ShellPure.isCommandSafe` flips the
  result dialog to a warning for known-dangerous commands (`rm -rf /`,
  fork bombs, `curl … | sh`, …). The action is **display-only** — it
  never executes the command.

## Build & test

Requires JDK 21. Nothing else: the Gradle wrapper is committed, so
`./gradlew` provisions Gradle 9.8.1 itself — see `README.md`.

```bash
cd jetbrains
./gradlew test          # run the JUnit pure-logic suites
./gradlew test buildPlugin verifyPlugin   # what CI runs
```

CI (`.github/workflows/ci.yaml`, `jetbrains` job) runs
`./gradlew test buildPlugin verifyPlugin` on every push/PR.

Current suite: **49 tests, 0 failures** — `ModelsTest` (6),
`SsePureTest` (15), `TestGenPureTest` (17), `ShellPureTest` (11).

## Manual verification (UI surfaces)

These need a running Lens + a sandbox IDE (`./gradlew runIde`) and a
configured Lens URL/key. Each step is the minimum to confirm the
surface works end-to-end.

1. **Test Lens Connection** — Tools → Talyvor → Test Lens Connection →
   expect `✅ Connected to Lens v… — API key verified` (a clear ❌ when
   the URL is wrong, and a different ❌ naming the key when Lens answers
   401/403). Confirms `getStatus`/healthz **and** `verifyCredential`
   against `/v1/auth/me`. ⚠ Worth doing with a deliberately wrong key
   too: before that second probe existed this step passed with one.
2. **Select AI Model** — Tools → Talyvor → Select AI Model → pick a
   model → reopen Settings → Tools → Talyvor Code and confirm the Model
   field updated.
3. **Streaming chat** — open the Talyvor Code tool window, send a
   prompt, confirm the reply appears incrementally (not all at once) and
   that a follow-up message carries prior context.
4. **Generate Tests** — select a function in a `.go`/`.py`/`.ts` file →
   right-click → Talyvor → Generate Tests → confirm the dialog title
   shows the right framework (Go testing / pytest / Jest) and the body
   has no stray ``` fences or "Here are the tests:" preamble.
5. **Generate Shell Command** — Tools → Talyvor → Generate Shell
   Command → describe a task → confirm a single command (no fences). Try
   a destructive description and confirm the warning dialog appears.

## Not in the plugin

The VS Code extension has these and the plugin does not: inline
completions; cost tracking, status bar and cost dashboard; Track
commands; Docs commands; agent mode; `.talyvor-rules` /
`.talyvor-context` / `.talyvor-scopes` loaders; Fix Error, Refactor,
Review Selection / Review PR and Generate Tests for File. Its settings
are the five fields in Settings → Tools → Talyvor Code and nothing else.