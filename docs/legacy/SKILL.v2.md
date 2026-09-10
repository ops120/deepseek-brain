---
name: deepseek-brain
description: 通过 Playwright MCP 浏览器驱动 chat.deepseek.com 网页版聊天，支持 DeepSeek-V3 / DeepSeek-R1、可选联网搜索、文件上传与 PDF 分析。已有 DeepSeek API key 请走 API，纯网页搜索请用 WebSearch。
when_to_use: 用户说「用 deepseek 网页版」「deepseek web」「deepseek 联网搜索」「deepseek R1 深度思考」「deepseek 上传文件」「deepseek 分析 PDF」，或任何本应发到 chat.deepseek.com 而不是当前模型的任务。英文触发：use deepseek / ask deepseek / deepseek R1 / deepseek deep thinking / chat with deepseek / deepseek file upload / deepseek PDF.
argument-hint: "[prompt] [v3|r1]"
allowed-tools: [mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_press_key, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_tabs, mcp__playwright__browser_file_upload, Read]
compatibility: Requires Playwright MCP server (mcp__playwright__*); user must already be logged in to chat.deepseek.com; cross-platform Win/macOS/Linux.
license: MIT
metadata:
  emoji: "🐋"
  source: local
  version: 2
---

# deepseek-brain — DeepSeek 网页版咨询 skill

通过 Playwright MCP 浏览器（`mcp__playwright__*`）驱动 **https://chat.deepseek.com**。假定用户已登录；未登录时把控制权交回用户手动登录，agent 不输入凭证。

开工前先确认：当前会话的工具列表里必须有 `mcp__playwright__*` 系列工具（未配置 Playwright MCP 服务器时它们不存在）。缺依赖就把这一点告诉用户、等配置好再来，不要拿其它浏览器工具硬套本文步骤。

## 何时调用

**全部满足**时启用：

- 用户明确要 **DeepSeek 网页版**（中英文触发都行）。
- 用户想要的模型当前会话没有（R1 推理、更强的中文、更长上下文等）。
- 可接受把 prompt 发到第三方站点。

**跳过**，如果：

- 用户有 DeepSeek API key、要做脚本化/批处理 → 直接打 API。
- 用户只要「搜个网页」→ 用 `WebSearch`。
- 当前 provider 已有推理模型 → 直接用那个。

## 网页版模型与模式

DeepSeek 网页版的两个开关都在**输入框工具栏**（不是左上角下拉）：

| 控件                   | 作用                                       | 何时选                                       |
| ---------------------- | ------------------------------------------ | -------------------------------------------- |
| **深度思考 (R1)** 按钮 | 切换到 R1 推理模型（亮起 = 启用）          | 数学、逻辑、多步推理、调试代码               |
| **联网搜索** 按钮      | 给上下文加实时网页结果（V3 与 R1 都可用）  | 需要当下信息、新闻、价格、引用的场景         |

切换 R1 与否都会保留当前会话；不要为了切模型而开新对话。开关状态以 `browser_snapshot` 为准，不要靠推断。

## 工作流

### 1. 打开 / 校验会话

```python
mcp__playwright__browser_navigate(url="https://chat.deepseek.com/")
```

`browser_snapshot` 看页面：应看到聊天输入框。若看到 **登录 / Log in** 按钮或二维码：

- **停下来**。不输入手机号 / 密码 / 短信码。
- 告诉用户：「DeepSeek 网页版需要登录，请在浏览器里登录一下，登录好叫我。」 然后等，**不轮询**。

若看到 Cloudflare 验证页（"Checking your browser..." / 人机验证图）：

- **停下来**。点不动，agent 也无能为力。
- 告诉用户：「碰到 Cloudflare 验证，请在浏览器里手动过一下，过好叫我。」 然后等。

### 2. 开新对话

点 **新建对话**（或按快捷键）避免旧上下文污染。新建按钮的 ref 偶尔变，每次用 `browser_snapshot` 取确切 ref。

### 3. 选模式（深度思考 / 联网搜索）

- 在输入框工具栏点 **深度思考** 按钮 → 启用 R1（再次点关闭）。
- 若用户要实时信息，再点 **联网搜索** 按钮启用。
- 两个开关状态都要从 `browser_snapshot` 确认。

### 4. 附加文件（若有）

带文件时**先**点 📎 / 回形针按钮，然后 `browser_file_upload` 传 **本地绝对路径**。网页版允许：图片、PDF、txt、md、代码文件（单次合计 ≤ 约 50 MB）。等上传完成（输入框旁出现文件名）再进入步骤 5。

若无文件，跳过此步。

### 5. 输入 + 发送

在底部多行 `textarea` 上用 `browser_type`。**二选一**提交：点发送按钮，或 `browser_press_key` `Enter`，不两样都做。

长 prompt（> 约 3000 字）输入框可能装不下。DeepSeek 的 composer 是 React 受控输入，直接设 `textarea.value` 会被下次 render 冲掉。正确做法：用原生 setter 写值，再派发事件：

