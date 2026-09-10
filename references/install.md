# 安装、首次配置与维护

## 依赖

- Node.js ≥ 20（`node --version` 检查）。
- 网络可达 `https://chat.deepseek.com`。
- 一个 DeepSeek 账号（网页版按账号权益提供统一模型与「深度思考」「智能搜索」开关）。
- **无需 API key。**

## 安装（= 把 skill 放进宿主的 skills 目录）

本仓库根目录就是 skill 目录，clone 或复制过去即可，**无需修改任何路径**：

- Claude Code：`~/.claude/skills/deepseek-brain/`
- Codex：`~/.codex/skills/deepseek-brain/`
- 其他支持 Agent Skills 的宿主：放它约定的 skills 目录，目录名保持 `deepseek-brain`。

```bash
# 示例：按你的宿主替换目标目录
git clone <repo-url> ~/.claude/skills/deepseek-brain
```

## 定位 skill 根

命令里的 `<skill-root>` = `SKILL.md` 所在目录。宿主没有直接给出时，按顺序尝试：

1. 本 skill 的加载路径（通常已在你的上下文中给出）；
2. 常见安装位置：`~/.claude/skills/deepseek-brain`、`~/.codex/skills/deepseek-brain`、`~/.agents/skills/deepseek-brain`；
3. 仍找不到 → 问用户「deepseek-brain 装在哪个目录」。

## 首次配置

```bash
node "<skill-root>/scripts/dsb/cli.mjs" setup
```

它会依次：

1. 检查 Node 与网络；
2. 把 npm 依赖与 Playwright chromium 安装到**状态目录**（不污染 skill 目录）；
3. 打开有头浏览器，**请用户自己登录 DeepSeek**——账号密码 / 扫码 / 短信码全部由用户输入，agent 不接触任何凭证；
4. 冒烟问答一次，确认链路通。

## 登录策略

- 登录状态持久化在状态目录的 `profile/`（0700），之后长期复用，**不再打扰用户**。
- 只有网站**重弹验证**时才再次找用户：登录页重现、会话过期、Cloudflare 人机验证、二次验证、风控挑战。
- 重新登录：`node .../cli.mjs login`；清除登录态：`node .../cli.mjs logout`。
- 共享机器可在 `prefs.json` 设 `loginMode: "ephemeral"`：每次运行临时 profile、必须人工登录。

## 状态目录

- Windows `%LOCALAPPDATA%\deepseek-brain\`；macOS `~/Library/Application Support/deepseek-brain/`；Linux `$XDG_STATE_HOME/deepseek-brain/`（`DSB_STATE_DIR` 可覆盖）。
- 内容：`profile/`（登录态）、`threads/`、`logs/`、`outputs/`、`prefs.json`。
- cookie / storageState **永不**导出到项目目录、**永不**进日志、**永不**进 prompt。

## 更新

```bash
cd <skill-root> && git pull
node scripts/dsb/cli.mjs update-check --force --json
```

选择器会随 DeepSeek 前端漂移；`doctor --deep` 报 `SITE_CHANGED` 时说明需要新版本，拉取最新即可。

## 敏感数据与 `--allow-sensitive`

发送闸门默认拒绝私钥、`.env`、密钥形状内容。确需发送时（**用户明确知情同意**后）：

```bash
node .../cli.mjs ask --prompt-file p.txt --allow-sensitive
```

CLI 会再要求一次显式确认。不要替用户做这个决定，也不要引导用户随手开启。

## 卸载

1. 删除宿主 skills 目录下的 `deepseek-brain/`；
2. 删除状态目录（含登录态与线程记录）。
