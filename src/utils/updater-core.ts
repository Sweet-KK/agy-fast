import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execBinaryAsync, withNonInteractiveGitEnv } from "./exec-utils.js";

export const DEFAULT_REPO_URL = "https://github.com/INK-Q/agy-fast.git";
export const DEFAULT_GITHUB_SLUG = "INK-Q/agy-fast";
export const DEFAULT_CHECK_INTERVAL_HOURS = 4;
export const LOCK_STALE_MS = 10 * 60 * 1000;

export const UPDATER_RUNTIME_FILES = [
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
  "LICENSE",
] as const;

export const UPDATER_OPTIONAL_FILES = [
  "assets/logo-light.svg",
  "assets/logo-dark.svg",
  "assets/architecture-light.svg",
  "assets/architecture-dark.svg",
  "assets/architecture-zh-light.svg",
  "assets/architecture-zh-dark.svg",
  "README.md",
  "README.zh-CN.md",
  "README.zh-TW.md",
  "CHANGELOG.md",
  "docs/ANALYSIS_REPORT.md",
  "docs/ANALYSIS_REPORT.zh-CN.md",
] as const;

export type AutoUpdateMode = "auto" | "notify" | "off";
export type UpdateChannel = "release" | "main";
export type ToolLoadingMode = "eager" | "lazy";
export type InstallKind = "copied" | "git-clone" | "git-dirty" | "symlink" | "dev-source";

export const EAGER_MCP_TOOLS = [
  "batch_search",
  "apply_edits",
  "read_slices",
  "quick_outline",
  "run_checks",
] as const;

export interface UpdaterConfig {
  autoUpdate?: AutoUpdateMode;
  checkIntervalHours?: number;
  channel?: UpdateChannel;
  repoUrl?: string;
  editsFormat?: "auto" | "array" | "string";
  toolLoading?: ToolLoadingMode;
}

export interface ResolvedUpdaterSettings {
  mode: AutoUpdateMode;
  checkIntervalHours: number;
  checkIntervalMs: number;
  channel: UpdateChannel;
  repoUrl: string;
  toolLoading: ToolLoadingMode;
}

export interface UpdateState {
  lastCheckAt?: string;
  lastCheckAttemptAt?: string;
  latestVersion?: string;
  latestRef?: string;
  availableVersion?: string;
  availableRef?: string;
  availableCommit?: string;
  availableReleaseUrl?: string;
  availableInstallKind?: InstallKind;
  availableReason?: string;
  skippedVersion?: string;
  lastAppliedVersion?: string;
  lastAppliedFrom?: string;
  lastAppliedAt?: string;
  lastAppliedCommit?: string;
  notifiedAppliedVersion?: string;
  notifiedAvailableVersion?: string;
  notifiedAvailableCommit?: string;
  lastError?: string;
}

export interface UpdaterPaths {
  cacheDir: string;
  stateFile: string;
  configFile: string;
  lockFile: string;
}

export interface RemoteVersionInfo {
  ref: string;
  version: string | null;
  commitSha?: string;
  releaseUrl?: string;
  publishedAt?: string;
  source: "git-tags" | "git-main" | "github-api";
}

export interface UpdateRunOptions {
  pluginDir: string;
  checkOnly?: boolean;
  force?: boolean;
  background?: boolean;
  channel?: UpdateChannel;
  repoUrl?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export interface UpdateRunResult {
  status:
    | "up-to-date"
    | "available"
    | "updated"
    | "skipped-disabled"
    | "skipped-locked"
    | "error";
  currentVersion: string;
  latestVersion: string | null;
  latestRef?: string;
  commitSha?: string;
  releaseUrl?: string;
  publishedAt?: string;
  installKind: InstallKind;
  message: string;
  error?: string;
}

export function getHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const userProfile = env.USERPROFILE?.trim();
    if (userProfile) return userProfile;
    const driveHome =
      env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}`.trim() : "";
    if (driveHome) return driveHome;
    const home = env.HOME?.trim();
    if (home) return home;
    return os.homedir();
  }
  return env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
}

export function getUpdaterPaths(env: NodeJS.ProcessEnv = process.env): UpdaterPaths {
  const custom = env.AGY_FAST_CACHE_DIR?.trim();
  const cacheDir = custom
    ? path.resolve(custom)
    : path.join(getHomeDir(env), ".gemini", "cache", "agy-fast");
  return {
    cacheDir,
    stateFile: path.join(cacheDir, "update-state.json"),
    configFile: path.join(cacheDir, "config.json"),
    lockFile: path.join(cacheDir, "update.lock"),
  };
}

export function parseSemver(raw: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) return null;
  return [
    Number.parseInt(m[1]!, 10),
    Number.parseInt(m[2]!, 10),
    Number.parseInt(m[3]!, 10),
  ];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]! ? 1 : -1;
  }
  return 0;
}

export function pickLatestSemverTag(
  lsRemoteOutput: string,
): { tag: string; version: string; commitSha: string } | null {
  let best: { tag: string; version: string; commitSha: string } | null = null;
  for (const rawLine of lsRemoteOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const sha = parts[0]!;
    const ref = parts[1]!;
    if (!ref.startsWith("refs/tags/") || ref.endsWith("^{}")) continue;
    const tag = ref.slice("refs/tags/".length);
    const parsed = parseSemver(tag);
    if (!parsed) continue;
    const version = `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
    if (!best || compareSemver(version, best.version) > 0) {
      best = { tag, version, commitSha: sha };
    }
  }
  return best;
}

