// Talyvor Code JetBrains plugin.
//
// Compiled against the current stable IntelliJ IDEA (2026.2) with no
// upper build limit, so every IDE from 2025.1 (build 251) on accepts it.
// verifyPlugin checks it against both ends of that range in CI.

import org.gradle.api.tasks.PathSensitivity
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.21"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "com.talyvor"
version = "0.1.0"

// Java 21 bytecode, not the Java 25 that 2026.2 itself is built for, so
// IDEs 2025.1–2026.1 (which run on Java 21) can still load the plugin.
kotlin {
    jvmToolchain(21)
    // Without this, Kotlin writes bridges into ChatToolWindowFactory for every
    // ToolWindowFactory default method, and 2025.1 marks some of those internal,
    // which verifyPlugin rejects.
    compilerOptions {
        jvmDefault.set(org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode.NO_COMPATIBILITY)
    }
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    // The IntelliJ IDEA 2026.2 SDK supplies all the editor + tool
    // window APIs the plugin uses.
    intellijPlatform {
        intellijIdea("2026.2.3")
        // pluginVerifier backs `verifyPlugin`, which CI runs.
        pluginVerifier()
    }
    // org.json is a stable, dep-free JSON library — keeps the
    // plugin classpath small without pulling Jackson.
    implementation("org.json:json:20240303")

    // JUnit 4 backs the pure-logic unit tests (model catalogue, SSE
    // parser, …). Matches the IntelliJ Platform's bundled JUnit and
    // runs under Gradle's default `test` task — no extra config.
    testImplementation("junit:junit:4.13.2")
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "251"
            untilBuild = provider { null }
        }
    }
    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2025.1")
            create(IntelliJPlatformType.IntellijIdea, "2026.2.3")
        }
    }
}

tasks {

    // testdata/safeurl-cases.json is an INPUT of the test task, and saying so is load-bearing.
    //
    // SafeUrlParityTest asserts this plugin's URL rule against that shared file — the same file the
    // Go and TypeScript ports are asserted against — and the file's own header promises "editing
    // this file alone fails all three". MEASURED, and it did not: the file lives outside this
    // Gradle project, so nothing declared it an input. With this block removed, a green run first
    // (`> Task :test`), a second run with NOTHING changed to prove the up-to-date state exists
    // (`> Task :test UP-TO-DATE`), then the table truncated 29 -> 5 and ONLY the table:
    // `> Task :test UP-TO-DATE` again, exit 0, BUILD SUCCESSFUL, zero tests executed, the guard's
    // own floor never reached. With this block present the same truncation reds on that floor.
    //
    // UP-TO-DATE is the mechanism when the build directory is warm; `org.gradle.caching=true` in
    // gradle.properties means FROM-CACHE is the other spelling of the same hole after a clean.
    // Both were observed. A shared population that one consumer cannot see change is not shared.
    //
    // NAME_ONLY rather than RELATIVE because the file sits above the project directory; what must
    // invalidate the cache is its CONTENT, not where the checkout happens to be rooted.
    //
    // ⚠ AND THE SAME HOLE REOPENED THE MOMENT A SECOND SHARED TABLE WAS ADDED. The block above
    // names ONE file, so testdata/credential-verdict-cases.json — added with
    // CredentialVerdictParityTest, which makes the identical promise — was invisible to this task
    // in exactly the same way. MEASURED, not assumed: breaking the KOTLIN port reddened it
    // (`> Task :test`), and breaking the SHARED TABLE, and then truncating it to two rows, both
    // left `> Task :test UP-TO-DATE`, BUILD SUCCESSFUL, while the Go and TypeScript ports reddened
    // on both. A cross-runtime control is what saw it; the parity test itself cannot.
    //
    // Declared as a DIRECTORY so the next shared table is covered on the day it lands rather than
    // the day someone re-runs a control. The Go and TypeScript ports need no equivalent — neither
    // caches a test result against a declared input set.
    test {
        inputs.file(file("../testdata/safeurl-cases.json"))
            .withPropertyName("safeurlSharedCases")
            .withPathSensitivity(PathSensitivity.NAME_ONLY)
        inputs.files(fileTree("../testdata"))
            .withPropertyName("sharedCrossRuntimeTestdata")
            .withPathSensitivity(PathSensitivity.NAME_ONLY)
    }
}