```javascript
const ta = document.querySelector('textarea');                              // 取输入框 ref
const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
setter.call(ta, text);                                                        // 写值
ta.dispatchEvent(new Event('input', { bubbles: true }));                    // 通知 React
```

超长 prompt（> 50 KB）分块粘贴，每块写完后短暂 sleep，避免 React debouncer 丢帧。

### 6. 等流式输出

**不要**等答案的尾部短语——答案还没生成，你无从预测。改为等**发送按钮恢复**：

```python
# DeepSeek 生成中时，发送按钮变成「停止生成」方块图标；流式结束就恢复成发送图标
browser_wait_for(textGone="停止生成", time=120)   # R1 难题可放宽到 120 s
```

兜底：若按钮状态没翻回，再 `wait_for(time=30)` 给一段额外缓冲；然后 `browser_snapshot` 取最后一条助手回合。

### 7. 读取答案

用 `browser_snapshot` 取整个聊天面板，从快照中**人工选出最后一条助手消息**——DeepSeek 用哈希 CSS 类名（`.message-content` 这种稳定选择器不存在），不要硬编码 selector。读取文本用快照里的可访问性文本（accessibility text），不要去 `innerHTML` / `innerText` 抓 DOM 字符串。

### 8. 多轮对话

**每轮新用户消息前都重新 `browser_snapshot` 一次**（只 snapshot 输入框所在区域即可，不必整页）。`browser_type` 需要当前 ref，旧的引用在流式渲染后已失效——直接用旧 ref 会抛 stale-ref 错误。拿到新 ref 后再用 `browser_type` 输入，然后回到步骤 6。

## 复用浏览器会话

`mcp__playwright__browser_tabs({action: "list"})` 查现有标签页。已有 chat.deepseek.com 标签页时**切过去**（`browser_tabs {action: "select", index: N}`），不要新开——某些浏览器重新打开站点会强制重登。

会话中段如果被踢出登录（页面突然跳到登录页）：

- **停下来**。不要尝试重新登录。
- 告诉用户：「会话好像过期了，请在浏览器里重新登录一下。」

## 限制与坑

- **网页版不生图、不生音频、不生视频**——别承诺做不到的事。
- **速率限制**：DeepSeek 公开的精确额度随账号等级变化。看到「请求过于频繁」就停，告诉用户。
- **联网搜索会「摘要化」**：结果是归纳后的，不是原文逐字引用。用户要原话时改用 `WebFetch` 直接抓源页。
- **无 tool call / function calling**——它就是聊天界面。要工具调用走 API。
- **隐私**：prompt 发到 DeepSeek 服务器。除非用户明确同意，不要把密钥、token、仅本地的数据贴进去。
- **流式 + 慢网**：snapshot 可能抓到截断答案。尾巴看着不全就再 `wait_for` 加长 `time`。

## 输出约定

把答案带回到当前对话时：

1. **逐字引用**答案（保留中文标点、代码围栏、markdown）。
2. 末尾加一行 `来源：chat.deepseek.com / V3|R1 / 联网搜索：开|关` 标签。
3. 与本地模型冲突时**把冲突摆出来**，不默默选边。

## 速查——最精简调用序列

```
navigate("https://chat.deepseek.com/")            # 打开
snapshot()                                        # 校验已登录 / 无 Cloudflare
click(新建对话按钮)                                # 开新线程
click(深度思考按钮)                                # 可选：开 R1
click(联网搜索按钮)                                # 可选：开搜索
if 文件: click(📎) → file_upload(本地路径)         # 文件先于输入
snapshot(composer 区域)                            # 取输入框 ref
type(输入框, prompt)                              # 输入
click(发送)                                        # 提交
wait_for(textGone="停止生成", time=120)           # 等流式结束（关键！）
snapshot()                                        # 抓最后一条助手回合（不要硬编码 selector）
# 多轮：每轮新消息前都 snapshot 重取 ref，再 type
```

## 修复记录（v2）

对照官方 Claude Code Skills 规范复核后的关键修改：

- **C1**：步骤 6 改用 `wait_for(textGone="停止生成")`，不再等"答案尾部短语"。
- **C2**：步骤 8 强调多轮每轮重 snapshot，避免 stale ref。
- **C3**：步骤 7 删掉伪造的 `.message-content` 选择器，改用 snapshot 的可访问性文本。
- **C4**：步骤 4（文件上传）移到步骤 5（输入发送）之前。
- **I1**：表格里说清两个开关都在输入框工具栏，不在左上角。
- **I2**：去掉「中途切换会清空对话」的断言。
- **I3**：去掉硬编码的「每天 50 条」。
- **I4**：新增 Cloudflare / 会话过期两条失败路径。
- **I5**：长 prompt 改用 React 原生 setter trick，给出代码片段。
- **I6**：`when_to_use` 补上英文触发词。
- **I7**：全文统一用「」中文引号；`compatibility` 保留英文（API/平台标识）。
- **N1**：新增 `argument-hint`。
- **N2**：新增 `license: MIT`。
- **N4**：`metadata` 改块格式。