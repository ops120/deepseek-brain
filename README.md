# deepseek-brain

把 **DeepSeek 网页版**（统一模型 / 深度思考 / 智能搜索 / 图片与文件分析）当作编码 agent 的
**外部推理大脑**：它出推理与意见，你的 agent 出执行。

- 不用 API key，不做逆向代理 —— 只驱动官方网页。
- 人工登录一次，长期复用；只有网站重弹验证时才再打扰你。
- 发送前有确定性脱敏闸门：私钥整段拒绝、密钥形状脱敏、家目录路径脱敏、尺寸上限。
- 机制全在一个可测试的本地 CLI（`dsb`）里，Skill 只负责判断与汇报。

## 安装

把本仓库 clone 到宿主（Claude Code / Codex / ZCode…）的 skills 目录即可，**无需修改任何路径**：

```bash
git clone <repo-url> ~/.claude/skills/deepseek-brain     # Claude Code
git clone <repo-url> ~/.codex/skills/deepseek-brain      # Codex
git clone <repo-url> ~/.agents/skills/deepseek-brain     # 通用
```

然后对 agent 说：**「用 deepseek-brain 完成首次配置」**——它会装好依赖、打开浏览器让你登录一次。

依赖：Node.js ≥ 20、系统已装 Chrome 或 Edge、能访问 `chat.deepseek.com`（不需要 API key）。

## 使用

直接对 agent 说人话：

- 「用 deepseek 深度思考分析一下这个报错」
- 「让 deepseek 智能搜索查一下 X 的最新版本」
- 「把这段代码发给 deepseek 审一下，按它的建议改」 ← 规划 / 执行 / 复核循环

## 命令面

agent 直接调用，人也可以手跑；全部支持 `--json`。

| 命令 | 作用 |
| --- | --- |
| `dsb setup` / `login` / `logout` | 首次配置 / 重新登录 / 清除登录态 |
| `dsb doctor [--deep]` | 体检（`--deep` 真机探测页面与选择器） |
| `dsb ask --prompt-file f --think on\|off --search on\|off [--attach a,b] [--thread new\|<url>]` | 单次问答 |
| `dsb ask --protocol INIT\|EXECUTED --task <id> --iteration <n>` | 协作循环（PLAN → EXECUTED → DONE） |
| `dsb thread status` / `dsb session get` | 查看线程与进度检查点 |
| `dsb logs [-n 50]` | 查看脱敏日志 |

运行方式：`node <skill-root>/scripts/dsb/cli.mjs <命令>`。

## 结构

```
SKILL.md           给 agent 的说明书：何时用、怎么调、失败怎么办
references/        安装、失败分类与恢复动作、站点地图、[DSB] 协作协议
scripts/dsb/       机制层 CLI（setup/login/doctor/ask/thread/session/logs）
  tests/           单元测试：node scripts/dsb/tests/sanitize.test.mjs
```

## 状态与隐私

- 状态目录：Windows `%LOCALAPPDATA%\deepseek-brain`，macOS / Linux 对应位置；项目目录零残留。
- 登录态存在专用 profile（0700）；cookie 永不导出、永不进日志、永不进 prompt。
- **回答正文默认不落盘**，只记录元数据（requestId、模式、耗时、是否截断）。

## 边界

- 不生成图片 / 音频 / 视频；只做文本推理与网页检索归纳。
- 低频辅助工具：每次问答会真实打开一个浏览器窗口，不适合批量调用。
- 网页版**没有模型选择器**，可控的只有「深度思考」「智能搜索」两个开关。

## License

MIT
