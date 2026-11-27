import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const INSTALL_SCRIPT = path.resolve(process.cwd(), "scripts", "install.mjs");
const INSTALL_SH = path.resolve(process.cwd(), "install.sh");
const INSTALL_PS1 = path.resolve(process.cwd(), "install.ps1");

describe("installer", () => {
  let fakeHome: string;
  let fakeProject: string;

  before(async () => {
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-home-"));
    fakeProject = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-proj-"));
  });

  after(async () => {
    await fs.rm(fakeHome, { recursive: true, force: true });
    await fs.rm(fakeProject, { recursive: true, force: true });
  });

  function makeIsolatedEnv(
    homeDir: string,
    extra: Record<string, string | undefined> = {},
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    delete env.GEMINI_HOME;
    delete env.ANTIGRAVITY_APP_DATA_DIR;
    delete env.AGY_FAST_TOOLS;
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    return env;
  }

  it("installs, runs doctor, upgrades idempotently, and uninstalls cleanly in isolated HOME", async () => {
    const env = makeIsolatedEnv(fakeHome);
    const expectedDir = path.join(fakeHome, ".gemini", "config", "plugins", "agy-fast");

    const out1 = execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "install", "--no-enable"],
      { env, encoding: "utf8" },
    );
    assert.match(out1, /Installed agy-fast/);
    assert.match(out1, /MCP server\s+: OK \(5 tools:/);
    assert.match(out1, /SessionStart: OK/);

    // Verify all runtime files (including installer for self-doctor) are present and no node_modules copied
    for (const rel of [
      "plugin.json",
      "mcp_config.json",
      "hooks.json",
      "rules/AGENTS.md",
      "assets/logo.svg",
      "dist/mcp-server.mjs",
      "dist/session-start.mjs",
      "dist/benchmark.mjs",
      "dist/updater.mjs",
      "scripts/install.mjs",
    ]) {
      const stat = await fs.stat(path.join(expectedDir, rel));
      assert.ok(stat.isFile(), `Expected file ${rel}`);
    }
    await assert.rejects(fs.stat(path.join(expectedDir, "node_modules")));

    // Verify installed mcp_config.json enables eager tool loading for all 5 tools
    const installedMcpCfg = JSON.parse(
      await fs.readFile(path.join(expectedDir, "mcp_config.json"), "utf8"),
    ) as {
      mcpServers?: { fast?: { tools?: Record<string, { eager?: boolean }> } };
    };
    for (const toolName of ["batch_search", "apply_edits", "read_slices", "quick_outline", "run_checks"]) {
      assert.equal(
        installedMcpCfg.mcpServers?.fast?.tools?.[toolName]?.eager,
        true,
        `Expected ${toolName} to have eager: true in mcp_config.json`,
      );
    }

    // Doctor passes when run both from source and from installed directory
    const docOut = execFileSync(process.execPath, [INSTALL_SCRIPT, "doctor"], {
      env,
      encoding: "utf8",
    });
    assert.match(docOut, /MCP server\s+: OK/);
    assert.match(docOut, /Host compat\s+: editsFormat=auto/);
    assert.match(docOut, /Version\s+: v\d+\.\d+\.\d+/);
    assert.match(docOut, /Auto-update\s+: off/);
    const cfgOut = execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "config", "--edits-format", "string"],
      { env, encoding: "utf8" },
    );
    assert.match(cfgOut, /editsFormat\s+: string/);
    const cfgDocOut = execFileSync(process.execPath, [INSTALL_SCRIPT, "doctor"], {
      env,
      encoding: "utf8",
    });
    assert.match(cfgDocOut, /Host compat\s+: editsFormat=string \(active edits schema: string/);
    execFileSync(process.execPath, [INSTALL_SCRIPT, "config", "--edits-format", "auto"], {
      env,
      encoding: "utf8",
    });
    const installedDocOut = execFileSync(
      process.execPath,
      [path.join(expectedDir, "scripts", "install.mjs"), "doctor"],
      { env, encoding: "utf8" },
    );
    assert.match(installedDocOut, /MCP server\s+: OK/);

    // Re-install over existing directory with --edits-format persists config cleanly
    execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "install", "--no-enable", "--edits-format", "string"],
      { env, encoding: "utf8" },
    );
    const afterInstallDoc = execFileSync(process.execPath, [INSTALL_SCRIPT, "doctor"], {
      env: { ...env, AGY_FAST_EDITS_FORMAT: "garbage", AGY_FAST_HOST: "garbage" },
      encoding: "utf8",
    });
    assert.match(afterInstallDoc, /Host compat\s+: editsFormat=string \(active edits schema: string/);
    assert.doesNotMatch(afterInstallDoc, /garbage/);
    execFileSync(process.execPath, [INSTALL_SCRIPT, "config", "--edits-format", "auto"], {
      env,
      encoding: "utf8",
    });

    // Uninstall removes directory
    const rmOut = execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "uninstall", "--no-enable"],
      { env, encoding: "utf8" },
    );
    assert.match(rmOut, /Removed agy-fast/);
    await assert.rejects(fs.stat(expectedDir));
  });

  it("supports --project and --link modes and valid shell syntax in install.sh", async () => {
    const env = makeIsolatedEnv(fakeHome);
    const projectTarget = path.join(fakeProject, ".agents", "plugins", "agy-fast");

    execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "install", "--project", fakeProject, "--no-enable"],
      { env, encoding: "utf8" },
    );
    assert.ok((await fs.stat(path.join(projectTarget, "plugin.json"))).isFile());

    const linkTarget = path.join(fakeHome, "linked-agy-fast");
    execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "install", "--target", linkTarget, "--link", "--no-enable"],
      { env, encoding: "utf8" },
    );
    assert.ok((await fs.lstat(linkTarget)).isSymbolicLink());

    // Shell syntax check and local invocation via install.sh (skip only on Windows when `sh` is absent)
    const runShTests =
      process.platform !== "win32" ||
      (() => {
        try {
          execFileSync("sh", ["-c", "exit 0"], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      })();
    if (runShTests) {
      execFileSync("sh", ["-n", INSTALL_SH], { encoding: "utf8" });
      const shTarget = path.join(fakeHome, "sh-installed-agy-fast");
      const shOut = execFileSync("sh", [INSTALL_SH, "--target", shTarget, "--no-enable"], {
        env,
        encoding: "utf8",
      });
      assert.match(shOut, /Installation complete/);

      // Subcommands forwarded cleanly via install.sh (doctor & uninstall must NOT install!)
      const shDoc = execFileSync("sh", [INSTALL_SH, "doctor", "--target", shTarget], {
        env,
        encoding: "utf8",
      });
      assert.match(shDoc, /MCP server\s+: OK/);

      const shUn = execFileSync("sh", [INSTALL_SH, "uninstall", "--target", shTarget], {
        env,
        encoding: "utf8",
      });
      assert.match(shUn, /Removed agy-fast/);
      await assert.rejects(fs.stat(shTarget));

      // Uninstall via install.sh on clean HOME must NOT accidentally install
      const cleanHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-clean-"));
      try {
        const unOut = execFileSync("sh", [INSTALL_SH, "uninstall", "--no-enable"], {
          env: makeIsolatedEnv(cleanHome),
          encoding: "utf8",
        });
        assert.match(unOut, /Nothing to remove/);
        await assert.rejects(
          fs.stat(path.join(cleanHome, ".gemini", "config", "plugins", "agy-fast")),
        );
      } finally {
        await fs.rm(cleanHome, { recursive: true, force: true });
      }
    }

    // Missing --target value must fail with a clear error
    assert.throws(() => {
      execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--target"], {
        env,
        stdio: "pipe",
      });
    });

    // Verify uninstall refuses to delete the active source repo itself
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "uninstall", "--target", process.cwd(), "--no-enable"],
        { env, stdio: "pipe" },
      );
    });
  });

  it("keeps install.ps1 safe for Windows PowerShell 5.1 irm | iex and single-arg splatting", async () => {
    const ps1 = await fs.readFile(INSTALL_PS1, "utf8");
    // Pure ASCII avoids Windows PowerShell 5.1 non-BOM UTF-8/CP936 misparsing
    assert.ok(/^[\x00-\x7f]*$/.test(ps1), "install.ps1 must stay pure ASCII");
    // Never splat a potentially unwrapped 1-element $forwardArgs directly after $installer
    assert.doesNotMatch(ps1, /& node\s+\$\w+\s+@forwardArgs/);
    assert.doesNotMatch(ps1, /& node\s+\(Join-Path[^)]+\)\s+@forwardArgs/);
    // Must guard exit so `irm ... | iex` does not close the user's interactive terminal
    assert.match(ps1, /if \(\$__agyFastWasFile\)\s*\{[\s\S]*exit \$__agyFastFinalExit/);
    assert.match(ps1, /System\.Collections\.Generic\.List\[string\]/);
  });

  it("protects source repo across symlink/case variants, rejects ancestors and non-plugin dirs, and handles empty/symlink targets safely", async () => {
    const env = makeIsolatedEnv(fakeHome);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    const run = (args: string[]) =>
      execFileSync(process.execPath, args, { env, encoding: "utf8", stdio: "pipe" });
    const expectFail = (args: string[], pattern: RegExp) => {
      assert.throws(() => run(args), (err: unknown) => {
        assert.match(String((err as { stderr?: string })?.stderr ?? ""), pattern);
        return true;
      });
    };

    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-safety-"));
    const parentAlias = path.join(sandbox, "repo-parent-link");
    try {
      // 1. Symlinked-parent & case-variant same-directory protection
      await fs.symlink(path.dirname(process.cwd()), parentAlias, linkType);
      const aliasedRepo = path.join(parentAlias, path.basename(process.cwd()));
      assert.match(
        run([INSTALL_SCRIPT, "install", "--target", aliasedRepo, "--no-enable"]),
        /Repository is already at target plugin directory/,
      );
      expectFail(
        [INSTALL_SCRIPT, "uninstall", "--target", aliasedRepo, "--no-enable"],
        /Refusing to delete the active source repository/,
      );
      assert.ok((await fs.stat(path.join(process.cwd(), "src"))).isDirectory());

      if (process.platform === "win32" || process.platform === "darwin") {
        const cwd = process.cwd();
        const caseVariant = cwd.toLowerCase() === cwd ? cwd.toUpperCase() : cwd.toLowerCase();
        assert.notEqual(caseVariant, cwd);
        assert.match(
          run([INSTALL_SCRIPT, "install", "--target", caseVariant, "--no-enable"]),
          /Repository is already at target plugin directory/,
        );
        expectFail(
          [INSTALL_SCRIPT, "uninstall", "--target", caseVariant, "--no-enable"],
          /Refusing to delete the active source repository/,
        );
        assert.ok((await fs.stat(path.join(cwd, "src"))).isDirectory());
      }

      // 2. Reject ancestor directory of REPO_ROOT even with a matching plugin.json
      const ancestorDir = path.join(sandbox, "ancestor-root");
      const nestedRepo = path.join(ancestorDir, "nested-repo");
      run([INSTALL_SCRIPT, "install", "--target", nestedRepo, "--no-enable"]);
      await fs.mkdir(path.join(nestedRepo, "src"), { recursive: true });
      await fs.writeFile(path.join(ancestorDir, "plugin.json"), JSON.stringify({ name: "agy-fast" }), "utf8");
      const nestedInstaller = path.join(nestedRepo, "scripts", "install.mjs");
      expectFail([nestedInstaller, "install", "--target", ancestorDir, "--no-enable"], /ancestor directory/);
      expectFail([nestedInstaller, "install", "--target", ancestorDir, "--link", "--no-enable"], /ancestor directory/);
      expectFail([nestedInstaller, "uninstall", "--target", ancestorDir, "--no-enable"], /ancestor directory/);
      assert.ok((await fs.stat(path.join(nestedRepo, "src"))).isDirectory());

      // 3. Reject non-empty non-agy-fast target dirs, other plugins, and regular files
      const nonPluginDir = path.join(sandbox, "user-projects");
      await fs.mkdir(nonPluginDir, { recursive: true });
      const keepUserFile = path.join(nonPluginDir, "important.txt");
      await fs.writeFile(keepUserFile, "do-not-delete", "utf8");
      expectFail([INSTALL_SCRIPT, "install", "--target", nonPluginDir, "--no-enable"], /Refusing to delete non-empty directory/);
      expectFail([INSTALL_SCRIPT, "install", "--target", nonPluginDir, "--link", "--no-enable"], /Refusing to delete non-empty directory/);
      expectFail([INSTALL_SCRIPT, "uninstall", "--target", nonPluginDir, "--no-enable"], /Refusing to delete non-empty directory/);
      assert.equal(await fs.readFile(keepUserFile, "utf8"), "do-not-delete");

      const otherPluginDir = path.join(sandbox, "other-plugin");
      await fs.mkdir(otherPluginDir, { recursive: true });
      await fs.writeFile(path.join(otherPluginDir, "plugin.json"), JSON.stringify({ name: "other-plugin" }), "utf8");
      expectFail([INSTALL_SCRIPT, "install", "--target", otherPluginDir, "--no-enable"], /Refusing to delete non-empty directory/);
      expectFail([INSTALL_SCRIPT, "uninstall", "--target", otherPluginDir, "--no-enable"], /Refusing to delete non-empty directory/);

      const regularFileTarget = path.join(sandbox, "regular-file.txt");
      await fs.writeFile(regularFileTarget, "keep-file", "utf8");
      expectFail([INSTALL_SCRIPT, "install", "--target", regularFileTarget, "--no-enable"], /Refusing to delete/);
      expectFail([INSTALL_SCRIPT, "uninstall", "--target", regularFileTarget, "--no-enable"], /Refusing to delete/);
      assert.equal(await fs.readFile(regularFileTarget, "utf8"), "keep-file");

      // 4. Empty dir, overwrite upgrade, self-uninstall (no src/), and symlink/broken-link safety
      const emptyForInstall = path.join(sandbox, "empty-install");
      await fs.mkdir(emptyForInstall, { recursive: true });
      run([INSTALL_SCRIPT, "install", "--target", emptyForInstall, "--no-enable"]);
      const staleMarker = path.join(emptyForInstall, "stale.tmp");
      await fs.writeFile(staleMarker, "old", "utf8");
      run([INSTALL_SCRIPT, "install", "--target", emptyForInstall, "--no-enable"]);
      await assert.rejects(fs.stat(staleMarker));
      run([path.join(emptyForInstall, "scripts", "install.mjs"), "uninstall", "--target", emptyForInstall, "--no-enable"]);
      await assert.rejects(fs.lstat(emptyForInstall));

      const emptyForUninstall = path.join(sandbox, "empty-uninstall");
      await fs.mkdir(emptyForUninstall, { recursive: true });
      run([INSTALL_SCRIPT, "uninstall", "--target", emptyForUninstall, "--no-enable"]);
      await assert.rejects(fs.lstat(emptyForUninstall));

      const repoLinkTarget = path.join(sandbox, "dev-link");
      run([INSTALL_SCRIPT, "install", "--target", repoLinkTarget, "--link", "--no-enable"]);
      const symlinkInstaller = path.join(repoLinkTarget, "scripts", "install.mjs");
      run(["--preserve-symlinks-main", symlinkInstaller, "install", "--target", repoLinkTarget, "--link", "--no-enable"]);
      assert.equal(await fs.realpath(repoLinkTarget), await fs.realpath(process.cwd()));
      run(["--preserve-symlinks-main", symlinkInstaller, "install", "--target", repoLinkTarget, "--no-enable"]);
      assert.ok(!(await fs.lstat(repoLinkTarget)).isSymbolicLink());
      assert.ok((await fs.stat(path.join(repoLinkTarget, "plugin.json"))).isFile());
      run([INSTALL_SCRIPT, "install", "--target", repoLinkTarget, "--link", "--no-enable"]);
      run([INSTALL_SCRIPT, "uninstall", "--target", repoLinkTarget, "--no-enable"]);
      await assert.rejects(fs.lstat(repoLinkTarget));
      assert.ok((await fs.stat(path.join(process.cwd(), "src"))).isDirectory());

      const extLink = path.join(sandbox, "ext-link-rm");
      await fs.symlink(nonPluginDir, extLink, linkType);
      run([INSTALL_SCRIPT, "uninstall", "--target", extLink, "--no-enable"]);
      await assert.rejects(fs.lstat(extLink));
      assert.equal(await fs.readFile(keepUserFile, "utf8"), "do-not-delete");

      const deadTarget = path.join(sandbox, "dead-target");
      const brokenLink = path.join(sandbox, "broken-link");
      await fs.mkdir(deadTarget, { recursive: true });
      await fs.symlink(deadTarget, brokenLink, linkType);
      await fs.rmdir(deadTarget);
      run([INSTALL_SCRIPT, "uninstall", "--target", brokenLink, "--no-enable"]);
      await assert.rejects(fs.lstat(brokenLink));
    } finally {
      await fs.unlink(parentAlias).catch(() => {});
      await fs.rm(sandbox, { recursive: true, force: true });
    }
  });

  it("auto-syncs global install, doctor, and uninstall across T3 Code ACP and isolated GEMINI_HOME profiles", async () => {
    const acpHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-acp-home-"));
    const customGeminiHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-gemini-home-"));
    try {
      const t3ProfileRoot = path.join(
        acpHome,
        ".t3",
        "userdata",
        "providers",
        "antigravity",
        "ac0a3dfd12345678",
      );
      const t3ConfigPath = path.join(t3ProfileRoot, "config", "config.json");
      await fs.mkdir(path.dirname(t3ConfigPath), { recursive: true });
      await fs.mkdir(path.join(t3ProfileRoot, "antigravity-acp"), { recursive: true });
      await fs.writeFile(
        t3ConfigPath,
        JSON.stringify({ plugins: { swarm: { enabled: true } } }, null, 2) + "\n",
        "utf8",
      );
      await fs.mkdir(path.join(customGeminiHome, "config"), { recursive: true });

      const env = makeIsolatedEnv(acpHome, { GEMINI_HOME: customGeminiHome });
      const primaryDir = path.join(acpHome, ".gemini", "config", "plugins", "agy-fast");
      const t3PluginDir = path.join(t3ProfileRoot, "config", "plugins", "agy-fast");
      const envPluginDir = path.join(customGeminiHome, "config", "plugins", "agy-fast");

      // 1. Global install automatically syncs both T3 Code ACP profile and isolated GEMINI_HOME
      const out = execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable"], {
        env,
        encoding: "utf8",
      });
      assert.match(out, /Synced T3 Code ACP \(ac0a3dfd\)/);
      assert.match(out, /Synced GEMINI_HOME/);
      assert.match(out, /T3 Code ACP \(ac0a3dfd\): OK/);
      assert.match(out, /GEMINI_HOME: OK/);
      assert.ok((await fs.stat(path.join(t3PluginDir, "dist", "mcp-server.mjs"))).isFile());
      assert.ok((await fs.stat(path.join(envPluginDir, "plugin.json"))).isFile());
      // Existing T3 config.json must stay untouched
      const t3CfgAfter = JSON.parse(await fs.readFile(t3ConfigPath, "utf8"));
      assert.deepEqual(t3CfgAfter, { plugins: { swarm: { enabled: true } } });

      // 2. --no-acp opts out of syncing isolated profiles; doctor reports MISSING when removed
      await fs.rm(t3PluginDir, { recursive: true, force: true });
      execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp"], {
        env,
        encoding: "utf8",
      });
      await assert.rejects(fs.lstat(t3PluginDir));
      const docMissing = execFileSync(process.execPath, [INSTALL_SCRIPT, "doctor"], {
        env,
        encoding: "utf8",
      });
      assert.match(docMissing, /T3 Code ACP \(ac0a3dfd\): MISSING/);

      // 3. --project / --target installs never touch T3 Code ACP profiles
      const customTarget = path.join(acpHome, "custom-only-target");
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--target", customTarget, "--no-enable"],
        { env, encoding: "utf8" },
      );
      await assert.rejects(fs.lstat(t3PluginDir));

      // 4. --link dev mode links isolated profiles directly to repo root (no chained symlinks)
      execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--link", "--no-enable"], {
        env,
        encoding: "utf8",
      });
      assert.equal(await fs.realpath(t3PluginDir), await fs.realpath(process.cwd()));
      assert.equal(await fs.realpath(primaryDir), await fs.realpath(process.cwd()));

      // 5. Global uninstall removes primary AND all isolated ACP/GEMINI_HOME links without touching config.json
      const unOut = execFileSync(process.execPath, [INSTALL_SCRIPT, "uninstall", "--no-enable"], {
        env,
        encoding: "utf8",
      });
      assert.match(unOut, /Removed agy-fast from .*T3 Code ACP/);
      assert.match(unOut, /Removed agy-fast from .*GEMINI_HOME/);
      await assert.rejects(fs.lstat(primaryDir));
      await assert.rejects(fs.lstat(t3PluginDir));
      await assert.rejects(fs.lstat(envPluginDir));
      assert.ok((await fs.stat(t3ConfigPath)).isFile());

      // 6. Safety guard refuses to delete non-agy-fast user files in an isolated profile's target dir
      await fs.mkdir(t3PluginDir, { recursive: true });
      const userFile = path.join(t3PluginDir, "keep-me.txt");
      await fs.writeFile(userFile, "safe", "utf8");
      assert.throws(() => {
        execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable"], {
          env,
          stdio: "pipe",
        });
      });
      assert.equal(await fs.readFile(userFile, "utf8"), "safe");
    } finally {
      await fs.rm(acpHome, { recursive: true, force: true });
      await fs.rm(customGeminiHome, { recursive: true, force: true });
    }
  });

  it("does not destroy primary install or fail uninstall when $HOME is a symlink/junction aliased by GEMINI_HOME", async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-home-alias-"));
    const realHome = path.join(sandbox, "real-home");
    const linkHome = path.join(sandbox, "link-home");
    const realGemini = path.join(realHome, ".gemini");
    const separateGemini = path.join(sandbox, "separate-gemini");
    try {
      await fs.mkdir(path.join(realGemini, "config"), { recursive: true });
      await fs.mkdir(path.join(separateGemini, "config"), { recursive: true });
      await fs.symlink(realHome, linkHome, process.platform === "win32" ? "junction" : "dir");

      const aliasEnv = makeIsolatedEnv(linkHome, { GEMINI_HOME: realGemini });
      const primaryViaLink = path.join(linkHome, ".gemini", "config", "plugins", "agy-fast");
      const primaryViaReal = path.join(realGemini, "config", "plugins", "agy-fast");

      // 1. Copied global install: GEMINI_HOME aliases ~/.gemini -> must NOT delete primary or create self-loop
      const copyOut = execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable"], {
        env: aliasEnv,
        encoding: "utf8",
      });
      assert.doesNotMatch(copyOut, /Synced GEMINI_HOME/);
      const realStat = await fs.lstat(primaryViaReal);
      assert.equal(realStat.isSymbolicLink(), false);
      assert.equal(realStat.isDirectory(), true);
      assert.ok((await fs.stat(path.join(primaryViaReal, "dist", "mcp-server.mjs"))).isFile());

      // 2. --link global install + uninstall: must NOT double-unlink with ENOENT
      execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--link", "--no-enable"], {
        env: aliasEnv,
        encoding: "utf8",
      });
      assert.equal((await fs.lstat(primaryViaReal)).isSymbolicLink(), true);
      assert.equal(await fs.realpath(primaryViaLink), await fs.realpath(process.cwd()));
      execFileSync(process.execPath, [INSTALL_SCRIPT, "uninstall", "--no-enable"], {
        env: aliasEnv,
        encoding: "utf8",
      });
      await assert.rejects(fs.lstat(primaryViaReal));

      // 3. Separate GEMINI_HOME alongside symlinked $HOME still syncs and uninstalls normally
      const sepEnv = makeIsolatedEnv(linkHome, { GEMINI_HOME: separateGemini });
      const sepPluginDir = path.join(separateGemini, "config", "plugins", "agy-fast");
      const sepOut = execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable"], {
        env: sepEnv,
        encoding: "utf8",
      });
      assert.match(sepOut, /Synced GEMINI_HOME/);
      assert.equal(await fs.realpath(sepPluginDir), await fs.realpath(primaryViaReal));
      execFileSync(process.execPath, [INSTALL_SCRIPT, "uninstall", "--no-enable"], {
        env: sepEnv,
        encoding: "utf8",
      });
      await assert.rejects(fs.lstat(primaryViaReal));
      await assert.rejects(fs.lstat(sepPluginDir));
    } finally {
      await fs.unlink(linkHome).catch(() => {});
      await fs.rm(sandbox, { recursive: true, force: true });
    }
  });

  it("preserves user-authored rules/*.local.md across re-installs while skipping symlinks and oversized files", async () => {
    const localRulesHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-local-rules-"));
    const externalSecret = path.join(localRulesHome, "outside-secret.txt");
    try {
      const env = makeIsolatedEnv(localRulesHome);
      const pluginDir = path.join(localRulesHome, ".gemini", "config", "plugins", "agy-fast");
      await fs.writeFile(externalSecret, "do-not-copy", "utf8");

      // Initial install
      execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--no-enable"], {
        env,
        encoding: "utf8",
      });

      // Create user-authored local rules (ASCII + Unicode), plus unsafe symlink & >256KB file
      const localRulePath = path.join(pluginDir, "rules", "AGENTS.local.md");
      const unicodeRulePath = path.join(pluginDir, "rules", "团队规范.local.md");
      const symlinkRulePath = path.join(pluginDir, "rules", "evil.local.md");
      const hugeRulePath = path.join(pluginDir, "rules", "huge.local.md");
      await fs.writeFile(
        localRulePath,
        "---\ntrigger: always_on\n---\n# My Local Rules\nAlways run pytest.\n",
        "utf8",
      );
      await fs.writeFile(
        unicodeRulePath,
        "---\ntrigger: always_on\n---\n# 团队规则\n",
        "utf8",
      );
      await fs.writeFile(hugeRulePath, "x".repeat(300 * 1024), "utf8");
      await fs.symlink(externalSecret, symlinkRulePath).catch(() => {});

      // Re-install over existing directory
      const reinstallOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable"],
        { env, encoding: "utf8" },
      );
      assert.match(reinstallOut, /Preserved local rule file\(s\):/);
      assert.match(reinstallOut, /Skipped unsafe\/oversized local rule file\(s\):/);
      assert.equal(
        await fs.readFile(localRulePath, "utf8"),
        "---\ntrigger: always_on\n---\n# My Local Rules\nAlways run pytest.\n",
      );
      assert.equal(
        await fs.readFile(unicodeRulePath, "utf8"),
        "---\ntrigger: always_on\n---\n# 团队规则\n",
      );
      await assert.rejects(fs.lstat(symlinkRulePath));
      await assert.rejects(fs.lstat(hugeRulePath));

      // Migrating an existing copied isolated GEMINI_HOME profile to symlink preserves its unique rules/*.local.md into primary
      const isoGemini = path.join(localRulesHome, "custom-gemini");
      const isoPluginDir = path.join(isoGemini, "config", "plugins", "agy-fast");
      await fs.mkdir(path.join(isoPluginDir, "rules"), { recursive: true });
      await fs.writeFile(path.join(isoPluginDir, "plugin.json"), '{"name":"agy-fast","version":"0.2.8"}\n', "utf8");
      await fs.writeFile(
        path.join(isoPluginDir, "rules", "iso-extra.local.md"),
        "---\ntrigger: always_on\n---\n# Isolated rule\n",
        "utf8",
      );
      const isoSyncOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable"],
        { env: makeIsolatedEnv(localRulesHome, { GEMINI_HOME: isoGemini }), encoding: "utf8" },
      );
      assert.match(isoSyncOut, /Migrated isolated local rule file\(s\) to primary plugin dir: rules\/iso-extra\.local\.md/);
      assert.equal(
        await fs.readFile(path.join(pluginDir, "rules", "iso-extra.local.md"), "utf8"),
        "---\ntrigger: always_on\n---\n# Isolated rule\n",
      );

      // When rules/*.local.md lacks YAML frontmatter, doctor surfaces agy validate output + actionable frontmatter hint
      let hasAgy = false;
      try {
        execFileSync("agy", ["--version"], { stdio: "ignore" });
        hasAgy = true;
      } catch {
        hasAgy = false;
      }
      if (hasAgy) {
        await fs.writeFile(localRulePath, "# Missing frontmatter\n", "utf8");
        let doctorErrOut = "";
        try {
          execFileSync(process.execPath, [INSTALL_SCRIPT, "doctor"], {
            env,
            encoding: "utf8",
            stdio: "pipe",
          });
          assert.fail("Expected doctor to fail when local rule lacks frontmatter");
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string };
          doctorErrOut = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
        }
        assert.match(doctorErrOut, /agy validate: FAILED/);
        assert.match(doctorErrOut, /trigger: always_on/);
      }
    } finally {
      await fs.rm(localRulesHome, { recursive: true, force: true });
    }
  });

  it("persists --tool-loading lazy|eager across config, doctor, and re-installs without dirtying git links", async () => {
    const modeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-tool-loading-"));
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: modeHome,
        USERPROFILE: modeHome,
        AGY_FAST_AUTO_UPDATE: "off",
        AGY_FAST_CACHE_DIR: path.join(modeHome, ".gemini", "cache", "agy-fast"),
      };
      delete env.AGY_FAST_TOOL_LOADING;
      const pluginDir = path.join(modeHome, ".gemini", "config", "plugins", "agy-fast");
      const mcpConfigPath = path.join(pluginDir, "mcp_config.json");

      // 1. Install with --tool-loading lazy strips eager declarations while passing doctor & agy validate
      const installOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp", "--tool-loading", "lazy"],
        { env, encoding: "utf8" },
      );
      assert.match(installOut, /Tool loading: lazy \(0\/5 tools eager in mcp_config\.json\)/);
      const lazyCfg = JSON.parse(await fs.readFile(mcpConfigPath, "utf8"));
      assert.equal(lazyCfg.mcpServers.fast.tools, undefined);

      // 2. Plain re-install preserves persisted toolLoading: "lazy" from config.json
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp"],
        { env, encoding: "utf8" },
      );
      const afterReinstall = JSON.parse(await fs.readFile(mcpConfigPath, "utf8"));
      assert.equal(afterReinstall.mcpServers.fast.tools, undefined);

      // 3. `config --tool-loading eager` flips installed mcp_config.json back to 5/5 eager in-place
      const eagerOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "config", "--no-acp", "--tool-loading", "eager"],
        { env, encoding: "utf8" },
      );
      assert.match(eagerOut, /toolLoading\s*: eager/);
      assert.match(eagerOut, /Applied 'eager' mode/);
      const eagerCfg = JSON.parse(await fs.readFile(mcpConfigPath, "utf8"));
      assert.equal(eagerCfg.mcpServers.fast.tools.batch_search.eager, true);
      assert.equal(eagerCfg.mcpServers.fast.tools.quick_outline.eager, true);
      assert.equal(Object.keys(eagerCfg.mcpServers.fast.tools).length, 5);

      // 4. `config --tool-loading lazy` switches back cleanly in-place
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "config", "--no-acp", "--tool-loading", "lazy"],
        { env, encoding: "utf8" },
      );
      const backToLazy = JSON.parse(await fs.readFile(mcpConfigPath, "utf8"));
      assert.equal(backToLazy.mcpServers.fast.tools, undefined);
    } finally {
      await fs.rm(modeHome, { recursive: true, force: true });
    }
  });

  it("falls back to atomic in-place sync on EBUSY/EPERM copied dir and fails clearly for --link", async () => {
    const busyHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-ebusy-"));
    const env = makeIsolatedEnv(busyHome);
    const targetDir = path.join(busyHome, ".gemini", "config", "plugins", "agy-fast");
    let locker: ReturnType<typeof spawn> | null = null;
    try {
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp"],
        { env, encoding: "utf8" },
      );
      const customRuleContent = "---\ntrigger: always_on\n---\nkeep-me\n";
      await fs.writeFile(path.join(targetDir, "rules", "custom.local.md"), customRuleContent, "utf8");
      const targetManifestPath = path.join(targetDir, "plugin.json");
      const beforeManifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"));
      await fs.writeFile(
        targetManifestPath,
        JSON.stringify({ ...beforeManifest, version: "0.0.1-old" }, null, 2),
        "utf8",
      );

      // Hold a cwd lock inside targetDir (on Windows this causes EBUSY on rename/rmdir)
      locker = spawn(process.execPath, ["-e", 'console.log("READY"); setInterval(() => {}, 1000);'], {
        cwd: path.join(targetDir, "dist"),
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("locker did not emit READY")), 5000);
        locker!.stdout!.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("READY")) {
            clearTimeout(timer);
            resolve();
          }
        });
        locker!.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });

      const reinstallOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp"],
        { env, encoding: "utf8" },
      );
      assert.match(reinstallOut, /Installed agy-fast/);
      if (process.platform === "win32") {
        assert.match(reinstallOut, /updated files atomically in-place/i);
      }
      const afterManifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"));
      assert.equal(afterManifest.version, beforeManifest.version);
      assert.equal(
        await fs.readFile(path.join(targetDir, "rules", "custom.local.md"), "utf8"),
        customRuleContent,
      );
      for (const dir of [targetDir, path.join(targetDir, "dist"), path.join(targetDir, "rules")]) {
        const entries = await fs.readdir(dir);
        assert.equal(entries.some((n) => n.includes(".agy-tmp.")), false);
      }
      const parentEntries = await fs.readdir(path.dirname(targetDir));
      assert.equal(parentEntries.some((n) => n.includes(".agy-trash-")), false);

      if (process.platform === "win32") {
        assert.throws(
          () =>
            execFileSync(
              process.execPath,
              [INSTALL_SCRIPT, "install", "--link", "--no-enable", "--no-acp"],
              { env, encoding: "utf8" },
            ),
          /Close the running host\/MCP process/i,
        );
        // Atomic rename failed before deleting plugin.json / custom.local.md, so both remain intact
        assert.equal(
          await fs.readFile(path.join(targetDir, "rules", "custom.local.md"), "utf8"),
          customRuleContent,
        );
        assert.equal(JSON.parse(await fs.readFile(targetManifestPath, "utf8")).name, "agy-fast");
      }
    } finally {
      if (locker && locker.exitCode === null && locker.signalCode === null) {
        const closed = new Promise<void>((resolve) => {
          locker!.once("close", () => resolve());
        });
        locker.kill("SIGKILL");
        await closed;
      }
      await fs.rm(busyHome, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("starts standalone MCP server and forwards flags cleanly via 'mcp' subcommand", async () => {
    const mcpResult = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [INSTALL_SCRIPT, "mcp", "--schema-compat=minimal"],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: makeIsolatedEnv(fakeHome),
          },
        );
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("install.mjs mcp timed out"));
        }, 10_000);
        timer.unref();
        child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
        child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {} },
          })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
        );
        child.stdin.end();
      },
    );

    assert.equal(mcpResult.code, 0, mcpResult.stderr);
    assert.equal(mcpResult.stderr, "");
    const responses = mcpResult.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(responses.length, 2);
    const tools = responses[1].result.tools as Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>;
    assert.equal(tools.length, 5);
    assert.equal(
      JSON.stringify(tools).includes('"minimum"'),
      false,
      "forwarded --schema-compat=minimal must strip minimum constraints",
    );

    const cliOut = execFileSync(
      process.execPath,
      [INSTALL_SCRIPT, "mcp", "--cli", "outline", "package.json"],
      { env: makeIsolatedEnv(fakeHome), encoding: "utf8" },
    );
    assert.match(cliOut, /package\.json/);
  });

  it("installs and passes doctor even when ambient AGY_FAST_TOOLS is set", async () => {
    const ambientHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-ambient-tools-"));
    try {
      const env = makeIsolatedEnv(ambientHome, {
        AGY_FAST_TOOLS: "batch_search,quick_outline,run_checks",
      });
      execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "install", "--no-enable", "--no-acp"],
        { env, encoding: "utf8" },
      );
      const doctorOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "doctor"],
        { env, encoding: "utf8" },
      );
      assert.match(doctorOut, /MCP server\s+: OK \(5 tools:/);
    } finally {
      await fs.rm(ambientHome, { recursive: true, force: true });
    }
  });

  it("generates standard MCP JSON config snippets, valid Antigravity mcp_config, and tailored generic rules", async () => {
    const cfgHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-fast-mcpcfg-"));
    try {
      const env = makeIsolatedEnv(cfgHome);
      const customTarget = path.join(cfgHome, 'custom "$plugin"');
      const expectedPosix = path.join(customTarget, "dist", "mcp-server.mjs").split(path.sep).join("/");

      // 1. Default mcp-only JSON output + --schema-compat=minimal support
      const jsonOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "mcp-config", "--quiet", "--target", customTarget],
        { env, encoding: "utf8" },
      );
      assert.deepEqual(JSON.parse(jsonOut).mcpServers["agy-fast"], {
        command: "node",
        args: [expectedPosix],
      });

      const minOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "mcp-config", "--quiet", "--host=generic", "--schema-compat=minimal", "--target", customTarget],
        { env, encoding: "utf8" },
      );
      assert.deepEqual(JSON.parse(minOut).mcpServers["agy-fast"], {
        command: "node",
        args: [expectedPosix, "--schema-compat=minimal"],
      });

      // 2. Antigravity mcp_config.json uses tools.<name>.eager (no invalid toolLoading key) and respects --tool-loading lazy
      const agyOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "mcp-config", "--quiet", "--host", "antigravity", "--target", customTarget],
        { env, encoding: "utf8" },
      );
      const agyCfg = JSON.parse(agyOut);
      assert.equal(agyCfg.mcpServers.fast.toolLoading, undefined);
      assert.equal(agyCfg.mcpServers.fast.tools.batch_search.eager, true);
      assert.equal(agyCfg.mcpServers.fast.tools.run_checks.eager, true);

      const agyLazyOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "mcp-config", "--quiet", "--host", "antigravity", "--tool-loading", "lazy", "--target", customTarget],
        { env, encoding: "utf8" },
      );
      assert.equal(JSON.parse(agyLazyOut).mcpServers.fast.tools, undefined);

      // 3. Host-agnostic rules template handles read_slices, shared cwd, dev schema bounds, filtered CLI subcommands, and shell quoting
      const sliceRulesOut = execFileSync(
        process.execPath,
        [INSTALL_SCRIPT, "mcp-config", "--rules", "--tools", "read_slices", "--target", customTarget],
        { env, encoding: "utf8" },
      );
      assert.match(sliceRulesOut, /`read_slices`/);
      assert.match(sliceRulesOut, /Pass explicit `cwd`/);
      assert.match(sliceRulesOut, /lineRanges/);
      assert.match(sliceRulesOut, /<=150/);
      assert.match(sliceRulesOut, /--cli <slice>/);
      assert.ok(sliceRulesOut.includes('\\"\\$plugin\\"'));

      const subsetRulesOut = execFileSync(
        process.execPath,
        [
          INSTALL_SCRIPT,
          "mcp-config",
          "--rules",
          "--tools",
          "batch_search,quick_outline,run_checks",
          "--target",
          customTarget,
        ],
        { env, encoding: "utf8" },
      );
      assert.match(subsetRulesOut, /`batch_search`/);
      assert.match(subsetRulesOut, /contextLines.*0\.\.10/);
      assert.match(subsetRulesOut, /150/);
      assert.match(subsetRulesOut, /--cli <search\|outline\|check>/);
      assert.doesNotMatch(subsetRulesOut, /`apply_edits`/);
      assert.doesNotMatch(subsetRulesOut, /`read_slices`/);
      assert.doesNotMatch(subsetRulesOut, /mcp_agy-fast_fast_|call_mcp_tool|toolSummary|SessionStart/);

      // 4. --tools wires server-side --tools args (and filters Antigravity eager map)
      const filteredJsonOut = execFileSync(
        process.execPath,
        [
          INSTALL_SCRIPT,
          "mcp-config",
          "--quiet",
          "--host",
          "json",
          "--tools",
          "batch_search,quick_outline",
          "--schema-compat=minimal",
          "--target",
          customTarget,
        ],
        { env, encoding: "utf8" },
      );
      assert.deepEqual(JSON.parse(filteredJsonOut).mcpServers["agy-fast"], {
        command: "node",
        args: [expectedPosix, "--tools", "batch_search,quick_outline", "--schema-compat=minimal"],
      });

      const filteredAgyOut = execFileSync(
        process.execPath,
        [
          INSTALL_SCRIPT,
          "mcp-config",
          "--quiet",
          "--host",
          "antigravity",
          "--tools",
          "batch_search,quick_outline",
          "--target",
          customTarget,
        ],
        { env, encoding: "utf8" },
      );
      const filteredAgyCfg = JSON.parse(filteredAgyOut);
      assert.deepEqual(filteredAgyCfg.mcpServers.fast.args, [
        expectedPosix,
        "--tools",
        "batch_search,quick_outline",
      ]);
      assert.deepEqual(Object.keys(filteredAgyCfg.mcpServers.fast.tools), [
        "batch_search",
        "quick_outline",
      ]);

      // 5. Invalid --host, trailing comma in --tools, or cross-command flags fail fast
      assert.throws(
        () =>
          execFileSync(process.execPath, [INSTALL_SCRIPT, "mcp-config", "--host", "codex"], {
            env,
            encoding: "utf8",
          }),
        /Invalid value after --host/,
      );
      assert.throws(
        () =>
          execFileSync(process.execPath, [INSTALL_SCRIPT, "mcp-config", "--tools", "batch_search,"], {
            env,
            encoding: "utf8",
          }),
        /empty tool entry/i,
      );
      assert.throws(
        () =>
          execFileSync(process.execPath, [INSTALL_SCRIPT, "install", "--tools", "batch_search"], {
            env,
            encoding: "utf8",
          }),
        /only supported with the 'mcp-config' command/,
      );
    } finally {
      await fs.rm(cfgHome, { recursive: true, force: true });
    }
  });
});
