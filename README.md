# deepseek-brain

把 **DeepSeek 网页版**当作编码 agent 的**外部大脑**：它出推理与意见，你的 agent 出执行。
不需要 API key，不做逆向代理 —— 只驱动官方网页。

- 由本地确定性 CLI（`dsb`）驱动，Agent 只负责调用与判断
- 人工登录一次后**通常**可长期复用；网站重弹验证或会话过期时才再打扰你（CLI 会停下等人，不硬试）
- 发送前有确定性脱敏闸门（私钥整段拒绝、密钥形状脱敏、家目录路径脱敏、尺寸上限）
- 支持 `[DSB]` 协作协议：让 DeepSeek 做 PLAN → 你执行 → 它 REVIEW 的循环

> ⚠️ **合规与账号风险**：本项目通过浏览器自动化驱动 DeepSeek 官方网页版，
> 可能不符合其服务条款，存在账号被限流、弹人机验证甚至封禁的风险。
> 请自行评估并遵守平台条款，**风险自负**；仅供低频个人使用，不要批量滥用。

## 目录

- [能力](#能力)
- [安装](#安装)
- [快速上手](#快速上手)
- [自然语言驱动举例](#自然语言驱动举例)
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
| **文件 / 图片分析** | 上传文件或图片让 DeepSeek 分析（支持逗号分隔多个路径） | `--attach a.pdf,b.png` |
| **长文本** | 单次正文 ≤ 50 KB（按 UTF-8 字节计）；超限报 `PAYLOAD_TOO_LARGE`，**需你手动摘要或拆成多次调用（CLI 不自动分片）** | `--allow-large` 放宽到 200 KB |
| **多轮对话** | 同一线程复用上下文 | 默认复用工作区当前线程 |
| **协作循环** | 规划 / 执行 / 复核的迭代协议 | 如 `--protocol INIT`、`--protocol EXECUTED` 等，完整枚举见命令面 |

> **网页版没有模型选择器**。可控的只有「深度思考」「智能搜索」两个开关，CLI 也不暴露模型选择，
> 回答由网页版当前模式对应的模型生成（具体以站点为准）。因此 CLI **不提供** `--model`，
> 也不会声称"给你用了某某模型"。

**不支持**：生图、生视频、生音频、tool call / function calling（它就是聊天界面）。

## 安装

### 前置要求

- **Node.js ≥ 20**（`node --version` 检查），含 npm —— 首次配置要把 `playwright-core` 装到状态目录
- 系统已装 **Chrome / Edge / Brave / Chromium** 任一（自动探测，不下载 Chromium）
- 能访问 `chat.deepseek.com` 的**浏览器**（Node 直连可能因 TLS/代理失败，不影响使用）
- 一个 DeepSeek 账号（**无需 API key**）
- **需要图形界面**：整个工具依赖有头浏览器（首次配置要请你本人登录，之后每次问答也会真实打开窗口），纯 SSH / 容器环境**无法使用**

### 作为 Skill 安装

本仓库根目录就是 skill 目录，clone 到宿主的 skills 目录即可，**仓库文件内无硬编码路径**
（shell 里仍需按下一节设置 `SKILL_ROOT` 或使用完整 `node "..."` 路径才能调用）。
目标目录不存在时先建父目录（`git clone` 不会自动创建）：

```bash
mkdir -p ~/.claude/skills ~/.codex/skills ~/.agents/skills   # 已存在则无副作用
# Windows cmd（三个父目录一次建好，REM 为注释）:
#   mkdir "%USERPROFILE%\.claude\skills" "%USERPROFILE%\.codex\skills" "%USERPROFILE%\.agents\skills"
# PowerShell:
#   "$env:USERPROFILE\.claude\skills","$env:USERPROFILE\.codex\skills","$env:USERPROFILE\.agents\skills" | ForEach-Object { mkdir $_ -Force }

# 三条命令按你的宿主任选其一，不要全都执行
git clone https://github.com/ops120/deepseek-brain ~/.claude/skills/deepseek-brain     # Claude Code
git clone https://github.com/ops120/deepseek-brain ~/.codex/skills/deepseek-brain      # Codex
git clone https://github.com/ops120/deepseek-brain ~/.agents/skills/deepseek-brain     # 通用 / ZCode
```

> Windows 的 cmd / PowerShell 不展开 `~`，请改用绝对路径，例如：
> ```bat
> :: cmd
> git clone https://github.com/ops120/deepseek-brain "%USERPROFILE%\.agents\skills\deepseek-brain"
> ```
> ```powershell
> # PowerShell
> git clone https://github.com/ops120/deepseek-brain "$env:USERPROFILE\.agents\skills\deepseek-brain"
> ```
> 目标目录已存在时 `git clone` 会失败：改用 `git -C <目录> pull` 更新，或先删掉旧目录。

装好后对 agent 说：**「用 deepseek-brain 完成首次配置」**。

> **关于命令写法（重要）**：本文档里的 `dsb <命令>` 是**文档简写**，并非已安装的命令，
> 等价于 `node "$SKILL_ROOT/scripts/dsb/cli.mjs" <命令>`，
> 其中 `SKILL_ROOT` 就是你 clone 下来的仓库目录。
>
> **推荐先设变量再配别名**（路径按你的实际安装位置改）：
> ```bash
> # Claude Code：SKILL_ROOT="$HOME/.claude/skills/deepseek-brain"
> # Codex：      SKILL_ROOT="$HOME/.codex/skills/deepseek-brain"
> # 通用/ZCode： SKILL_ROOT="$HOME/.agents/skills/deepseek-brain"
> SKILL_ROOT="$HOME/.agents/skills/deepseek-brain"   # ← 改成你实际用的那个
> export SKILL_ROOT
> alias dsb='node "$SKILL_ROOT/scripts/dsb/cli.mjs"'
> ```
> 不配别名也可以，把示例里的 `dsb` 整体替换成 `node "$SKILL_ROOT/scripts/dsb/cli.mjs"`。
> 想长期生效就把这几行写进 `~/.bashrc` / `~/.zshrc`。
>
> **Windows 用户注意**：cmd / PowerShell **不展开 `$SKILL_ROOT` 这种 bash 变量**，也没有 `alias`。
> ```bat
> REM cmd：直接用完整路径（换成你的实际安装位置）
> node "%USERPROFILE%\.agents\skills\deepseek-brain\scripts\dsb\cli.mjs" doctor --json
> ```
> ```powershell
> # PowerShell：可先设变量，同一会话内后续命令都能用
> $SKILL_ROOT = "$env:USERPROFILE\.agents\skills\deepseek-brain"
> node "$SKILL_ROOT\scripts\dsb\cli.mjs" doctor --json
> ```
> 写进 PowerShell 的 `$PROFILE` 即可长期生效。

### 首次配置做了什么

```bash
node "$SKILL_ROOT/scripts/dsb/cli.mjs" setup
```

1. 检查 Node 版本与系统浏览器
2. 把 `playwright-core` 装到**状态目录**（不污染 skill 目录）
3. 打开有头浏览器，**请你本人登录**（账号密码 / 扫码，agent 不接触凭证）
4. 冒烟验证并保存登录态

> **登录策略**：登录一次通常长期有效。之后只有网站**重弹验证**（登录页重现 / 会话过期 / 人机验证）时才需要你介入，
> CLI 会返回 `LOGIN_REQUIRED` 并停下，不会自作主张。

## 快速上手

> **以下命令假定你已按安装章节设置 `SKILL_ROOT`**（或已配好别名）；
> 没设过就直接复制会因变量为空而报错，请先把占位路径换成你的实际安装目录。

```bash
# 体检（建议每次任务前跑一次；--deep 才会真机探测并检查登录态）
node "$SKILL_ROOT/scripts/dsb/cli.mjs" doctor --json

# 写检查点（session set 的完整形态；protocol-state / waiting-for 只接受枚举值）
#   --protocol-state: INIT | PLAN_RECEIVED | EXECUTING | EXECUTED_LOCAL | EXECUTED_SENT | DONE | BLOCKED
#   --waiting-for:    none | BRAIN_PLAN | BRAIN_REVIEW | USER
node "$SKILL_ROOT/scripts/dsb/cli.mjs" session set   --protocol-state PLAN_RECEIVED --waiting-for none --next-step "execute PLAN" --json

# 普通问答（长 prompt 先写临时文件）
node "$SKILL_ROOT/scripts/dsb/cli.mjs" ask \
  --prompt-file ./question.txt --json

# 开深度思考 + 智能搜索
node "$SKILL_ROOT/scripts/dsb/cli.mjs" ask \
  --prompt "分析这个报错的原因" --think on --search on --json

# 带附件分析
node "$SKILL_ROOT/scripts/dsb/cli.mjs" ask \
  --prompt "总结这份文档的要点" --attach ./report.pdf --json

# 新开线程（默认复用工作区当前线程）
node "$SKILL_ROOT/scripts/dsb/cli.mjs" ask --prompt "..." --thread new --json
```

对 agent 说人话也一样：**「用 deepseek 深度思考分析一下这个报错」**、**「问问 deepseek 这个设计有什么问题」**。

## 自然语言驱动举例

**不需要背命令**——直接对 agent 说人话就行。本 skill 的 `SKILL.md` 里声明了触发词，
agent 认出后会自己去调 `dsb`（先体检、再提问、失败按可枚举失败码处理），你只管描述需求。

| 你想做什么 | 直接对 agent 说 |
| --- | --- |
| 深度推理 / 疑难调试 | 「用 deepseek 深度思考分析一下这个报错」「让 deepseek 想想这段代码为什么会死锁」 |
| 查实时信息（版本 / 价格 / 新闻） | 「让 deepseek 联网查一下这个库的最新版本」 |
| 第三方审查 / 独立意见 | 「问问 deepseek 这个设计有什么问题」「让 deepseek 审一遍这段 SQL」 |
| 分析文件 / PDF / 图片 | 「用 deepseek 分析这份 PDF 的要点」（agent 会自动用 `--attach` 传文件） |
| 多轮追问 | 「再让 deepseek 展开讲讲第二点」（复用同一线程，不用重复给背景） |
| 规划 → 执行 → 复核 | 「让 deepseek 先出方案，你按方案改，改完让它复核」 |

使用要点：

- **点名最稳**：话里带上「deepseek」或「dsb」，agent 就会走本 skill；也支持英文触发
  （`use deepseek` / `ask deepseek` / `deepseek R1` / `deepseek deep thinking` / `deepseek web search` /
  `second opinion from deepseek` / `deepseek file upload` / `deepseek PDF`）。
- **首次要先配置**：需要先完成安装与首次登录（见 [安装](#安装) 章节），之后基本不用再管。
- **不是「搜索」而是「咨询」**：本 skill 的硬规则要求 agent 走 CLI 而不是自己的宿主搜索；
  如果它用搜索糊弄你，就说「用 deepseek-brain 的 CLI 做，不要用你自己的搜索」。
- **失败会如实上报**：agent 会告诉你 `reason` 与建议动作，不会把失败包装成结果。

## 命令面

`--json`（机器可读）与 `--debug`（保存页面 HTML 便于排障）为全局选项；
`--keep-open`（保留浏览器窗口）只对会打开浏览器的命令（`ask` / `setup` / `login`，以及带 `--deep` 的 `doctor`）有意义，
对 `logout` / `logs` / `session` / `thread` / `update-check` 这类纯本地命令无效。
各命令的完整参数以 `--help` 为准。

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `setup` | 首次配置：装依赖 → 打开浏览器 → 人工登录 | `--timeout <ms>` |
| `login` | 重新登录（登录态失效时用） | `--timeout <ms>` |
| `logout` | 清除登录态（删除 `profile/` 目录） | — |
| `doctor` | 体检 | `--deep`（真机探测页面/选择器；**同时才会检查登录态**）、`--html`（存页面 HTML，doctor 专有；全局的 `--debug` 也会存页面对比排障） |
| `ask` | 提问 | `--prompt` / `--prompt-file`、`--think on\|off`、`--search on\|off`、`--attach`、`--thread new`（省略则复用当前线程）、`--protocol <状态>`、`--task <id>`、`--iteration <n>`、`--timeout <ms>`、`--allow-sensitive`、`--allow-large` |
| `thread` | 线程管理 | `status` / `use <url>` / `new` |
| `session` | 工作区级线程与检查点 | `get`；`set --protocol-state <状态> --waiting-for <值> --next-step "..."`
  （`--waiting-for`: `none` / `BRAIN_PLAN` / `BRAIN_REVIEW` / `USER`） |
| `logs` | 查看脱敏日志 | `-n <行数>`、`--verbose` |
| `update-check` | 检查更新 | `--force` |

> **注意 `--protocol` 与 `--protocol-state` 是两套不同的枚举，别混用**：
>
> | 参数 | 用在哪 | 合法取值 |
> | --- | --- | --- |
> | `--protocol <状态>` | `ask` —— 发协议信封给 DeepSeek | `INIT` / `PLAN` / `EXECUTING` / `EXECUTED` / `REVIEW` / `HANDOFF` |
> | `--protocol-state <状态>` | `session set` —— 写本地检查点 | `INIT` / `PLAN_RECEIVED` / `EXECUTING` / `EXECUTED_LOCAL` / `EXECUTED_SENT` / `DONE` / `BLOCKED` |
>
> 前者决定"这轮问什么"，后者只记录"本地做到哪了"；传错值会被 `INVALID_ARGUMENTS` 拒绝。

更新与卸载步骤见 [references/install.md](references/install.md)（更新 = `git pull`；
卸载 = 删 skill 目录 + 删状态目录）。

运行方式：`node "$SKILL_ROOT/scripts/dsb/cli.mjs" <命令>`。
> ⚠️ **`--allow-sensitive` 是危险开关**：它会关闭除「私钥块拒绝」外的**全部脱敏**
> （密钥形状、家目录路径等按原文发往站点）。仅在用户明确知情同意时使用，不要默认开启。


### doctor 检查项

| 检查项 | 含义 |
| --- | --- |
| `node` | Node 版本 ≥ 20 |
| `deps` | `playwright-core` 已装到状态目录 |
| `browser` | 找到可用的 Chromium 系浏览器（并显示走的是哪条探测路径） |
| `stateDir` | 状态目录可写 |
| `network` | 能访问站点（Node 直连失败不算死，会注明） |
| `login` | **仅 `--deep` 时**：cookie 里有登录标志 |
| `deep` | **仅 `--deep` 时**：真机探测页面状态与两个开关（深度思考 / 智能搜索），并截图 |

## 返回值契约

成功：

```json
{
  "ok": true,
  "requestId": "dsb_ab12",
  "threadUrl": "https://chat.deepseek.com/a/chat/s/xxxx",
  "modes": { "requested": { "think": true, "search": true },
             "confirmed": { "think": true, "search": true } },
  "text": "……逐字答案……",
  "citations": [{ "title": "来源标题", "url": "https://…" }],
  "truncated": false,
  "elapsedMs": 41000
}
```

**字段说明**：

- `modes.requested` —— 你要求的开关状态
- `modes.confirmed` —— **根据回答内证据推断**的生效状态（不是站点 UI/请求层面的权威确认）：
  - `think` → 本次发送前后推理块数量是否增加（用差值判定，避免历史推理块误判）
  - `search` → 回答里是否带引用来源 / 是否出现「搜索到 N 个网页」
  - **两者不一致时必须在回复里标注**，不要默认生效
- `truncated` —— `true` 表示可能被截断（超时或流式停滞），需要如实告知用户
- `citations` —— 联网搜索的引用来源（标题 + URL）

失败（**判别联合**，`reason` 可枚举）：

```json
{ "ok": false, "reason": "RATE_LIMITED", "message": "…", "retryAfterMs": 300000 }
```

## 协作协议（`[DSB]`）

让 DeepSeek 当「规划与审查大脑」，**执行权始终在本地 agent 手里**。
下面示例用 `dsb` 简写，未配置别名时请展开为 `node "$SKILL_ROOT/scripts/dsb/cli.mjs"`：

```bash
# ① 起循环
dsb ask --protocol INIT --task dsb_f81a --iteration 0 --prompt-file goal.txt --json
#    → 看 protocol.reply.state：PLAN = 拿到方案，继续；BLOCKED = 停下问用户

# ② 你自己执行（用你的工具链，它不微管理）

# ③ 汇报（正文只写元数据：改了哪些文件、测试结果；不贴 diff / 不贴日志）
dsb ask --protocol EXECUTED --iteration 1 --prompt-file report.txt --json
#    → DONE = 结束 | PLAN = 还有下一轮 | BLOCKED = 停下

# ④ 复核（需要对方复盘时用 REVIEW；回复状态同样解析为 DONE / PLAN / BLOCKED）
dsb ask --protocol REVIEW --iteration 2 --prompt-file review-request.txt --json

# 查进度（checkpoint 自动落盘，用 session get 读取；thread status 看线程）
dsb session get --json
dsb thread status --json
```

- 信封由 CLI 自动封装，回复状态由代码解析（不靠 agent 读文本判断）
- `--task` / `--iteration` 省略时会自动沿用工作区 session 里的值（见 [references/protocol.md](references/protocol.md)）
- 建议同一任务不超过 12 轮，到顶暂停问用户（这是给 agent 的使用约定，不是 CLI 参数）
- 线程丢失 → 依据 session checkpoint 生成 HANDOFF 简报，**不粘贴日志或 diff**
- 协议模式下 `ask` 的返回值会多一个 `protocol` 字段：

```json
{
  "ok": true,
  "requestId": "dsb_ab12",
  "protocol": {
    "sent": "EXECUTED",
    "taskId": "dsb_f81a",
    "iteration": 1,
    "reply": { "state": "DONE", "taskId": "dsb_f81a", "iteration": 1 }
  },
  "text": "……逐字答案……"
}
```

> `protocol.sent` 是本次发出的状态；`protocol.reply` 是对方回复的解析结果
> （对象，含 `state` / `taskId` / `iteration`），其中 `state` 取值为 `PLAN` / `DONE` / `BLOCKED`；
> 未走协议或对方回复里没有 `STATE:` 时 `reply` 为 `null`。
> 完整字段要求见 [references/protocol.md](references/protocol.md)。

## 失败处理

`reason` 是**可枚举的**，每个都有对应动作（完整表见 [references/failure-taxonomy.md](references/failure-taxonomy.md)）：

| reason | 含义 | 动作 |
| --- | --- | --- |
| `LOGIN_REQUIRED` | 登录失效 | 停；让用户登录，一次一个动作 |
| `HUMAN_VERIFICATION_REQUIRED` | 人机验证 | 停；用户手动过盾后重试 |
| `RATE_LIMITED` | 限流 | 停；按 `retryAfterMs` 退避 |
| `COMPOSER_NOT_FOUND` / `SITE_CHANGED` | 站点改版、选择器漂移 | **版本问题**：先 `doctor --deep` 确认；普通用户提 issue 等上游发版即可，`scripts/dsb/src/site.mjs` 的修改面向维护者（不要现场硬试 DOM） |
| `SEND_FAILED` | 发送失败 | 重试一次 |
| `STREAM_STALLED` | 流式停滞 / 超时 | 标注「可能截断」；可重试一次 |
| `ANSWER_EMPTY` | 空回答 | 新线程重试一次 |
| `UPLOAD_REJECTED` | 附件被拒 | 检查类型 / 大小（网页端限制由 DeepSeek 决定，CLI 不预设白名单） |
| `THREAD_LOST` | 线程 404 | 新线程重问（或 HANDOFF） |
| `LOCKED` | 浏览器被占用 | 等，或问用户 |
| `INVALID_ARGUMENTS` | 参数值非法（如枚举值写错） | 按报错信息改正；常见于 `--protocol` 与 `--protocol-state` 混用 |
| `DEPENDENCY_MISSING` | 依赖缺失 | `setup` 自愈 |
| `SENSITIVE_BLOCKED` | 闸门拦截 | 移除敏感内容；确需发送须用户明确同意后加 `--allow-sensitive`——它会**关闭全部脱敏**（密钥形状、家目录路径等按原文发往站点），仅保留私钥块仍拒绝，请务必确认用户知情 |
| `PAYLOAD_TOO_LARGE` | 正文超 50 KB | 摘要或分片；`--allow-large` 放宽到 200 KB |

遇到站点改版等问题，可在 <https://github.com/ops120/deepseek-brain/issues> 反馈。

**硬规则**：绝不把失败伪装成结果；绝不静默降级后不告知；同类失败最多重试 2 次
（**所有自动重试合计**最多 2 次，表中标注「重试一次」的也占用该额度）。

## 状态、缓存与隐私

状态目录（`DSB_STATE_DIR` 可覆盖）：

```
Windows  %LOCALAPPDATA%\deepseek-brain\
macOS    ~/Library/Application Support/deepseek-brain/
Linux    $XDG_STATE_HOME/deepseek-brain/   （该变量未设置时通常为 ~/.local/state/deepseek-brain/）
```

| 内容 | 说明 |
| --- | --- |
| `deps/` | `playwright-core`（不污染 skill 目录） |
| `profile/` | 持久化浏览器 profile —— **登录态的唯一来源**（dsb 不额外导出 storage-state） |
| `threads/<workspaceId>.json` | 工作区级线程与检查点 |
| `outputs/<workspaceId>.jsonl` | 审计：每次问答一行**元数据**（requestId、模式、耗时、是否截断） |
| `logs/dsb.log` | 脱敏日志（`dsb logs` 查看） |
| `debug/` | `--debug`、`doctor --html` 或失败时保存的页面 HTML / 截图 —— ⚠️ **可能含回答正文与你的输入，未脱敏**，排障后建议删除；**不要直接上传到公开 issue** |

**隐私要点**：

- 状态目录权限 `0700`、文件 `0600`（**仅 Unix/macOS 生效**；Windows 上依赖用户目录 ACL，
  通常仅当前用户可读，具体以你的 ACL 配置为准）
- **不要把状态目录同步 / 备份 / 分享到云盘或 git** —— 里面的 `profile/` 含登录态
- **回答正文默认不落盘**，只记录元数据（例外：`--debug` 或失败时保存的 `debug/` 快照会含未脱敏正文，排障后请删除）
- cookie **永不**导出到项目目录、**永不**进日志、**永不**进 prompt
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
   用原生 setter + `input` 事件，并按 **8000 字符分片**写入（避免 React debouncer 丢帧）。
   ⚠️ 注意区分两件事：
   - **净化闸门**：正文超过 50 KB **直接拒绝**（`PAYLOAD_TOO_LARGE`），**不会自动分片**，
     需你先摘要或拆成多次调用；`--allow-large` 把上限放宽到 200 KB
   - **注入分片**：对**已通过闸门**的文本，写入时按 8000 字符分批，
     纯属编辑器写入机制，与限额无关
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

**普通用户**：跑 `doctor --deep --json` 确认是选择器漂移（报 `SITE_CHANGED` / `COMPOSER_NOT_FOUND`）后，
提 issue 等上游发版即可，不需要自己改代码。

**维护者**：站点层改动通常只需改 **`scripts/dsb/src/site.mjs`**（选择器集中在此）：

```bash
# 1. 定位漂移（在 skill 根目录执行）
node "$SKILL_ROOT/scripts/dsb/cli.mjs" doctor --deep --html --json

# 2. 改 scripts/dsb/src/site.mjs 里的选择器
# 3. 验证：改完必须重跑 doctor --deep 确认真机探测通过（这才是站点层的主要验证手段）
node "$SKILL_ROOT/scripts/dsb/cli.mjs" doctor --deep --json
node "$SKILL_ROOT/scripts/dsb/tests/sanitize.test.mjs"   # 仅覆盖脱敏/限额，与选择器无关，作回归用
# 4. 发版
```

## 边界

- **低频辅助工具**：每次问答会真实打开一个浏览器窗口，用完自动关闭。普通问答几秒到几十秒，
  请按"偶尔咨询"的频率使用，不要批量。
- **不做批量 / 不做并发**：同一时间只跑一个会话。
- **不做 web2api**：只在本机驱动官方网页，不逆向私有协议、不做 HTTP 代理、不对外暴露接口。
- **不生图 / 生视频 / 生音频**：网页版本身不支持。
- **联网搜索是摘要化的**：要原文引用时用宿主自带的网页抓取能力直接取源页。
- **无 tool call**：它是聊天界面，不会替任何人执行操作。
- **合规风险**：自动化驱动网页版可能违反平台条款，存在限流/验证/封号风险，详见文首警告。

## 项目结构

```
LICENSE                 MIT 许可证
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

运行单测（需在 skill 根目录下执行，或把路径换成绝对路径）：

```bash
node "$SKILL_ROOT/scripts/dsb/tests/sanitize.test.mjs"
```

## 同族项目

三个「网页版大脑」共享同一套机制层（净化闸门、会话、日志、CLI 契约），
但**各自独立仓库、独立 skill、互不依赖**：

| | deepseek-brain | gemini-brain | doubao-brain |
| --- | --- | --- | --- |
| CLI（均为文档简写，实际入口是 `node <仓库>/scripts/<cli>/cli.mjs`） | `dsb` | `gmb` | `dbb` |

> 仅 deepseek-brain 无模型选择（网页版没有模型选择器）；他仓的模型与能力以各自 README 为准。
| 定位 | 推理 + 联网搜索 | 生图 + 代码 Canvas | 生图 + **生视频** + 音乐/播客 |
| 生图 | ✗ | ✓（2816×1536 原图） | ✓（2048×2048） |
| 生视频 | ✗ | ✗ | ✓（1280×720） |
| 模型可选 | ✗（只有思考/搜索开关） | ✓（Flash-Lite / Flash / Pro） | ✓（快速 / 2.1 Turbo） |
| 登录持久化 | 简单 | **复杂**（需三重保险） | 简单 |

> 上表涉及他仓的能力、分辨率与模型档位，仅供参考，**以各自仓库的最新 README 为准**。

## 许可证

本项目基于 MIT License 开源，完整条款见 [LICENSE](LICENSE)。

## 社区

本项目在 [LINUX DO](https://linux.do/) 社区进行开源推广，感谢社区佬友的交流、反馈与建议。
