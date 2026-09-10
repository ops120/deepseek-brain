# [DSB] 规划 / 审查协作协议（可选，实验性）

用途：让 DeepSeek 当「规划与审查大脑」，本地 agent 保留全部执行权。
与 codex-with-chatgpt 的 C2C 协议同构，但**数据面是推送**——DeepSeek 网页版不能自己拉数据。

## 原则

- 控制消息 < 1 KB，只带状态与文件名；**不贴 diff、不贴日志、不贴整文件**。
- 需要代码时推送**最小片段**（`--context` / `--prompt-file`），发送前过闸门。
- 线程即上下文：一个任务一个线程；线程丢了才 HANDOFF。

## 状态机

```
INIT → PLAN → EXECUTING → EXECUTED → REVIEW → (PLAN | DONE | BLOCKED)
```

## 怎么跑（CLI 负责封装与解析）

信封由 `dsb` 自动封装，回复状态由代码解析，你只写正文：

```bash
# 起循环
dsb ask --protocol INIT --task dsb_f81a --iteration 0 --prompt-file goal.txt --json
# 执行完汇报（正文只写元数据）
dsb ask --protocol EXECUTED --iteration 1 --prompt-file report.txt --json
```

返回里读 `protocol.reply.state`（`PLAN` / `DONE` / `BLOCKED`）；
`--task` / `--iteration` 省略时会自动沿用工作区 session 里的值。
checkpoint 会自动写入 session（`dsb thread status --json` 可查）。

## 消息形状（CLI 自动生成，此处仅供理解）

```
[DSB]
STATE: INIT
TASK_ID: dsb_f81a
ITERATION: 0

GOAL:
<一段话目标>
```

- **PLAN**（DeepSeek → 你）：应包含 ACTIONS / FILES_LIKELY_INVOLVED / TESTS / SUCCESS_CRITERIA；
  只要一段空泛的结论就要求它展开一次。
- **EXECUTED**（你 → DeepSeek)：只报元数据（改动文件数、测试结果）+「请复核」；
  由你在本地执行，**不要**把执行权交出去。
- **REVIEW**（DeepSeek）：DONE / PLAN（下一轮）/ BLOCKED。

## 限额与断点

- 迭代上限默认 12；到顶暂停问用户。
- 进度写进工作区 session（`dsb session set`）：`protocolState / waitingFor / nextStep / knownIssues`，字段有长度上限。
- 线程丢失 → 依据 session 生成 HANDOFF 简报（目标 / 进度 / 当前状态 / 已知问题 / 下一步），**不粘贴日志或 diff**。

## 注意

- 本协议是**约定**：DeepSeek 不会真的执行任何操作，执行永远由本地 agent 完成。
- 每轮结束后把结论**逐字**带回当前对话，并附来源行。
