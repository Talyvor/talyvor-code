# Talyvor Code for JetBrains

AI coding assistant for IntelliJ IDEA, GoLand, PyCharm, and the
rest of the JetBrains lineup, version 2025.1 or later. It runs on its
own Talyvor agent wallet: every call spends only that agent's budget,
under its rules, attributed to the active issue.

## Requirements

- JDK 21 (Temurin or any OpenJDK 21 build)

That is the whole list. The Gradle wrapper **is** committed —
`gradlew`, `gradlew.bat` and `gradle/wrapper/gradle-wrapper.jar` are
all tracked — so `./gradlew` downloads and runs the pinned Gradle 9.8.1
on its own. Do not run `gradle wrapper`: without a system Gradle it
fails outright, and with one it rewrites `gradle-wrapper.properties`
to whatever version you happen to have installed, moving your build
off the version CI provisions.

## Build

```bash
cd jetbrains
./gradlew buildPlugin    # → build/distributions/talyvor-code-0.1.0.zip
```

## Install

It is not on the JetBrains Marketplace. In your JetBrains IDE (2025.1 or later):
1. Settings → Plugins → ⚙️ → **Install Plugin from Disk…**
2. Select `jetbrains/build/distributions/talyvor-code-0.1.0.zip`
3. Restart the IDE when prompted

## Configure

**Settings → Tools → Talyvor Code:**

| Field | Notes |
| --- | --- |
| Lens URL | e.g. `http://localhost:8080` |
| Agent key (from Agent Wallets) | In Talyvor, open **Agent Wallets**, create an agent for this IDE and paste its key |
| Workspace ID | The workspace this IDE belongs to |
| Active issue | e.g. `ENG-42` — every call gets attributed |
| Model | Defaults to `claude-haiku-4-5`; pick any Lens-supported model |

## Features

| Surface | Action |
| --- | --- |
| Right-click in editor → Talyvor → **Explain Code** | Sends the selection to Lens with the `explain` feature tag |
| Right-click in editor → Talyvor → **Generate Tests** | Language-aware prompt + framework detection + output sanitising; upgrades Haiku → Sonnet via the shared model catalogue |
| Right-click in editor → Talyvor → **Open Chat** | Reveals the `Talyvor Code` tool window |
| Tool window → composer | **Streaming** multi-turn chat with rolling history |
| Tools → Talyvor → **Test Lens Connection** | `/healthz` reachability **plus** an authenticated `/v1/auth/me` probe, so a wrong or revoked API key reads as ❌ rather than ✅ |
| Tools → Talyvor → **Select AI Model** | Pick from the shared model catalogue |
| Tools → Talyvor → **Generate Shell Command** | NL → single command, with an advisory safety screen (display-only) |

That is everything it ships. It has no inline completions, agent
mode, cost dashboard, Track or Docs commands.

See **[PLUGIN.md](PLUGIN.md)** for the pure-core / IDE-shell
architecture, the test suite, and the manual verification steps for
the UI surfaces.

## Plugin metadata

| Key | Value |
| --- | --- |
| Plugin ID | `com.talyvor.code` |
| Plugin XML | `src/main/resources/META-INF/plugin.xml` |
| Built against | IntelliJ IDEA 2026.2.3 |
| Since build | `251` (2025.1) |
| Until build | none |

## Verifying the build

```bash
cd jetbrains
./gradlew buildPlugin verifyPlugin
```

CI runs `./gradlew test buildPlugin verifyPlugin --no-daemon` on every
push and PR — see `.github/workflows/ci.yaml`, `jetbrains` job.
`verifyPlugin` checks the plugin against IntelliJ IDEA Community 2025.1
and IntelliJ IDEA 2026.2.3, so a plugin that would not load on either
turns CI red.
