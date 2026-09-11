# 失败分类与恢复动作

`dsb` 的所有失败都是可枚举的：`{ok:false, reason, message?, retryAfterMs?, threadUrl?}`。
按下表处理；需要用户介入时**一次只给一个动作**。

| reason | 含义 | 动作 | 对用户说 |
| --- | --- | --- | --- |
| `LOGIN_REQUIRED` | 网站重弹登录 / 会话过期 | 停；让用户在已打开的有头浏览器完成验证；「好了」后重试 | 「DeepSeek 要求重新验证，请在打开的浏览器里完成，好了叫我。」 |
| `HUMAN_VERIFICATION_REQUIRED` | 人机验证 | 同上；随后 `doctor --deep` 复检 | 「碰到人机验证，请在浏览器里手动过一下。」 |
| `RATE_LIMITED` | 限流 | 停；按 `retryAfterMs` 退避；可建议稍后再试 | 「DeepSeek 提示请求过于频繁，建议 N 分钟后再试。」 |
| `COMPOSER_NOT_FOUND` | 输入框定位失败 | 先 `doctor --deep`；多半是前端改版 → 按 `SITE_CHANGED` 处理 | 不要把 DOM 细节讲给用户 |
| `SITE_CHANGED` | 选择器漂移 | **版本问题**：`doctor --deep` 定位漂移项；告知维护者修 `scripts/dsb/src/site/selectors.ts` 并发版；不要现场硬试 DOM | 「DeepSeek 页面改版了，需要更新 deepseek-brain。」 |
| `SEND_FAILED` | 发送失败 | 重试一次；仍失败按 `SITE_CHANGED` | — |
| `STREAM_STALLED` | 流式停滞 / 超时 | 已捕获文本标注「可能截断」；可重试一次；仍失败交用户 | 「回答可能不完整。」 |
| `ANSWER_EMPTY` | 空回答 | 新线程重试一次；仍空交用户 | — |
| `UPLOAD_REJECTED` | 附件被拒 | 检查类型 / 大小（合计 ≤ 50 MB）；换格式或压缩 | 「这个文件网页版收不了，换一个或压缩后再试。」 |
| `THREAD_LOST` | 线程 404 / 丢失 | 新线程重问；`[DSB]` 模式则从 checkpoint 发 HANDOFF | — |
| `LOCKED` | 另一任务占用浏览器 | 等；或问用户是否停掉另一个任务 | 「有另一个任务正在使用 DeepSeek 浏览器。」 |
| `DEPENDENCY_MISSING` | 依赖缺失 | 自愈：`setup`（装 chromium 等） | — |
| `SENSITIVE_BLOCKED` | 闸门拦截 | 移除敏感内容或改用摘要；确需发送必须用户明确同意 | 「内容里含敏感信息，已被拦截；需要你确认才能发送。」 |
| `PAYLOAD_TOO_LARGE` | 正文超过 50 KB | 先摘要或分片；确需整段发送加 `--allow-large`（上限 200 KB） | 「内容太长（超过 50 KB），我先压缩一下再发。」 |

## 硬规则

- **绝不**把失败伪装成结果；**绝不**静默降级模式（深度思考 / 智能搜索）后不告知。
- **绝不**为了绕过失败去手工操作 DOM——机制只存在于 CLI。
- 重试有上限：同类失败最多 2 次，之后交用户或上报维护者。