export function parseAutoUpdateMode(raw: string | undefined): AutoUpdateMode | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  if (norm === "auto" || norm === "on" || norm === "1" || norm === "true") {
    return "auto";
  }
  if (norm === "notify" || norm === "check") {
    return "notify";
  }
  if (norm === "off" || norm === "0" || norm === "false" || norm === "disabled") {
    return "off";
  }
  return null;
}

export function parseUpdateChannel(raw: string | undefined): UpdateChannel | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  if (norm === "release" || norm === "stable") return "release";
  if (norm === "main" || norm === "nightly" || norm === "edge") return "main";
  return null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // Missing or corrupt file: treat as empty
  }
  return null;
}

let tmpWriteSeq = 0;

async function writeJsonAtomically(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${++tmpWriteSeq}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    try {
      // Windows fallback when destination is briefly locked
      await fs.copyFile(tmpPath, filePath);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }
}

export async function readUpdaterConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpdaterConfig> {
  const paths = getUpdaterPaths(env);
  return (await readJsonFile<UpdaterConfig>(paths.configFile)) ?? {};
}

export async function writeUpdaterConfig(
  patch: UpdaterConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpdaterConfig> {
  const paths = getUpdaterPaths(env);
  const existing = (await readJsonFile<UpdaterConfig>(paths.configFile)) ?? {};
  const merged: UpdaterConfig = { ...existing, ...patch };
  await writeJsonAtomically(paths.configFile, merged);
  return merged;
}

export async function readUpdateState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpdateState> {
  const paths = getUpdaterPaths(env);
  return (await readJsonFile<UpdateState>(paths.stateFile)) ?? {};
}

export async function writeUpdateState(
  patch: Partial<UpdateState>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpdateState> {
  const paths = getUpdaterPaths(env);
  const existing = (await readJsonFile<UpdateState>(paths.stateFile)) ?? {};
  const merged: UpdateState = { ...existing, ...patch };
  await writeJsonAtomically(paths.stateFile, merged);
  return merged;
}

export async function skipUpdateVersion(
  rawVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ version: string; state: UpdateState }> {
  const parsed = parseSemver(rawVersion);
  if (!parsed) {
    throw new Error(
      `Invalid version '${rawVersion}'. Expected semver like 0.3.1 or v0.3.1.`,
    );
  }
  const version = `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
  const state = await writeUpdateState(
    {
      skippedVersion: version,
      notifiedAvailableVersion: version,
    },
    env,
  );
  return { version, state };
}

export async function clearSkippedVersion(
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpdateState> {
  return writeUpdateState(
    {
      skippedVersion: undefined,
      notifiedAvailableVersion: undefined,
    },
    env,
  );
}

export function parseToolLoadingMode(raw: unknown): ToolLoadingMode | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "eager" || v === "lazy") return v;
  return null;
}

export async function applyToolLoadingToMcpConfig(
  pluginDir: string,
  mode: ToolLoadingMode,
): Promise<boolean> {
  const mcpPath = path.join(pluginDir, "mcp_config.json");
  const cfg = await readJsonFile<Record<string, unknown>>(mcpPath);
  if (!cfg) return false;
  const servers = cfg.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return false;
  }
  const fast = (servers as Record<string, unknown>).fast;
  if (!fast || typeof fast !== "object" || Array.isArray(fast)) {
    return false;
  }
  const fastObj = fast as Record<string, unknown>;
  if (mode === "lazy") {
    delete fastObj.tools;
  } else {
    const toolsMap: Record<string, { eager: boolean }> = {};
    for (const tool of EAGER_MCP_TOOLS) {
      toolsMap[tool] = { eager: true };
    }
    fastObj.tools = toolsMap;
  }
  await writeJsonAtomically(mcpPath, cfg);
  return true;
}

export async function resolveUpdaterSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedUpdaterSettings> {
  const cfg = await readUpdaterConfig(env);
  const envMode = parseAutoUpdateMode(env.AGY_FAST_AUTO_UPDATE);
  const cfgMode = parseAutoUpdateMode(cfg.autoUpdate);
  const mode: AutoUpdateMode = envMode ?? cfgMode ?? "off";

  const envHours = Number.parseFloat(env.AGY_FAST_UPDATE_INTERVAL_HOURS ?? "");
  const rawHours =
    Number.isFinite(envHours) && envHours >= 0.01
      ? envHours
      : typeof cfg.checkIntervalHours === "number" && cfg.checkIntervalHours >= 0.01
        ? cfg.checkIntervalHours
        : DEFAULT_CHECK_INTERVAL_HOURS;
  const checkIntervalHours = Math.max(0.01, Math.min(24 * 30, rawHours));

  const envChan = parseUpdateChannel(env.AGY_FAST_UPDATE_CHANNEL);
  const cfgChan = parseUpdateChannel(cfg.channel);
  const channel: UpdateChannel = envChan ?? cfgChan ?? "release";

  const envToolLoading = parseToolLoadingMode(env.AGY_FAST_TOOL_LOADING);
  const cfgToolLoading = parseToolLoadingMode(cfg.toolLoading);
  const toolLoading: ToolLoadingMode = envToolLoading ?? cfgToolLoading ?? "eager";

  const repoUrl =
    env.AGY_FAST_REPO?.trim() || cfg.repoUrl?.trim() || DEFAULT_REPO_URL;

  return {
    mode,
    checkIntervalHours,
    checkIntervalMs: Math.round(checkIntervalHours * 3600 * 1000),
    channel,
    repoUrl,
    toolLoading,
  };
}

export async function readInstalledVersion(pluginDir: string): Promise<string> {
  const manifest = await readJsonFile<{ version?: unknown }>(
    path.join(pluginDir, "plugin.json"),
  );
  if (manifest && typeof manifest.version === "string" && manifest.version.trim()) {
    return manifest.version.trim();
  }
  return "0.0.0";
}

export function shouldTriggerBackgroundCheck(
  state: UpdateState,
  nowMs: number,
  intervalMs: number,
): boolean {
  const lastCompleted = state.lastCheckAt ? Date.parse(state.lastCheckAt) : NaN;
  const lastAttempt = state.lastCheckAttemptAt
    ? Date.parse(state.lastCheckAttemptAt)
    : NaN;
  if (Number.isFinite(lastCompleted) && nowMs - lastCompleted < intervalMs) {
    return false;
  }
  // Prevent burst spawns when parallel subagents start in the same minute
  if (Number.isFinite(lastAttempt) && nowMs - lastAttempt < Math.min(intervalMs, 5 * 60 * 1000)) {
    return false;
  }
  return true;
}

export async function consumeSnapshotUpdateNotice(
  pluginDir: string,
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const state = await readUpdateState(env);

  // 1. Just auto-updated to currentVersion -> announce once
  if (
    state.lastAppliedVersion &&
    state.lastAppliedVersion === currentVersion &&
    state.lastAppliedFrom &&
    state.lastAppliedFrom !== currentVersion &&
    state.notifiedAppliedVersion !== currentVersion
  ) {
    await writeUpdateState({ notifiedAppliedVersion: currentVersion }, env).catch(
      () => {},
    );
    return `[agy-fast] Auto-updated v${state.lastAppliedFrom} -> v${currentVersion} (rules/hooks active now; reload Desktop/IDE window if MCP was already running).`;
  }

  const installerPath = path.join(pluginDir, "scripts", "install.mjs");
  const isManualInstall =
    state.availableInstallKind === "symlink" ||
    state.availableInstallKind === "dev-source" ||
    state.availableInstallKind === "git-dirty";

  // 2. Semver update available -> announce once per version (unless skipped by user)
  if (
    state.availableVersion &&
    compareSemver(state.availableVersion, currentVersion) > 0
  ) {
    if (
      state.skippedVersion === state.availableVersion ||
      state.notifiedAvailableVersion === state.availableVersion
    ) {
      return null;
    }
    await writeUpdateState(
      { notifiedAvailableVersion: state.availableVersion },
      env,
    ).catch(() => {});
    const ver = state.availableVersion;
    const reason = state.availableReason ? ` (${state.availableReason})` : "";
    const urlSuffix = state.availableReleaseUrl ? ` | ${state.availableReleaseUrl}` : "";
    if (isManualInstall) {
      return `[agy-fast] Update available: v${currentVersion} -> v${ver}${reason}. Pull & build in repo, or skip: node "${installerPath}" update --skip-version ${ver}${urlSuffix}`;
    }
    return `[agy-fast] Update available: v${currentVersion} -> v${ver}${reason}. Run: node "${installerPath}" update --prompt (or --skip-version ${ver})${urlSuffix}`;
  }

  // 3. Main-channel commit update available -> announce once per commit
  if (
    !state.availableVersion &&
    state.availableCommit &&
    state.availableCommit !== state.lastAppliedCommit &&
    state.notifiedAvailableCommit !== state.availableCommit
  ) {
    await writeUpdateState(
      { notifiedAvailableCommit: state.availableCommit },
      env,
    ).catch(() => {});
    const refLabel = state.availableRef || "main";
    const shortSha = state.availableCommit.slice(0, 7);
    const reason = state.availableReason ? ` (${state.availableReason})` : "";
    const urlSuffix = state.availableReleaseUrl ? ` | ${state.availableReleaseUrl}` : "";
    if (isManualInstall) {
      return `[agy-fast] Update available on ${refLabel} (${shortSha})${reason}. Pull & build in repo.${urlSuffix}`;
    }
    return `[agy-fast] Update available on ${refLabel} (${shortSha})${reason}. Run: node "${installerPath}" update --prompt${urlSuffix}`;
  }

  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectInstallKind(pluginDir: string): Promise<InstallKind> {
  const resolved = path.resolve(pluginDir);
  try {
    const lst = await fs.lstat(resolved);
    if (lst.isSymbolicLink()) return "symlink";
  } catch {
    return "copied";
  }

  const norm = resolved.split(path.sep).join("/").toLowerCase();
  const isPluginInstallDir =
    norm.endsWith("/plugins/agy-fast") || norm.includes("/plugins/agy-fast/");

  const hasGit = await pathExists(path.join(resolved, ".git"));
  if (hasGit) {
    const statusRes = await execBinaryAsync("git", ["status", "--porcelain"], {
      cwd: resolved,
      timeoutMs: 4_000,
      env: withNonInteractiveGitEnv(),
    });
    if (statusRes.error || statusRes.exitCode !== 0 || statusRes.stdout.trim() !== "") {
      return "git-dirty";
    }
    // Only auto-update git clones inside a plugins/agy-fast directory unless forced manually;
    // a standalone source repo outside plugins/ is treated as a developer workspace.
    if (!isPluginInstallDir) {
      return "dev-source";
    }
    return "git-clone";
  }

  if (!isPluginInstallDir && (await pathExists(path.join(resolved, "src")))) {
    return "dev-source";
  }
  return "copied";
}

export function extractGithubSlug(repoUrl: string): string | null {
  const m =
    /^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      repoUrl.trim(),
    );
  if (!m?.[1] || m[1].includes("..")) return null;
  return m[1];
}

export function buildGithubReleaseUrl(
  repoUrl: string,
  ref?: string,
  commitSha?: string,
): string | undefined {
  const slug = extractGithubSlug(repoUrl);
  if (!slug) return undefined;
  const trimmedRef = ref?.trim();
  if (trimmedRef && parseSemver(trimmedRef)) {
    return `https://github.com/${slug}/releases/tag/${encodeURIComponent(trimmedRef)}`;
  }
  if (commitSha?.trim()) {
    return `https://github.com/${slug}/commit/${encodeURIComponent(commitSha.trim())}`;
  }
  if (trimmedRef) {
    return `https://github.com/${slug}/tree/${encodeURIComponent(trimmedRef)}`;
  }
  return `https://github.com/${slug}/releases`;
}

function sanitizeGithubHtmlUrl(raw: unknown, fallback?: string): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^https:\/\/github\.com\//i.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

export function validateRepoUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("-") || /[\0\r\n]/.test(trimmed)) {
    throw new Error(`Invalid update repository URL: ${rawUrl}`);
  }
  return trimmed;
}

