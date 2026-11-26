<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-light.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-dark.svg" />
  <img src="assets/logo.svg" alt="agy-fast logo" width="80" />
</picture>

# agy-fast

**面向 Google Antigravity 的合規延遲、Token 額度與工具呼叫加速外掛**

[![版本](https://img.shields.io/github/v/tag/INK-Q/agy-fast?label=version&sort=semver&style=flat-square&color=38BDF8&labelColor=0F172A)](CHANGELOG.md)
[![GitHub Stars](https://img.shields.io/github/stars/INK-Q/agy-fast?style=flat-square&color=FACC15&labelColor=0F172A)](https://github.com/INK-Q/agy-fast/stargazers)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-22C55E?style=flat-square&logo=node.js&logoColor=white&labelColor=0F172A)](#快速開始)
[![零執行階段依賴](https://img.shields.io/badge/runtime%20deps-0-38BDF8?style=flat-square&labelColor=0F172A)](#工作原理)
[![支援平台](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-64748B?style=flat-square&labelColor=0F172A)](#快速開始)
[![MIT 協議](https://img.shields.io/badge/license-MIT-22C55E?style=flat-square&labelColor=0F172A)](LICENSE)
[![Glama MCP Server](https://glama.ai/mcp/servers/INK-Q/agy-fast/badges/score.svg)](https://glama.ai/mcp/servers/INK-Q/agy-fast)
[![HOL Guard Verified](https://img.shields.io/endpoint?url=https%3A%2F%2Fhol.org%2Fapi%2Fregistry%2Fbadges%2Fplugin%3Fslug%3Dink-q%252Fagy-fast%26metric%3Dscore&style=flat-square&labelColor=0F172A)](https://hol.org/registry/plugins/ink-q%2Fagy-fast?utm_source=hol_marketplace&utm_medium=plugins_badge&utm_campaign=plugins&utm_content=ink-q%2Fagy-fast&ref=plugin-author-5dc88d78)

[English](README.md) · [簡體中文](README.zh-CN.md) · 繁體中文 · [快速開始](#快速開始) · [實測資料](#實測資料) · [MCP 工具](#5-個核心-mcp-工具) · [效能分析報告](docs/ANALYSIS_REPORT.zh-CN.md) · [更新日誌](CHANGELOG.md)

</div>

<br />

**`agy-fast`** 是一款面向 **Google Antigravity**（CLI `agy`、Desktop 2.0 與 IDE）的零依賴、合規本機 [MCP](https://modelcontextprotocol.io/) 加速外掛。它透過單次本機呼叫合併高頻程式碼搜尋、多語言符號大綱擷取、跨檔案原子編輯與並行建置／測試，並在工作階段啟動時注入 `<50 ms` 的工作區快照，顯著降低任務耗時、Token 折算額度與上傳流量——同時**完全無侵入**，不影響 Antigravity 原生介面、Diff 差異比較視窗、檔案修改列表、檢查點或安全驗證。

| 每 10 次操作所需的模型回合數 | 綜合折算 Token 額度 | 工具回傳的上傳位元組 | 磁碟寫入溢出與原生 UI 影響 |
| :---: | :---: | :---: | :---: |
| **-33.7%**<br><sub>`≥150k` 長上下文 `-38.2%` · 子代理 `-58.8%`</sub> | **-31.5%**<br><sub>`≥150k` 長上下文 `-36.5%` · 子代理 `-54.0%`</sub> | **-39.7%**<br><sub>未命中快取新增輸入 `-53.7%`</sub> | **0**<br><sub>`≤8.8 KB` 硬上限 · 原生 Diff 與 UI 零影響</sub> |

<p align="center">
  <img src="assets/demo-before-after-zh.gif" alt="agy-fast 加速前後多檔案任務實測比較：6 輪 48.2s 降至 2 輪 14.1s，零磁碟溢寫" width="100%" />
</p>

## 快速開始

**環境要求：Node.js >= 20**（無需執行 `npm install`，儲存庫已附帶未混淆的零依賴單一檔案 ESM 產物 `dist/*.mjs`）。可選安裝 [`ripgrep` (`rg`)](https://github.com/BurntSushi/ripgrep) 進一步加速程式碼搜尋（未安裝時自動回退至純 Node.js 並行遍歷）。

### 一行指令安裝（推薦）

自動將必要執行檔案安裝至 `~/.gemini/config/plugins/agy-fast`，若本機存在 `agy` CLI 則自動執行嚴格驗證與啟用，並完成 MCP 與 `SessionStart` 即時自檢：

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/INK-Q/agy-fast/main/install.sh | sh
```

**Windows（PowerShell）：**
```powershell
irm https://raw.githubusercontent.com/INK-Q/agy-fast/main/install.ps1 | iex
```

> [!TIP]
> **Desktop 2.0 / IDE 啟用提示：** 開啟 Antigravity 側邊欄的 **Customizations → Installed**，確認 `agy-fast` 已處於開啟狀態，然後開啟一個**新工作階段**即可啟用啟動快照鉤子與 MCP 工具。
>
> **以無需審批模式啟動 `agy` CLI（可選）：** 如果希望在 CLI 中連續呼叫 `agy-fast` 等工具而不必每次手動確認審批，可使用官方參數啟動：
>
> ```bash
> agy --dangerously-skip-permissions
> ```
>
> *（該參數會自動批准所有工具權限請求且不再彈窗詢問，建議僅在受信任的程式碼儲存庫中使用，或配合 `--sandbox` 一起啟用。）*

<details>
<summary>更多安裝方式（本機複製、直接複製至外掛目錄、<code>agy</code> 官方 CLI、按專案團隊共享、讓 Antigravity 自動安裝）</summary>

#### 本機複製安裝（跨平台通用）
```bash
git clone https://github.com/INK-Q/agy-fast.git
cd agy-fast
node scripts/install.mjs install
```

#### 直接複製到 Antigravity 外掛目錄（無需腳本）
Antigravity 會自動發現 `~/.gemini/config/plugins/` 下的外掛：

```bash
# macOS / Linux
git clone https://github.com/INK-Q/agy-fast.git ~/.gemini/config/plugins/agy-fast
```

```powershell
# Windows (PowerShell)
git clone https://github.com/INK-Q/agy-fast.git "$env:USERPROFILE\.gemini\config\plugins\agy-fast"
```

#### 使用 `agy` 官方 CLI 安裝
```bash
agy plugin install /path/to/agy-fast
agy plugin enable agy-fast
```

#### 按專案安裝（適合團隊儲存庫共享）
僅安裝到指定程式碼儲存庫的 `.agents/plugins/agy-fast`：
```bash
node scripts/install.mjs install --project /path/to/your-repo
```

#### 直接讓 Antigravity 自動安裝
將以下指令直接傳送給 Antigravity：
```text
請將 https://github.com/INK-Q/agy-fast.git 複製到 ~/.gemini/config/plugins/agy-fast，執行 `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs doctor` 驗證可用性，並啟用 agy-fast 外掛。
```

</details>

## 工作原理

基於 **55 個真實 Antigravity 工作階段**（**8,446 輪模型呼叫**、**17,302 次工具呼叫**、**55.25 小時**純單 Agent 活躍時間，詳見脫敏報告 [docs/ANALYSIS_REPORT.zh-CN.md](docs/ANALYSIS_REPORT.zh-CN.md)）的定量分析，任務慢的根因通常並非模型解碼速度，而是 4 項結構性開銷：

| 實測效能瓶頸 | 定量開銷 | `agy-fast` 的解決方案 |
| :--- | :--- | :--- |
| **每輪固定首字等待（TTFT）** | 中位數 `~6.1 秒`（佔中位數輪次約 `79%`；`68.1%` 輪次輸出 `<700` tokens） | 單次 MCP 呼叫平均打包 **4.89** 個邏輯操作（子代理達 **5.95×**），大幅削減無效往返輪次（每輪 `~6–8 秒`） |
| **工具序列驗證與細粒度拆分** | `52.5%` 的 `edit_file` 是同輪同檔案拆分；`46.3%` 的 `run_command` 是唯讀搜尋（中位數 `~2.0 秒` vs 本機 `rg` `2.1 ms`） | 在本機常駐 Stdio MCP 中一次合併最多 20 條搜尋、50 個檔案編輯 + `verify` 或 12 條並行檢查指令 |
| **工作階段冷啟動探索耗時** | 前 3 輪平均花費 **49.2 秒**檢查目錄結構、git 狀態與腳本 | `SessionStart` 鉤子僅在啟動時執行一次（`~35–50 ms`），注入 `≤1.5 KB` 精簡工作區快照 |
| **上下文膨脹與快取失效** | `read_file` 佔工具回傳體積的 **81.9%**；`>60 秒` 間隔使快取失效比例從 `1.4%` 飆升至 `15.9%–93.8%` | 先擷取符號大綱再並行精確讀取、全工具維持 `≤8.8 KB` UTF-8 內聯上限（杜絕 `output.txt` 磁碟溢寫）並隔離多模態截圖 |

### 混合執行架構

`agy-fast` 不會取代原本就極快的內建讀取，而是將「批次合併型操作」交給本機 MCP，同時把小檔案與已知行段直接路由給本機白名單內建 `read_file`（`~7 ms`、單次 `46 KB` 內聯、無需遠端驗證）：

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-zh-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/architecture-zh-light.svg" />
    <img alt="agy-fast 混合執行架構圖" src="assets/architecture-zh-light.svg" width="100%" />
  </picture>
</p>

### 外掛組成

| 模組 | 檔案路徑 | 作用 |
| :--- | :--- | :--- |
| **原生外掛清單** | [`plugin.json`](plugin.json) | 符合官方規範的中繼資料，通過 `agy plugin validate --strict` 零警告驗證 |
| **本機常駐 MCP 服務** | [`mcp_config.json`](mcp_config.json) → [`dist/mcp-server.mjs`](dist/mcp-server.mjs) | 在本機常駐執行，在 `agy-fast_fast` 下以急載入（`"eager": true`）暴露 5 個強型別合併工具 |
| **工作階段啟動快照鉤子** | [`hooks.json`](hooks.json) → [`dist/session-start.mjs`](dist/session-start.mjs) | 僅在 `SessionStart` 執行一次（`~35–50 ms`，內建 `250 ms` 掃描熔斷與系統/使用者目錄黑名單），注入 `≤1.5 KB` 專案/Git/目錄快照 |
| **工具路由與衛生規則** | [`rules/AGENTS.md`](rules/AGENTS.md) | 約 `6.5 KB` 精簡路由規則，內聯參數簽名（支援自訂 `rules/AGENTS.local.md`，需帶 `trigger: always_on` frontmatter，更新與重新安裝自動保留） |
| **背景自動更新器** | [`dist/updater.mjs`](dist/updater.mjs) | 4 小時分離式背景檢查，先暫存執行 MCP 冒煙驗證再原子替換 |
| **離線基準測試工具** | [`dist/benchmark.mjs`](dist/benchmark.mjs) | 本機解析 `transcript.jsonl` 並輸出單次指標或前後 A/B 比較 |

## 實測資料

基於連續 **10 天脫敏真實編碼軌跡** 統計（**14 場基線主工作階段 / 5,771 輪** vs. **7 場啟用 `agy-fast` 主工作階段 / 901 輪**，以及 **104 場基線 vs. 4 場外掛子代理工作階段**；已剝離全部儲存庫名、路徑與工作階段標識），`agy-fast` 單次呼叫平均打包 **4.89 個邏輯操作**（子代理達 **5.95×**）：

| 核心指標 *（按「單位有效操作」正規化）* | 主工作階段 · 基線 | 主工作階段 · `agy-fast` | 變化 | `≥150k` 長上下文主工作階段 | 子代理 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **每 10 操作所需模型輪次** | 5.23 輪 | **3.47 輪** | **-33.7%** | **-38.2%** | **-58.8%** |
| **每 10 操作上行請求數** *（LLM + 遠端驗證）* | 9.82 次 | **6.05 次** | **-38.4%** | **-42.6%** | **-62.0%** |
| **Prompt Cache 命中率** *（失效尖峰佔比）* | 89.6% *(7.5%)* | **94.0%** *(4.8%)* | **+4.4 pp** | **95.0%** *(3.3%)* | 92.4% *(2.8%)* |
| **每操作全價新增輸入（未命中快取）** | 10,413 tok | **4,822 tok** | **-53.7%** | **-61.5%** | **-51.3%** |
| **每操作綜合折算額度** *（權重 1 : 0.1 : 5）* | 22,458 eq | **15,387 eq** | **-31.5%** | **-36.5%** | **-54.0%** |
| **每操作工具回傳的上傳位元組** *（本機實測）* | 5.06 KB | **3.05 KB** | **-39.7%** | **-42.6%** | **-13.3%** |
| **每操作增量新增文字上傳** *（增量同步口徑）* | 35.6 KB | **16.5 KB** | **-53.7%** | **-61.6%** | **-51.3%** |
| **每操作全量歷史文字上傳** *（無狀態重傳估算）* | 342.2 KB | **276.2 KB** | **-19.3%** | **-21.9%** | **-58.9%** |

**`v0.2.x` 生產實測亮點：**
- **連續 134 次 MCP 呼叫 `0` 次磁碟溢寫**：所有工具輸出均限制在 `≤8.8 KB` UTF-8 內嵌上限內，徹底消除輸出寫入檔案 `output.txt` 帶來的二次讀取損耗。
- **有效吞吐 `+75%`（`35.1 → 61.5 tok/s`），`>60s` 嚴重卡頓從 `31.2%` 降至 `7.4%`**：在同一場跨版本長工作階段前後對照（99 輪 vs. 374 輪）中，啟用多模態隔離規則後主編碼工作階段載入截圖數降至 `0`，避開 `>180k` 上下文多模態 TTFT 懸崖。
- **`0` 次懶載入 Schema 盲讀**：在 [`rules/AGENTS.md`](rules/AGENTS.md) 內聯緊湊 Schema，跳過額外讀取 `mcp/agy-fast_fast/*.json` 的輪次。

<details>
<summary>統計口徑、多權重敏感性驗證與固定 Prompt 開銷說明</summary>

- **邏輯操作正規化**：1 次含 5 個查詢的 `batch_search` 計 5 個操作，1 次含 6 處 hunk + `verify` 的 `apply_edits` 計 7 個操作，內建 `read_file`/`edit_file`/`run_command` 計 1 個操作，確保按「同等實際工作量」公平比較。
- **多權重敏感性驗證**：標準權重（未快取輸入 `1.0` : 快取讀 `0.1` : 輸出 `5.0`）下主工作階段省 **31.5%**（`≥150k` 長上下文省 **36.5%**）；換用保守快取折扣（`1 : 0.25 : 4` → **-25.8%**）或高輸出權重（`1 : 0.1 : 8` → **-29.4%**）結論一致。
- **固定 Prompt 開銷**：`rules/AGENTS.md` + `SessionStart` 快照每工作階段合計僅增加 **~1.7k tokens**（第 2 輪起命中快取，每輪約 `170` eq tokens）；只要省掉 **1 次多餘輪次**（`~44k` eq tokens）或 1 次大檔案盲讀即可回本 **20 倍以上**。

</details>

### 本機離線驗證你自己的日誌（零資料上傳）

```bash
# 統計本機全部 Antigravity 歷史軌跡的基線指標
node dist/benchmark.mjs analyze --local

# 僅分析最近修改的 10 個本機工作階段
node dist/benchmark.mjs analyze --local --recent 10

# 按外掛安裝時間切分（相容舊對話續聊），比較「已用 vs 未用 agy-fast」
node dist/benchmark.mjs analyze --local --since 2026-11-19T12:51:00+08:00 --split-usage

# 比較同一任務啟用外掛前後的指標變化
node dist/benchmark.mjs compare --before ./before/transcript.jsonl --after ./after/transcript.jsonl
```

## 5 個核心 MCP 工具

| 任務場景 | 推薦工具 | 核心原因 |
| :--- | :--- | :--- |
| 執行 ≥2 條文字、正則、Glob、模糊路徑或唯讀 Git 查詢 | **`batch_search`** | 1 次呼叫並行跑最多 20 條查詢（本機 `<70 ms`） |
| 摸清未知大檔案結構（`>300` 行） | **`quick_outline`** *（或 **`read_slices`**）* | 扁平 `paths` 參數一次擷取最多 40 個檔案符號大綱，避免盲讀整檔案 |
| 讀取小檔案（`<300` 行）或已知行號區間 | 內建 `read_file` | 本機白名單直放（`~7 ms`、單次 `46 KB`、無需遠端驗證） |
| 同輪多處/跨檔案編輯，或「編輯 + 驗證」 | **`apply_edits`** | 原子或 `bestEffort` 寫入檔案 + 可選內聯 `verify` |
| 執行 ≥2 條獨立建置、檢查、測試或診斷指令 | **`run_checks`** | 受控並行執行，頭尾折疊擷取核心報錯與測試彙總 |

### 1. `batch_search` — 並行程式碼檢索、模糊路徑與唯讀 Git 查詢
- **單次最多 20 條混合查詢**：支援 `text`、`regex`、`glob`、`fuzzy` 與唯讀 `git`（`status`、`diff`、`log`、`show`、`branch`、`rev-parse`、`ls-files`、`blame`、`shortlog`、`describe`、`tag --list`、`remote -v`），並支援按條傳入 `path` 跨目錄/跨儲存庫查詢。
- **精細控制**：支援 `fileType`（如 `typescript`、`python`、`gdscript`）與 `glob` 過濾、`outputMode`（`content` | `files_with_matches` | `count`）、跨行匹配 `multiline: true`（此時 `count` 統計各檔案的匹配次數）、`type: "fuzzy"` 忽略大小寫模糊路徑查詢以及 `glob` 的 `sortBy: "mtime"` 最新修改優先排序。
- **高容錯與內聯防磁碟溢寫**：優先呼叫 `rg`（缺失自動回退 Node.js），對常見 `glob` 誤傳（正則 `|` 與裸關鍵詞）自動修正並恢復，預設維持 `≤8.8 KB` UTF-8 內聯上限。

### 2. `apply_edits` — 原子多處/跨檔案編輯 + 內聯驗證
- **單次最多 50 個檔案**：預設全記憶體預驗證後原子寫入（任意失配或重疊均不改動磁碟）；大批次可傳 `bestEffort: true` 按檔案原子提交成功項，並對失敗項自動回傳最相近程式碼行與行號漂移提示，便於精準重試。
- **無損保留檔案屬性**：保留 CRLF 換行符、檔案權限與軟連結；支援 `startLine`/`endLine`、`replaceAll`、`create`/`overwrite` 與 `dryRun`。
- **可選內聯 `verify`**：寫入檔案後直接執行建置/型別檢查/測試指令，自動過濾 Pino/Bunyan info JSON 與 Maven 尾註噪聲，保留核心報錯根因。

### 3. `quick_outline` — 極簡多語言符號大綱擷取
- **扁平參數，單次最多 40 個檔案** *（推薦 10–20 個/批）*：僅需傳入扁平 `paths: string[]` 即可擷取起止行號，覆蓋 **TypeScript / JavaScript** *（含 Fastify/Express 路由與測試塊）*、**HTML / Vue / Svelte**、**CSS / SCSS / Less**、**Python**、**Godot GDScript（`.gd`）**、**Go**、**Rust**、**Java / Kotlin / C# / Swift / C / C++**、**Shell**、**Markdown** 與 **JSON / YAML**，搭配並行呼叫的內建 `read_file` 使用。

### 4. `read_slices` — 符號大綱 + 精確行段切片
- **大綱與小切片合一**：支援同等 15 種格式符號大綱（支援單檔案廣度優先水填充分配），並可在同一次請求中順帶讀取少量小行段（總輸出維持 `≤8.8 KB` UTF-8 上限）；大段正文讀取自動引導至並行內建 `read_file`。

### 5. `run_checks` — 並行建置、規範檢查、測試與診斷執行器
- **單次最多 12 條指令**：在受控的並行工作池（`concurrency: 1..8`）中並行執行獨立非互動指令，支援單條逾時強制終止（`1..150 s`，單次呼叫共享 `150 s` 預算以適配 Antigravity `180 s` MCP 上限）、ANSI 跳脫字元清理，並在 Windows 下自動透明解包針對白名單 CLI（`git`/`npm`/`node`/`rg`/`pytest`/`cargo` 等）的冗餘 `powershell -Command "..."` 包裝，免去 PowerShell 冷啟動開銷（PowerShell cmdlet、別名與管線完全原樣保留）。
- **頭尾折疊（Head-Tail）雙輸出模式**：預設 `compact` 模式將通過項折疊為 1 行摘要、超長失敗日誌採用**頭尾折疊**（同時保留第一個根因錯誤與末尾測試彙總/堆疊尾部）；`full` 模式在 `≤8.8 KB` 預算內保留標準輸出，超限時同樣採用頭尾折疊。

<details>
<summary>批次 MCP 呼叫示例（JSON 參數）</summary>

**`batch_search` — 單次並行執行 3 類異構查詢：**
```json
{
  "queries": [
    { "type": "regex", "pattern": "export (async )?function", "fileType": "typescript", "outputMode": "files_with_matches" },
    { "type": "fuzzy", "pattern": "mcp server" },
    { "type": "git", "pattern": "status --short" }
  ]
}
```

**`apply_edits` — 跨檔案編輯 + 內聯型別檢查一步完成：**
```json
{
  "edits": [
    { "path": "src/a.ts", "hunks": [{ "target": "oldCall()", "replacement": "newCall()" }] },
    { "path": "src/b.ts", "hunks": [{ "target": "v1", "replacement": "v2", "startLine": 10, "endLine": 25 }] }
  ],
  "bestEffort": true,
  "verify": "npm run typecheck"
}
```

</details>

## 日常維護與更新

### 常用維護指令

| 操作 | 指令 |
| :--- | :--- |
| **健康檢查** *（Node 版本、`rg`、MCP 即時握手、`SessionStart` 延遲、嚴格清單驗證）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs doctor` |
| **僅檢查更新** *（不修改檔案）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs update --check` |
| **立即更新並自檢** *（先暫存冒煙驗證再替換）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs update` |
| **配置自動更新策略** *（`auto` \| `notify` \| `off`）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs config --auto-update notify --interval 24` |
| **切換 MCP 工具載入模式** *（`eager` \| `lazy`，自動更新保留）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs config --tool-loading lazy` |
| **CLI 直調模式** *（供 Swarm Worker 及無 MCP 環境通過 `run_command` 呼叫）* | `node ~/.gemini/config/plugins/agy-fast/dist/mcp-server.mjs --cli <search\|outline\|slice\|edit\|check>` |
| **獨立 MCP Stdio 服務** *（供標準 MCP 用戶端按需掛載；透傳 `--schema-compat=minimal` 等參數）* | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs mcp` *（或 `agy-fast-mcp`）* |
| **一鍵乾淨解除安裝** | `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs uninstall` |

> 在本機複製目錄中，也可直接使用 `./install.sh <子指令>`（macOS/Linux）或 `.\install.ps1 <子指令>`（Windows）執行上述全部子指令。

### 背景更新（本 fork 預設關閉）

透過 Git 審查並選擇性合併上游變更。外掛預設不在背景檢查或安裝更新。若已有舊設定，設定 `AGY_FAST_AUTO_UPDATE=off` 可覆寫。

- **0 ms 啟動阻塞**：每 **4 小時**在 `SessionStart` 輸出快照*之後*，非同步拉起完全分離的背景更新行程（`dist/updater.mjs`）。
- **先驗證、再原子替換**：優先通過 `git ls-remote --tags`（無 `git` 時回退 GitHub Releases API）偵測新版本，複製至隔離暫存目錄並完成 **MCP 即時冒煙驗證**後，再按檔案原子替換；損壞版本會被自動攔截，且使用者自訂的 `rules/AGENTS.local.md`（需帶 `---\ntrigger: always_on\n---` YAML frontmatter 以便 Antigravity 載入，已加入 `.gitignore`）在自動更新與手動重新安裝時均會被完整保留。
- **安全保護**：常規複製安裝與乾淨的直接 `git clone` 安裝會自動更新；`--link` 開發軟連結與有未提交改動的儲存庫**絕不覆蓋**（僅提示有新版本）。更新完成後將在下一次新工作階段開頭展示一次性提示。

<details>
<summary>環境變數覆蓋與更新生效說明</summary>

| 環境變數 | 可選值 / 預設值 | 說明 |
| :--- | :--- | :--- |
| `AGY_FAST_AUTO_UPDATE` | `auto` \| `notify` \| `off` *（預設）* | 覆蓋已儲存的自動更新模式 |
| `AGY_FAST_UPDATE_INTERVAL_HOURS` | `12` *（預設；`1..720`）* | 背景檢查間隔（小時） |
| `AGY_FAST_UPDATE_CHANNEL` | `release` *（預設）* \| `main` | 跟蹤穩定發版標籤或 `main` 分支 |
| `AGY_FAST_REPO` | Git 儲存庫網址 | 自訂鏡像或 Fork 儲存庫網址 |
| `AGY_FAST_EDITS_FORMAT` | `auto` *（預設）* \| `array` \| `string` | 控制 `apply_edits.edits` 參數格式策略（`auto` 在支援 `"eager": true` 的 CLI ≥1.5.8、桌面版 2.0、IDE 與第三方用戶端統一走省 token 的強型別原生陣列，在舊版懶載入 CLI 1.5.0–1.5.7 自動切換為 JSON 陣列字串以防 `[]` 丟參；伺服器端一律相容兩種格式） |
| `AGY_FAST_HOST` | 如 `cli@1.5.14`、`ide@2.7.0`、`desktop@2.34.0` | 手動覆蓋自動探測到的 Antigravity 宿主端型別與版本 |
| `AGY_FAST_SCHEMA_COMPAT` | `standard` *（預設）* \| `minimal` | 從 `tools/list` 剝離數值/陣列範圍約束關鍵字（`minimum`/`maximum`/`minItems`/`maxItems`），配合嚴格 JSON Schema 子集宿主（亦支援 `--schema-compat=minimal`，執行期校驗不受影響） |

**更新生效提示：** 新版 `rules/AGENTS.md` 與 `dist/session-start.mjs` 在下一次開啟新工作階段時自動生效；Antigravity Desktop 2.0 / IDE 若需立即重新整理常駐 MCP 伺服器，重新載入視窗或重啟一次即可。

</details>

## 合規與安全

- **嚴格遵守官方介面**：僅使用 Antigravity 官方文件定義的外掛擴充功能機制（`plugin.json`、`mcp_config.json`、`hooks.json`、`rules/AGENTS.md`）。
- **完全無侵入**：絕不影響 Antigravity 本身的表現與原生行為，**Diff 差異比較視窗**、**檔案修改列表**、檢查點與內建工具均保持原樣工作。
- **不篡改安全與程式檔案**：不修改用戶端程式檔案，不繞過、不停用任何內建安全評估機制或認證流程。
- **零每步阻塞鉤子**：不註冊 `PreToolUse`、`PostToolUse`、`PreInvocation`、`PostInvocation` 或 `Stop` 鉤子。
- **失敗放行啟動鉤子**：`SessionStart` 遇到不可讀目錄或異常輸入時回傳 `{}` 並正常退出，絕不阻斷工作階段啟動。
- **本機優先且原始碼透明**：全部 MCP 工具與基準測試均在本機離線執行，零程式碼或日誌上傳；預建置 `dist/*.mjs` 產物不混淆，每一行執行程式碼均可直接審計。

## 常見問題

### 安裝 `agy-fast` 會影響 Antigravity 的原生介面、Diff 視窗或檔案修改列表嗎？
不會。`agy-fast` 完全執行在官方本機 Stdio MCP 與 `SessionStart` 外掛介面之上，不修改用戶端程式，也不會干擾 Antigravity 原生的 Diff 差異比較視窗、檔案修改列表、檢查點、內建工具或安全驗證。

### 除了提速，`agy-fast` 還能省 Token 額度和上傳流量嗎？
可以。在連續 10 天脫敏真實編碼日誌實測中，單次 MCP 呼叫平均打包約 4.9 個操作，使每 10 次操作的模型輪次降低 **33.7%**、綜合折算 Token 額度降低 **31.5%**（`≥150k` 長上下文省 **36.5%**，子代理省 **54.0%**）、工具回傳的上傳位元組降低 **39.7%**，且 `>60s` 卡頓輪次從 **31.2% 降至 7.4%**。

### `agy-fast` 會替代 Antigravity 內建的 `read_file` 或 `edit_file` 嗎？
不會，兩者是互補的混合協作模式。Antigravity 內建 `read_file` 屬於本機白名單放行（`~7 ms`、單次 `46 KB`、無需遠端驗證），因此小檔案與已知行段仍直接並行使用內建 `read_file`；而批次搜尋、大檔案大綱擷取、跨檔案/多處原子編輯（含 `verify`）以及並行檢查則交由 `agy-fast` 合併執行。

### 支援哪些 Antigravity 用戶端與作業系統？
同時支援 **Antigravity CLI（`agy`）**、**Antigravity Desktop 2.0** 與 **Antigravity IDE**，相容 **macOS、Linux 與 Windows**。僅需 **Node.js >= 20** 且零執行階段依賴（可選安裝 `ripgrep`/`rg`，缺失時自動回退純 Node.js）。

### `agy-fast` 會向外部上傳程式碼或工作階段日誌嗎？
不會。全部 5 個 MCP 工具、`SessionStart` 快照以及離線基準測試均 100% 在本機執行。唯一的可選外網動作是每 4 小時檢查一次 GitHub 公開 Release 標籤以支援自動更新，可隨時通過 `config --auto-update off` 或 `AGY_FAST_AUTO_UPDATE=off` 完全關閉。

### 如何驗證本機加速效果或徹底解除安裝？
執行 `node dist/benchmark.mjs analyze --local --split-usage` 即可純離線統計本機日誌的前後比較。隨時可執行 `node ~/.gemini/config/plugins/agy-fast/scripts/install.mjs uninstall` 一鍵乾淨解除安裝。

## 本機開發與測試

```bash
npm install
npm run typecheck   # TypeScript 嚴格型別檢查
npm run build       # 使用 esbuild 打包 src/*.ts -> dist/*.mjs
npm test            # 執行單元測試、MCP 協議測試、Hook 測試、基準測試與安裝器測試
npm run bench:stress # 執行 12 場景端到端壓測與效能基準套件
npm run validate    # 執行 `agy plugin validate --strict .`
```

## MCP 目錄收錄

<a href="https://glama.ai/mcp/servers/INK-Q/agy-fast">
  <img width="380" src="https://glama.ai/mcp/servers/INK-Q/agy-fast/badge" alt="agy-fast MCP server on Glama" />
</a>

## Star History

<a href="https://www.star-history.com/#INK-Q/agy-fast&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=INK-Q/agy-fast&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=INK-Q/agy-fast&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=INK-Q/agy-fast&type=Date" />
  </picture>
</a>

## 開源協議

[MIT](LICENSE)
