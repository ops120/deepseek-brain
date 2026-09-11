# deepseek-brain

把 **DeepSeek 网页版**当作编码 agent 的**外部大脑**：它出推理与意见，你的 agent 出执行。
不需要 API key，不做逆向代理 —— 只驱动官方网页。

- 由本地确定性 CLI（`dsb`）驱动，Agent 只负责调用与判断
- 人工登录一次，长期复用；只有网站重弹验证时才再打扰你
- 发送前有确定性脱敏闸门（私钥整段拒绝、密钥形状脱敏、家目录路径脱敏、尺寸上限）
- 支持 `[DSB]` 协作协议：让 DeepSeek 做 PLAN → 你执行 → 它 REVIEW 的循环

## 目录

- [能力](#能力)
- [安装](#安装)
- [快速上手](#快速上手)
- [命令面](#命令面)
- [返回值契约](#返回值契约)
- [协作协议](#协作协议dsb)
- [失败处理](#失败处理)
- [状态、缓存与隐私](#状态缓存与隐私)
- [原理与已知坑](#原理与已知坑)
- [边界](#边界)
- [项目结构](#项目结构)
- [同族项目](#同族项目)

## 能力

| 能力 | 说明 | 怎么用 |
| --- | --- | --- |
| **深度思考** | 开启推理模式（网页版 UI 上是「深度思考」开关） | `--think on` |
| **智能搜索** | 联网检索并给出摘要化结果 | `--search on` |
| **文件 / 图片分析** | 上传文件或图片让 DeepSeek 分析 | `--attach a.pdf,b.png` |
| **长文本** | 单次正文 ≤ 50 KB（`--allow-large` 放宽到 200 KB） | 自动分片注入 |
| **多轮对话** | 同一线程复用上下文 | 默认复用工作区当前线程 |
| **协作循环** | 规划 / 执行 / 复核的迭代协议 | `--protocol INIT\|EXECUTED` |

> **网页版没有模型选择器**。可控的只有「深度思考」「智能搜索」两个开关，回答由 DeepSeek 的统一模型生成。
> 因此 CLI **不提供** `--model`，也不会声称"给你用了某某模型"。

**不支持**：生图、生视频、生音频、tool call / function calling（它就是聊天界面）。

## 安装

### 前置要求

- **Node.js ≥ 20**（`node --version` 检查）
- 系统已装 **Chrome / Edge / Brave / Chromium** 任一（自动探测，不下载 Chromium）
- 能访问 `chat.deepseek.com` 的**浏览器**（Node 直连可能因 TLS/代理失败，不影响使用）
- 一个 DeepSeek 账号（**无需 API key**）

### 作为 Skill 安装

本仓库根目录就是 skill 目录，clone 到宿主的 skills 目录即可，**无需修改任何路径**：

```bash
git clone <repo-url> ~/.claude/skills/deepseek-brain     # Claude Code
git clone <repo-url> ~/.codex/skills/deepseek-brain      # Codex
git clone <repo-url> ~/.agents/skills/deepseek-brain     # 通用 / ZCode
```

装好后对 agent 说：**「用 deepseek-brain 完成首次配置」**。

### 首次配置做了什么

```bash
node "<skill-root>/scripts/dsb/cli.mjs" setup
```

1. 检查 Node 版本与系统浏览器
2. 把 `playwright-core` 装到**状态目录**（不污染 skill 目录）
3. 打开有头浏览器，**请你本人登录**（账号密码 / 扫码，agent 不接触凭证）
4. 冒烟验证并保存登录态

> **登录策略**：登录一次长期有效。之后只有网站**重弹验证**（登录页重现 / 会话过期 / 人机验证）时才需要你介入，
> CLI 会返回 `LOGIN_REQUIRED` 并停下，不会自作主张。

## 快速上手

```bash
# 体检（建议每次任务前跑一次，很快）
node "<skill-root>/scripts/dsb/cli.mjs" doctor --json

# 普通问答（长 prompt 先写临时文件）
node "<skill-root>/scripts/dsb/cli.mjs" ask \
  --prompt-file ./question.txt --json

# 开深度思考 + 智能搜索
node "<skill-root>/scripts/dsb/cli.mjs" ask \
  --prompt "分析这个报错的原因" --think on --search on --json

# 带附件分析
node "<skill-root>/scripts/dsb/cli.mjs" ask \
  --prompt "总结这份文档的要点" --attach ./report.pdf --json

# 新开线程（默认复用工作区当前线程）
node "<skill-root>/scripts/dsb/cli.mjs" ask --prompt "..." --thread new --json
```

对 agent 说人话也一样：**「用 deepseek 深度思考分析一下这个报错」**、**「问问 deepseek 这个设计有什么问题」**。

## 命令面

所有命令都支持 `--json`（机器可读），以及 `--debug`（保存页面 HTML 便于排障）、`--keep-open`（保留浏览器窗口）。

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `setup` | 首次配置：装依赖 → 打开浏览器 → 人工登录 | `--timeout <ms>` |
| `login` | 重新登录（登录态失效时用） | `--timeout <ms>` |
| `logout` | 清除登录态（清 profile 与 storage-state） | — |
| `doctor` | 体检 | `--deep`（真机探测页面/选择器）、`--html`（存页面 HTML） |
| `ask` | 提问 | `--prompt` / `--prompt-file`、`--think on\|off`、`--search on\|off`、`--attach`、`--thread`、`--protocol`、`--timeout`、`--allow-sensitive`、`--allow-large` |
| `thread` | 线程管理 | `status` / `use <url>` / `new` |
| `session` | 工作区级线程与检查点 | `get` / `set --protocol-state --waiting-for --next-step ...` |
| `logs` | 查看脱敏日志 | `-n <行数>`、`--verbose` |
| `update-check` | 检查更新 | `--force` |

运行方式：`node <skill-root>/scripts/dsb/cli.mjs <命令>`。

### doctor 检查项

| 检查项 | 含义 |
| --- | --- |
| `node` | Node 版本 ≥ 20 |
| `deps` | `playwright-core` 已装到状态目录 |
| `browser` | 找到可用的 Chromium 系浏览器（并显示走的是哪条探测路径） |
| `stateDir` | 状态目录可写 |
| `network` | 能访问站点（Node 直连失败不算死，会注明） |
| `login` | **仅 `--deep` 时**：cookie 里有登录标志 |
| `deep` | **仅 `--deep` 时**：真机探测页面状态 / 模型选择器，并截图 |

## 返回值契约

成功：

```json
{
  "ok": true,
  "requestId": "dsb_ab12",
  "threadUrl": "https://chat.deepseek.com/a/chat/s/xxxx",
  "modes": { "requested": { "think": true, "search": false },
             "confirmed": { "think": true, "search": false } },
  "text": "……逐字答案……",
  "citations": [{ "title": "来源标题", "url": "https://…" }],
  "truncated": false,
  "elapsedMs": 41000
}
```

**字段说明**：

- `modes.requested` —— 你要求的开关状态
- `modes.confirmed` —— **实际生效**的开关状态，用回答内的证据独立判定：
  - `think` → 回答里是否出现推理块
  - `search` → 回答里是否带引用来源 / 是否出现「搜索到 N 个网页」
  - **两者不一致时必须在回复里标注**，不要默认生效
- `truncated` —— `true` 表示可能被截断（超时或流式停滞），需要如实告知用户
- `citations` —— 联网搜索的引用来源（域名 + URL）

失败（**判别联合**，`reason` 可枚举）：

```json
{ "ok": false, "reason": "RATE_LIMITED", "message": "…", "retryAfterMs": 300000 }
```

## 协作协议（`[DSB]`）

让 DeepSeek 当「规划与审查大脑」，**执行权始终在本地 agent 手里**：

```bash
# ① 起循环
dsb ask --protocol INIT --task dsb_f81a --iteration 0 --prompt-file goal.txt --json
#    → 看 protocol.reply.state：PLAN = 拿到方案，继续；BLOCKED = 停下问用户

# ② 你自己执行（用你的工具链，它不微管理）

# ③ 汇报（正文只写元数据：改了哪些文件、测试结果；不贴 diff / 不贴日志）
dsb ask --protocol EXECUTED --iteration 1 --prompt-file report.txt --json
#    → DONE = 结束 | PLAN = 还有下一轮 | BLOCKED = 停下

# 查进度（checkpoint 自动落盘）
dsb thread status --json
```

- 信封由 CLI 自动封装，回复状态由代码解析（不靠 agent 读文本判断）
- 迭代上限默认 12，到顶暂停问用户
- 线程丢失 → 依据 session checkpoint 生成 HANDOFF 简报，**不粘贴日志或 diff**
- 详细字段要求见 [references/protocol.md](references/protocol.md)

## 失败处理

`reason` 是**可枚举的**，每个都有对应动作（完整表见 [references/failure-taxonomy.md](references/failure-taxonomy.md)）：

| reason | 含义 | 动作 |
| --- | --- | --- |
| `LOGIN_REQUIRED` | 登录失效 | 停；让用户登录，一次一个动作 |
| `CLOUDFLARE_CHALLENGE` | 人机验证 | 停；用户手动过盾后重试 |
| `RATE_LIMITED` | 限流 | 停；按 `retryAfterMs` 退避 |
| `COMPOSER_NOT_FOUND` / `SITE_CHANGED` | 站点改版、选择器漂移 | **版本问题**：`doctor --deep` 定位，修 `src/site.mjs` 并发版（不要现场硬试 DOM） |
| `SEND_FAILED` | 发送失败 | 重试一次 |
| `STREAM_STALLED` | 流式停滞 / 超时 | 标注「可能截断」；可重试一次 |
| `ANSWER_EMPTY` | 空回答 | 新线程重试一次 |
| `UPLOAD_REJECTED` | 附件被拒 | 检查类型 / 大小 |
| `THREAD_LOST` | 线程 404 | 新线程重问（或 HANDOFF） |
| `LOCKED` | 浏览器被占用 | 等，或问用户 |
| `DEPENDENCY_MISSING` | 依赖缺失 | `setup` 自愈 |
| `SENSITIVE_BLOCKED` | 闸门拦截 | 移除敏感内容；确需发送要用户明确同意 |
| `PAYLOAD_TOO_LARGE` | 正文超 50 KB | 摘要或分片；`--allow-large` 放宽到 200 KB |

**硬规则**：绝不把失败伪装成结果；绝不静默降级后不告知；同类失败最多重试 2 次。

## 状态、缓存与隐私

状态目录（`DSB_STATE_DIR` 可覆盖）：

```
Windows  %LOCALAPPDATA%\deepseek-brain\
macOS    ~/Library/Application Support/deepseek-brain/
Linux    $XDG_STATE_HOME/deepseek-brain/   （或 ~/.local/state/）
```

| 内容 | 说明 |
| --- | --- |
| `deps/` | `playwright-core`（不污染 skill 目录） |
| `profile/` | 持久化浏览器 profile —— **登录态的唯一来源** |
| `threads/<workspaceId>.json` | 工作区级线程与检查点 |
| `outputs/<workspaceId>.jsonl` | 审计：每次问答一行**元数据**（requestId、模式、耗时、是否截断） |
| `logs/dsb.log` | 脱敏日志（`dsb logs` 查看） |
| `debug/` | 仅 `--debug` 时保存的页面 HTML / 截图 |

**隐私要点**：

- 状态目录权限 `0700`，文件 `0600`
- **回答正文默认不落盘**，只记录元数据
- cookie / storageState **永不**导出到项目目录、**永不**进日志、**永不**进 prompt
- 项目目录零残留（`.gitignore` 已排除常见临时产物）
- 日志经过脱敏（token 形状、Bearer、密钥键值）

## 原理与已知坑

### 工作方式

```
你 / Agent ──调用──▶ dsb CLI ──Playwright──▶ 持久 Chrome ──▶ chat.deepseek.com
                        │
                        ├─ 发送前：确定性净化闸门（拒绝/脱敏/限额）
                        ├─ 注入：React 原生 setter + input 事件（长文分片）
                        ├─ 等待：网络信号（completion 流）+ 文本稳定性 双判据
                        └─ 抽取：语义化容器 + DOM 文本收集（上标压紧、块级换行）
```

### 真机验证过的坑（别再踩）

1. **流式结束判定不能靠文案**。早期用「等『停止生成』消失」，文案一变就失效。
   现在的主判据是**页面自身的 completion 请求**（`requestfinished` = 生成结束），文本稳定性做兜底。
2. **消息列表会虚拟化**。长线程里 DOM 只挂载少量消息，用「助手消息条数」当基线会永远等不到新消息。
3. **推理块检测要用差值**。多轮对话里，历史推理块会让「关闭深度思考」被误判成开启 ——
   现在用「发送前后推理块数量差」判定本次是否真的生效。
4. **长文本注入方式**。直接设 `value` 会被 React 冲掉；逐字符输入慢且可能触发换行提交。
   用原生 setter + `input` 事件，超 50 KB 分片。
5. **引用角标会污染正文**。角标内常有 `opacity:0` 的占位符，`innerText` 会读出来 ——
   需要跳过不可见文本，并跳过引用角标节点。
6. **表格会被拍平**。`td/th` 需要显式加分隔符，`tr` 需要换行。
7. **浏览器启动参数**（见 `src/browser.mjs`）：
   - `chromiumSandbox: true` —— 默认 `false` 会让 Playwright 注入 `--no-sandbox`，
     Chrome 顶部会显示「不受支持的命令行标记」警告条，且是自动化特征（会招致更严的风控）
   - `viewport: null` —— 固定视口会阻止窗口最大化
   - 抹除 `navigator.webdriver`
8. **浏览器路径自适应**：五层探测（环境变量 → 常见安装路径 → PATH → Windows 注册表 → Playwright channel），
   不写死盘符或渠道。

### 站点改版了怎么办

唯一需要改的地方是 **`scripts/dsb/src/site.mjs`**（选择器集中在此）：

```bash
# 1. 定位漂移
node <skill-root>/scripts/dsb/cli.mjs doctor --deep --html --json

# 2. 改 site.mjs 里的选择器
# 3. 跑单测
node scripts/dsb/tests/sanitize.test.mjs
# 4. 发版
```

## 边界

- **低频辅助工具**：每次问答会真实打开一个浏览器窗口（几秒后自动关闭），请按"偶尔咨询"的频率使用，不要批量。
- **不做批量 / 不做并发**：同一时间只跑一个会话。
- **不做 web2api**：只驱动官方网页，不构造私有协议请求、不做逆向代理。
- **不生图 / 生视频 / 生音频**：网页版本身不支持。
- **联网搜索是摘要化的**：要原文引用时用宿主自带的网页抓取能力直接取源页。
- **无 tool call**：它是聊天界面，不会替任何人执行操作。

## 项目结构

```
SKILL.md                给 agent 的说明书（何时用、怎么调、失败怎么办）
README.md               本文件
references/
  install.md            安装、登录策略、更新、卸载
  failure-taxonomy.md   失败码 → 动作（含对用户话术）
  site-map.md           站点交互地图（仅诊断用）
  protocol.md           [DSB] 协作协议
scripts/dsb/
  cli.mjs               命令面 + JSON 契约
  src/browser.mjs       浏览器探测 + 持久化启动 + 登录判定
  src/site.mjs          站点层（选择器、注入、完成判定、抽取）
  src/sanitize.mjs      发送前确定性净化闸门
  src/session.mjs       线程 / 检查点 / 审计
  src/paths.mjs         状态目录布局
  src/logger.mjs        脱敏日志
  tests/sanitize.test.mjs   14 项净化闸门单测
```

运行单测：

```bash
node scripts/dsb/tests/sanitize.test.mjs
```

## 同族项目

三个「网页版大脑」共享同一套机制层（净化闸门、会话、日志、CLI 契约），
但**各自独立仓库、独立 skill、互不依赖**：

| | deepseek-brain | gemini-brain | doubao-brain |
| --- | --- | --- | --- |
| CLI | `dsb` | `gmb` | `dbb` |
| 定位 | 推理 + 联网搜索 | 生图 + 代码 Canvas | 生图 + **生视频** + 音乐/播客 |
| 生图 | ✗ | ✓（2816×1536 原图） | ✓（2048×2048） |
| 生视频 | ✗ | ✗ | ✓（1280×720） |
| 模型可选 | ✗（只有思考/搜索开关） | ✓（Flash-Lite / Flash / Pro） | ✓（快速 / 2.1 Turbo） |
| 登录持久化 | 简单 | **复杂**（需三重保险） | 简单 |

## License

MIT