export async function fetchLatestRemoteVersion(opts: {
  repoUrl: string;
  channel: UpdateChannel;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}): Promise<RemoteVersionInfo> {
  const safeRepoUrl = validateRepoUrl(opts.repoUrl);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const gitEnv = withNonInteractiveGitEnv(opts.env);
  const doFetch = opts.fetchFn ?? (typeof fetch === "function" ? fetch : undefined);
  const slug = extractGithubSlug(safeRepoUrl);
  const ghHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agy-fast-updater",
  };
  let gitUnavailableOrFailed = false;

  if (opts.channel === "release") {
    let confirmedUntagged = false;
    const tagsRes = await execBinaryAsync(
      "git",
      ["ls-remote", "--tags", "--refs", "--", safeRepoUrl],
      { cwd: os.tmpdir(), timeoutMs, env: gitEnv },
    );
    if (!tagsRes.error && !tagsRes.timedOut && tagsRes.exitCode === 0) {
      const latest = pickLatestSemverTag(tagsRes.stdout);
      if (latest) {
        return {
          ref: latest.tag,
          version: latest.version,
          commitSha: latest.commitSha,
          releaseUrl: buildGithubReleaseUrl(safeRepoUrl, latest.tag, latest.commitSha),
          source: "git-tags",
        };
      }
      // Clean exit 0 with zero semver tags confirms the repo is untagged — skip redundant API calls
      confirmedUntagged = true;
    } else {
      gitUnavailableOrFailed = true;
      // Fallback to GitHub Releases / Tags API only when git ls-remote could not run/succeed.
      // Fail immediately on network/timeout/non-404 errors so release users are never downgraded to main.
      if (!slug || !doFetch) {
        throw new Error(
          tagsRes.stderr.trim() ||
            tagsRes.error ||
            (tagsRes.timedOut
              ? `Timed out checking releases from: ${safeRepoUrl}`
              : `Unable to reach update source: ${safeRepoUrl}`),
        );
      }

      const relRes = await doFetch(
        `https://api.github.com/repos/${slug}/releases/latest`,
        {
          headers: ghHeaders,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      let checkTagsApi = false;
      if (relRes.ok) {
        const json = (await relRes.json()) as {
          tag_name?: unknown;
          html_url?: unknown;
          published_at?: unknown;
        };
        if (typeof json.tag_name === "string") {
          const parsed = parseSemver(json.tag_name);
          if (parsed) {
            const tag = json.tag_name.trim();
            return {
              ref: tag,
              version: `${parsed[0]}.${parsed[1]}.${parsed[2]}`,
              releaseUrl: sanitizeGithubHtmlUrl(
                json.html_url,
                buildGithubReleaseUrl(safeRepoUrl, tag),
              ),
              publishedAt:
                typeof json.published_at === "string" ? json.published_at : undefined,
              source: "github-api",
            };
          }
        }
        checkTagsApi = true;
      } else if (relRes.status === 404) {
        checkTagsApi = true;
      } else {
        throw new Error(
          `GitHub releases API returned HTTP ${relRes.status} for ${slug}`,
        );
      }

      if (checkTagsApi) {
        const tagsApiRes = await doFetch(
          `https://api.github.com/repos/${slug}/tags?per_page=30`,
          {
            headers: ghHeaders,
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        if (!tagsApiRes.ok) {
          throw new Error(
            `GitHub tags API returned HTTP ${tagsApiRes.status} for ${slug}`,
          );
        }
        const rawTags = (await tagsApiRes.json()) as unknown;
        if (!Array.isArray(rawTags)) {
          throw new Error(`Invalid GitHub tags API response for ${slug}`);
        }
        let best: { tag: string; version: string; commitSha?: string } | null = null;
        for (const item of rawTags) {
          if (!item || typeof item !== "object") continue;
          const rec = item as { name?: unknown; commit?: { sha?: unknown } };
          if (typeof rec.name !== "string") continue;
          const parsed = parseSemver(rec.name);
          if (!parsed) continue;
          const version = `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
          if (!best || compareSemver(version, best.version) > 0) {
            best = {
              tag: rec.name.trim(),
              version,
              commitSha:
                typeof rec.commit?.sha === "string" ? rec.commit.sha : undefined,
            };
          }
        }
        if (best) {
          return {
            ref: best.tag,
            version: best.version,
            commitSha: best.commitSha,
            releaseUrl: buildGithubReleaseUrl(safeRepoUrl, best.tag, best.commitSha),
            source: "github-api",
          };
        }
        confirmedUntagged = true;
      }
    }

    if (!confirmedUntagged) {
      throw new Error(`Unable to determine release version from: ${safeRepoUrl}`);
    }
  }

  // Main channel (or definitively confirmed untagged repository)
  let headErr = "";
  if (!gitUnavailableOrFailed) {
    const headRes = await execBinaryAsync(
      "git",
      ["ls-remote", "--", safeRepoUrl, "refs/heads/main", "HEAD"],
      { cwd: os.tmpdir(), timeoutMs, env: gitEnv },
    );
    if (!headRes.error && !headRes.timedOut && headRes.exitCode === 0) {
      const entries = headRes.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && Boolean(parts[0]));
      const mainEntry = entries.find((parts) => parts[1] === "refs/heads/main");
      const chosen = mainEntry ?? entries[0];
      if (chosen?.[0]) {
        const ref = mainEntry ? "main" : "HEAD";
        return {
          ref,
          version: null,
          commitSha: chosen[0],
          releaseUrl: buildGithubReleaseUrl(safeRepoUrl, ref, chosen[0]),
          source: "git-main",
        };
      }
    }
    headErr =
      headRes.stderr.trim() ||
      headRes.error ||
      (headRes.timedOut
        ? `Timed out checking main branch from: ${safeRepoUrl}`
        : "");
  }

  if (slug && doFetch) {
    const commitRes = await doFetch(
      `https://api.github.com/repos/${slug}/commits/main`,
      {
        headers: ghHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!commitRes.ok) {
      throw new Error(
        `GitHub commits API returned HTTP ${commitRes.status} for ${slug}`,
      );
    }
    const json = (await commitRes.json()) as {
      sha?: unknown;
      html_url?: unknown;
      commit?: { committer?: { date?: unknown }; author?: { date?: unknown } };
    };
    if (typeof json.sha === "string" && json.sha.trim()) {
      const sha = json.sha.trim();
      const publishedAt =
        typeof json.commit?.committer?.date === "string"
          ? json.commit.committer.date
          : typeof json.commit?.author?.date === "string"
            ? json.commit.author.date
            : undefined;
      return {
        ref: "main",
        version: null,
        commitSha: sha,
        releaseUrl: sanitizeGithubHtmlUrl(
          json.html_url,
          buildGithubReleaseUrl(safeRepoUrl, "main", sha),
        ),
        publishedAt,
        source: "github-api",
      };
    }
  }

  throw new Error(headErr || `Unable to reach update source: ${safeRepoUrl}`);
}

export async function verifyStagedPlugin(stagingDir: string): Promise<{
  ok: boolean;
  version: string;
  reason?: string;
}> {
  for (const rel of UPDATER_RUNTIME_FILES) {
    if (!(await pathExists(path.join(stagingDir, rel)))) {
      return { ok: false, version: "0.0.0", reason: `Missing required file: ${rel}` };
    }
  }

  const manifest = await readJsonFile<{ name?: unknown; version?: unknown }>(
    path.join(stagingDir, "plugin.json"),
  );
  if (
    !manifest ||
    manifest.name !== "agy-fast" ||
    typeof manifest.version !== "string" ||
    !parseSemver(manifest.version)
  ) {
    return { ok: false, version: "0.0.0", reason: "Invalid staged plugin.json manifest" };
  }

  // Live MCP handshake smoke test on staged bundle before replacing live files
  const mcpPath = path.join(stagingDir, "dist", "mcp-server.mjs");
  const cleanMcpEnv = { ...process.env };
  delete cleanMcpEnv.AGY_FAST_TOOLS;
  const smokeOk = await new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, [mcpPath], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      env: cleanMcpEnv,
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 6_000);
    timer.unref();

    child.stdin.on("error", () => {
      // Ignore EPIPE if a broken staged bundle exits before reading stdin
    });
    child.stdout.on("data", (d: Buffer | string) => {
      stdout += d.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(false);
        return;
      }
      try {
        const lines = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { id?: number; result?: { tools?: Array<{ name?: string }> } });
        const listResp = lines.find((m) => m.id === 2);
        const tools = listResp?.result?.tools?.map((t) => t.name) ?? [];
        resolve(tools.length >= 4);
      } catch {
        resolve(false);
      }
    });

    const initMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "updater", version: "1" } },
    });
    const listMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    child.stdin.write(`${initMsg}\n${listMsg}\n`);
    child.stdin.end();
  });

  if (!smokeOk) {
    return {
      ok: false,
      version: manifest.version,
      reason: "Staged MCP server smoke check failed",
    };
  }

  return { ok: true, version: manifest.version };
}

export async function syncRuntimeFilesAtomically(
  srcRoot: string,
  dstRoot: string,
): Promise<void> {
  await fs.mkdir(dstRoot, { recursive: true });
  // Sync plugin.json LAST so a partial failure never advances the installed version marker
  // while dist/*.mjs remain on the previous version.
  const runtimeWithoutManifest = UPDATER_RUNTIME_FILES.filter((rel) => rel !== "plugin.json");
  const toCopy: string[] = [...runtimeWithoutManifest];
  for (const opt of UPDATER_OPTIONAL_FILES) {
    if (await pathExists(path.join(srcRoot, opt))) {
      toCopy.push(opt);
    }
  }
  toCopy.push("plugin.json");

  let seq = 0;
  for (const rel of toCopy) {
    const src = path.join(srcRoot, rel);
    const dst = path.join(dstRoot, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.agy-tmp.${process.pid}.${seq++}`;
    try {
      await fs.copyFile(src, tmp);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    try {
      await fs.rename(tmp, dst);
    } catch {
      try {
        // Fallback on Windows if target file is briefly open
        await fs.copyFile(tmp, dst);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    }
  }
}

function isProcessDead(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ESRCH";
  }
}

async function acquireUpdateLock(lockPath: string): Promise<string | null> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${++tmpWriteSeq}-${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }),
          "utf8",
        );
      } finally {
        await handle.close();
      }
      return token;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") return null;
      try {
        const st = await fs.stat(lockPath);
        let stale = Date.now() - st.mtimeMs > LOCK_STALE_MS;
        if (!stale) {
          const info = await readJsonFile<{ pid?: unknown }>(lockPath);
          if (
            typeof info?.pid === "number" &&
            info.pid !== process.pid &&
            isProcessDead(info.pid)
          ) {
            stale = true;
          }
        }
        if (stale) {
          // Atomically claim the stale lock via rename so concurrent reclaimers
          // never unlink a live lock freshly acquired by another process.
          const claimedPath = `${lockPath}.stale.${process.pid}.${++tmpWriteSeq}`;
          try {
            await fs.rename(lockPath, claimedPath);
            await fs.rm(claimedPath, { force: true }).catch(() => {});
          } catch {
            // Another process already reclaimed or removed it; retry open("wx")
          }
          continue;
        }
      } catch {
        continue;
      }
      return null;
    }
  }
  return null;
}

async function releaseUpdateLock(lockPath: string, token: string): Promise<void> {
  try {
    const info = await readJsonFile<{ token?: unknown }>(lockPath);
    if (info?.token === token) {
      await fs.rm(lockPath, { force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

export async function runPluginUpdate(
  opts: UpdateRunOptions,
): Promise<UpdateRunResult> {
  const env = opts.env ?? process.env;
  const pluginDir = path.resolve(opts.pluginDir);
  const paths = getUpdaterPaths(env);
  const settings = await resolveUpdaterSettings(env);
  const repoUrl = opts.repoUrl?.trim() || settings.repoUrl;
  const channel = opts.channel ?? settings.channel;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const currentVersion = await readInstalledVersion(pluginDir);
  const installKind = await detectInstallKind(pluginDir);

  if (opts.background && settings.mode === "off") {
    return {
      status: "skipped-disabled",
      currentVersion,
      latestVersion: null,
      installKind,
      message: "Auto-update is disabled.",
    };
  }

  const lockToken = await acquireUpdateLock(paths.lockFile);
  if (!lockToken) {
    return {
      status: "skipped-locked",
      currentVersion,
      latestVersion: null,
      installKind,
      message: "Another update check is already in progress.",
    };
  }

  const nowIso = new Date().toISOString();
  let stagingDir = "";

  try {
    const remote = await fetchLatestRemoteVersion({
      repoUrl,
      channel,
      timeoutMs,
      env,
      fetchFn: opts.fetchFn,
    });
    const prevState = await readUpdateState(env);

    const hasNewerSemver =
      remote.version !== null && compareSemver(remote.version, currentVersion) > 0;
    const hasNewerMainCommit =
      remote.version === null &&
      Boolean(remote.commitSha) &&
      remote.commitSha !== prevState.lastAppliedCommit;

    if (!opts.force && !hasNewerSemver && !hasNewerMainCommit) {
      const clearStaleSkip =
        Boolean(prevState.skippedVersion) &&
        compareSemver(prevState.skippedVersion!, currentVersion) <= 0;
      await writeUpdateState(
        {
          lastCheckAt: nowIso,
          latestVersion: remote.version ?? currentVersion,
          latestRef: remote.ref,
          availableVersion: undefined,
          availableRef: undefined,
          availableCommit: undefined,
          availableReleaseUrl: undefined,
          availableInstallKind: undefined,
          availableReason: undefined,
          ...(clearStaleSkip ? { skippedVersion: undefined } : {}),
          lastError: undefined,
        },
        env,
      );
      return {
        status: "up-to-date",
        currentVersion,
        latestVersion: remote.version ?? currentVersion,
        latestRef: remote.ref,
        commitSha: remote.commitSha,
        releaseUrl: remote.releaseUrl,
        publishedAt: remote.publishedAt,
        installKind,
        message: `agy-fast v${currentVersion} is already up to date.`,
      };
    }

    const isSkippedInBackground = Boolean(
      opts.background &&
        !opts.force &&
        remote.version &&
        prevState.skippedVersion === remote.version,
    );

    const effectiveNotifyOnly =
      opts.checkOnly ||
      isSkippedInBackground ||
      (opts.background && settings.mode === "notify") ||
      installKind === "symlink" ||
      installKind === "git-dirty" ||
      installKind === "dev-source";

    if (effectiveNotifyOnly) {
      const reason =
        installKind === "symlink"
          ? "linked dev install"
          : installKind === "git-dirty"
            ? "uncommitted local changes"
            : installKind === "dev-source"
              ? "local source repo"
              : isSkippedInBackground
                ? "skipped by user"
                : settings.mode === "notify"
                  ? "notify mode"
                  : undefined;

      const shouldClearSkip =
        Boolean(prevState.skippedVersion) &&
        ((remote.version !== null &&
          compareSemver(remote.version, prevState.skippedVersion!) > 0) ||
          compareSemver(prevState.skippedVersion!, currentVersion) <= 0);

      await writeUpdateState(
        {
          lastCheckAt: nowIso,
          latestVersion: remote.version ?? undefined,
          latestRef: remote.ref,
          availableVersion: remote.version ?? undefined,
          availableRef: remote.ref,
          availableCommit: remote.commitSha,
          availableReleaseUrl: remote.releaseUrl,
          availableInstallKind: installKind,
          availableReason: reason,
          ...(shouldClearSkip ? { skippedVersion: undefined } : {}),
          lastError: undefined,
        },
        env,
      );

      return {
        status: "available",
        currentVersion,
        latestVersion: remote.version,
        latestRef: remote.ref,
        commitSha: remote.commitSha,
        releaseUrl: remote.releaseUrl,
        publishedAt: remote.publishedAt,
        installKind,
        message: remote.version
          ? `Update available: v${currentVersion} -> v${remote.version}${reason ? ` (${reason})` : ""}.`
          : `Update available on branch '${remote.ref}'${reason ? ` (${reason})` : ""}.`,
      };
    }

    // Apply update: stage into temp dir and validate before touching live plugin files
    stagingDir = path.join(
      paths.cacheDir,
      `staging-${process.pid}-${Date.now()}`,
    );
    await fs.mkdir(paths.cacheDir, { recursive: true });
    const gitEnv = withNonInteractiveGitEnv(env);

    const safeRepoUrl = validateRepoUrl(repoUrl);
    const cloneArgs =
      remote.ref === "HEAD"
        ? ["clone", "--depth", "1", "--", safeRepoUrl, stagingDir]
        : ["clone", "--depth", "1", "--branch", remote.ref, "--", safeRepoUrl, stagingDir];
    const cloneRes = await execBinaryAsync("git", cloneArgs, {
      cwd: paths.cacheDir,
      timeoutMs: Math.max(timeoutMs, 30_000),
      env: gitEnv,
    });
    if (cloneRes.error || cloneRes.timedOut || cloneRes.exitCode !== 0) {
      throw new Error(
        cloneRes.stderr.trim() ||
          cloneRes.error ||
          `git clone failed for ${remote.ref}`,
      );
    }

    const stagedCheck = await verifyStagedPlugin(stagingDir);
    if (!stagedCheck.ok) {
      throw new Error(stagedCheck.reason || "Staged plugin validation failed");
    }

    if (
      !opts.force &&
      remote.version === null &&
      (compareSemver(stagedCheck.version, currentVersion) < 0 ||
        (compareSemver(stagedCheck.version, currentVersion) === 0 &&
          !prevState.lastAppliedCommit))
    ) {
      await writeUpdateState(
        {
          lastCheckAt: nowIso,
          latestVersion: stagedCheck.version,
          latestRef: remote.ref,
          availableVersion: undefined,
          availableRef: undefined,
          availableCommit: undefined,
          availableReleaseUrl: undefined,
          availableInstallKind: undefined,
          availableReason: undefined,
          lastAppliedCommit: remote.commitSha,
          lastError: undefined,
        },
        env,
      );
      return {
        status: "up-to-date",
        currentVersion,
        latestVersion: stagedCheck.version,
        latestRef: remote.ref,
        commitSha: remote.commitSha,
        releaseUrl: remote.releaseUrl,
        publishedAt: remote.publishedAt,
        installKind,
        message: `agy-fast v${currentVersion} is already up to date.`,
      };
    }

    if (installKind === "git-clone") {
      // Fetch directly from the already smoke-tested local stagingDir so we honor
      // --repo/AGY_FAST_REPO overrides and avoid TOCTOU mismatch with a second network fetch.
      const fetchRes = await execBinaryAsync(
        "git",
        ["fetch", "--depth", "1", stagingDir, "HEAD"],
        { cwd: pluginDir, timeoutMs: Math.max(timeoutMs, 20_000), env: gitEnv },
      );
      if (fetchRes.error || fetchRes.timedOut || fetchRes.exitCode !== 0) {
        throw new Error(
          fetchRes.stderr.trim() ||
            fetchRes.error ||
            (fetchRes.timedOut ? "git fetch timed out in plugin clone" : "git fetch failed in plugin clone"),
        );
      }
      const checkoutRes = await execBinaryAsync(
        "git",
        ["checkout", "-q", "FETCH_HEAD"],
        { cwd: pluginDir, timeoutMs: 10_000, env: gitEnv },
      );
      if (checkoutRes.error || checkoutRes.timedOut || checkoutRes.exitCode !== 0) {
        throw new Error(
          checkoutRes.stderr.trim() ||
            checkoutRes.error ||
            (checkoutRes.timedOut ? "git checkout timed out in plugin clone" : "git checkout failed in plugin clone"),
        );
      }
    } else {
      await applyToolLoadingToMcpConfig(stagingDir, settings.toolLoading);
      await syncRuntimeFilesAtomically(stagingDir, pluginDir);
    }

    await writeUpdateState(
      {
        lastCheckAt: nowIso,
        latestVersion: stagedCheck.version,
        latestRef: remote.ref,
        availableVersion: undefined,
        availableRef: undefined,
        availableCommit: undefined,
        availableReleaseUrl: undefined,
        availableInstallKind: undefined,
        availableReason: undefined,
        skippedVersion: undefined,
        lastAppliedVersion: stagedCheck.version,
        lastAppliedFrom: currentVersion,
        lastAppliedAt: nowIso,
        lastAppliedCommit: remote.commitSha,
        notifiedAppliedVersion: opts.background ? undefined : stagedCheck.version,
        lastError: undefined,
      },
      env,
    );

    return {
      status: "updated",
      currentVersion,
      latestVersion: stagedCheck.version,
      latestRef: remote.ref,
      commitSha: remote.commitSha,
      releaseUrl: remote.releaseUrl,
      publishedAt: remote.publishedAt,
      installKind,
      message: `Updated agy-fast v${currentVersion} -> v${stagedCheck.version} (${installKind}).`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await writeUpdateState(
      {
        lastCheckAt: nowIso,
        lastError: errMsg.slice(0, 300),
      },
      env,
    ).catch(() => {});
    return {
      status: "error",
      currentVersion,
      latestVersion: null,
      installKind,
      message: `Update check failed: ${errMsg}`,
      error: errMsg,
    };
  } finally {
    if (stagingDir) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    await releaseUpdateLock(paths.lockFile, lockToken);
  }
}

export function spawnBackgroundUpdateCheck(
  pluginDir: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const updaterPath = path.join(pluginDir, "dist", "updater.mjs");
  try {
    const child = spawn(
      process.execPath,
      [updaterPath, "--background", "--plugin-dir", pluginDir],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env,
      },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}
