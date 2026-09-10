#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { VERSION, dirs, ensureDir, writeJson, readJson, workspaceId, nowIso } from "./src/paths.mjs";
import { log, redact, tailLines } from "./src/logger.mjs";
import { sanitizeOutbound } from "./src/sanitize.mjs";
import { getSession, setSession, appendAudit, saveDebugHtml } from "./src/session.mjs";
import { launchBrowser, findBrowser, depsInstalled, depsEntry } from "./src/browser.mjs";
import * as site from "./src/site.mjs";

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
    version: { type: "boolean", default: false },
    think: { type: "string" },
    search: { type: "string" },
    prompt: { type: "string" },
    "prompt-file": { type: "string" },
    attach: { type: "string" },
    thread: { type: "string" },
    timeout: { type: "string" },
    deep: { type: "boolean", default: false },
    html: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
    headless: { type: "boolean", default: false },
    "allow-sensitive": { type: "boolean", default: false },
    "allow-large": { type: "boolean", default: false },
    "keep-open": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    lines: { type: "string" },
    force: { type: "boolean", default: false },
    url: { type: "string" },
    title: { type: "string" },
    task: { type: "string" },
    iteration: { type: "string" },
    state: { type: "string" },
    "protocol-state": { type: "string" },
    "waiting-for": { type: "string" },
    "next-step": { type: "string" },
    goal: { type: "string" },
    "known-issues": { type: "string" },
    "clear-checkpoint": { type: "boolean", default: false },
  },
});

const cmd = String(positionals[0] ?? "help").toLowerCase();
const json = !!flags.json;

function emit(payload, { exitCode = 0 } = {}) {
  if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else printHuman(payload);
  if (exitCode) process.exitCode = exitCode;
  return payload;
}

function fail(reason, message, extra = {}) {
  const payload = { ok: false, reason, message, ...extra };
  log("error", `${reason}: ${message}`);
  if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stderr.write(`✗ ${reason}: ${message}\n`);
  process.exitCode = 1;
  return payload;
}

function printHuman(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.ok === false) return;
  if (typeof payload.text === "string") {
    process.stdout.write(`${payload.text}\n`);
    const m = payload.modes ?? {};
    process.stdout.write(
      `\n来源：chat.deepseek.com · 深度思考：${m.confirmed?.think ? "开" : "关"} · 智能搜索：${
        m.confirmed?.search ? "开" : "关"
      } · thread: ${payload.threadUrl ?? "-"} · request: ${payload.requestId ?? "-"} · 截断：${payload.truncated ? "是" : "否"}\n`
    );
    return;
  }
  for (const [k, v] of Object.entries(payload)) {
    if (k === "ok") continue;
    if (v && typeof v === "object") process.stdout.write(`✓ ${k}: ${JSON.stringify(v)}\n`);
    else process.stdout.write(`✓ ${k}: ${v}\n`);
  }
}

function parseOnOff(v, name) {
  if (v === undefined || v === null) return null;
  if (v === true) return true;
  const s = String(v).toLowerCase();
  if (["on", "true", "1", "yes"].includes(s)) return true;
  if (["off", "false", "0", "no"].includes(s)) return false;
  throw Object.assign(new Error(`--${name} 只接受 on|off`), { code: "INVALID_ARGUMENTS" });
}

function newRequestId() {
  return `dsb_${crypto.randomBytes(2).toString("hex")}`;
}

/* ---------------------------------- setup --------------------------------- */

function installDeps() {
  const d = dirs();
  ensureDir(d.deps);
  writeJson(path.join(d.deps, "package.json"), {
    name: "dsb-deps",
    private: true,
    dependencies: { "playwright-core": "^1.40.0" },
  });
  const args = ["install", "--prefix", d.deps, "--no-audit", "--no-fund", "--loglevel", "error"];
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  let res;
  if (fs.existsSync(npmCli)) {
    res = spawnSync(process.execPath, [npmCli, ...args], { stdio: "inherit", windowsHide: true });
  } else {
    res = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32",
    });
  }
  return res.status === 0;
}

async function waitLoginFlow({ timeoutMs }) {
  const ctx = await launchBrowser({ headless: false });
  try {
    const page = await ctx.pages()[0] ?? (await ctx.newPage());
    await site.gotoSite(page);
    process.stderr.write("浏览器已打开。请在窗口里完成 DeepSeek 登录（扫码 / 密码 / 短信码均需你本人操作）。\n");
    let lastBucket = -1;
    const res = await site.waitForLogin(page, {
      timeoutMs,
      onTick: (st, elapsed) => {
        const bucket = Math.floor(elapsed / 30000);
        if (bucket !== lastBucket) {
          lastBucket = bucket;
          process.stderr.write(`  … 等待登录中（${Math.round(elapsed / 1000)}s，当前页面：${st.url}）\n`);
        }
      },
    });
    const d = dirs();
    const prefs = readJson(d.prefs) ?? {};
    if (res.ok) {
      writeJson(d.prefs, { ...prefs, lastLoginAt: nowIso() });
      return { ok: true, loginState: "logged-in", url: res.state?.url ?? site.SITE_URL };
    }
    ensureDir(d.debug);
    const shot = path.join(d.debug, `login-failed-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    writeJson(d.prefs, { ...prefs, lastLoginCheckAt: nowIso() });
    return {
      ok: false,
      reason: res.reason,
      loginState: res.reason === "CLOUDFLARE_CHALLENGE" ? "challenge" : "login-required",
      state: res.state,
      screenshot: shot,
    };
  } finally {
    await ctx.close();
  }
}

async function cmdSetup() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) return fail("DEPENDENCY_MISSING", `需要 Node ≥ 20，当前 ${process.version}`);

  if (!depsInstalled()) {
    process.stderr.write("安装依赖（playwright-core）到状态目录…\n");
    const ok = installDeps();
    if (!ok || !depsInstalled()) return fail("DEPENDENCY_MISSING", `依赖安装失败（目标：${depsEntry()}）`);
  }
  const br = findBrowser();
  if (!br) return fail("DEPENDENCY_MISSING", "未找到系统 Chrome / Edge；请安装其一后重试。");

  const timeoutMs = Number(flags.timeout ?? 1800000);
  const res = await waitLoginFlow({ timeoutMs });
  if (!res.ok) return fail(res.reason, res.reason === "CLOUDFLARE_CHALLENGE" ? "遇到人机验证，请手动完成后重试。" : "等待登录超时，请重试。", res);
  return emit({ ok: true, ...res, browser: br.path, stateDir: dirs().root });
}

async function cmdLogin() {
  const timeoutMs = Number(flags.timeout ?? 1800000);
  const res = await waitLoginFlow({ timeoutMs });
  if (!res.ok) return fail(res.reason, "登录未完成，请重试。", res);
  return emit({ ok: true, ...res });
}

async function cmdLogout() {
  const d = dirs();
  if (fs.existsSync(d.profile)) {
    try {
      fs.rmSync(d.profile, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      return fail("LOCKED", `profile 删除失败（可能有浏览器仍在运行）：${error.message}`);
    }
  }
  const prefs = readJson(d.prefs) ?? {};
  writeJson(d.prefs, { ...prefs, lastLogoutAt: nowIso() });
  return emit({ ok: true, loggedOut: true, profileDir: d.profile });
}

/* --------------------------------- doctor --------------------------------- */

async function cmdDoctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: nodeMajor >= 20, detail: process.version });

  const deps = depsInstalled();
  checks.push({ name: "deps", ok: deps, detail: deps ? dirs().deps : "未安装（运行 dsb setup）" });

  const br = findBrowser();
  checks.push({ name: "browser", ok: !!br, detail: br ? br.path : "未找到 Chrome / Edge" });

  let stateWritable = true;
  try {
    ensureDir(dirs().root);
    fs.accessSync(dirs().root, fs.constants.W_OK);
  } catch {
    stateWritable = false;
  }
  checks.push({ name: "stateDir", ok: stateWritable, detail: dirs().root });

  let netDetail = "";
  let netOk = false;
  try {
    const res = await fetch(site.SITE_URL, { method: "GET", redirect: "manual" });
    netOk = res.status > 0;
    netDetail = `HTTP ${res.status}`;
  } catch (error) {
    netDetail = error.message;
  }
  checks.push({ name: "network", ok: netOk, detail: netDetail });

  let deep = null;
  if (flags.deep) {
    if (!deps || !br) {
      deep = { skipped: true, reason: "DEPENDENCY_MISSING" };
    } else {
      const ctx = await launchBrowser({ headless: !!flags.headless });
      try {
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        await site.gotoSite(page);
        const st = await site.pageState(page);
        const toggles = await site.probeToggles(page);
        deep = { state: st, toggles };
        ensureDir(dirs().debug);
        const shot = path.join(dirs().debug, `doctor-${Date.now()}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        deep.screenshot = shot;
        if (flags.html) deep.htmlFile = saveDebugHtml(await page.content(), "doctor");
      } finally {
        await ctx.close();
      }
    }
  }

  let ok = checks.every((c) => c.ok);
  let reason;
  if (!ok) reason = checks.find((c) => !c.ok)?.name === "deps" || checks.find((c) => !c.ok)?.name === "browser" ? "DEPENDENCY_MISSING" : "SEND_FAILED";
  if (deep && !deep.skipped) {
    if (deep.state.challenge) {
      ok = false;
      reason = "CLOUDFLARE_CHALLENGE";
    } else if (deep.state.rateLimited) {
      ok = false;
      reason = "RATE_LIMITED";
    } else if (!deep.state.hasComposer) {
      ok = false;
      reason = deep.state.hasPassword || deep.state.hasTel ? "LOGIN_REQUIRED" : "COMPOSER_NOT_FOUND";
    } else if (!deep.toggles.toggles?.every((t) => t.found)) {
      ok = false;
      reason = "SITE_CHANGED";
    }
  }
  const payload = { ok, checks, reason, deep };
  return emit(payload, { exitCode: ok ? 0 : 1 });
}

/* ----------------------------------- ask ---------------------------------- */

async function cmdAsk() {
  const wsid = workspaceId();
  const session = getSession(wsid);

  let promptText = flags.prompt ?? null;
  if (!promptText && flags["prompt-file"]) {
    try {
      promptText = fs.readFileSync(flags["prompt-file"], "utf8");
    } catch (error) {
      return fail("INVALID_ARGUMENTS", `读不到 --prompt-file：${error.message}`);
    }
  }
  if (!promptText) return fail("INVALID_ARGUMENTS", "缺少 --prompt 或 --prompt-file");

  const gate = sanitizeOutbound(promptText, {
    allowSensitive: !!flags["allow-sensitive"],
    allowLarge: !!flags["allow-large"],
  });
  if (!gate.ok) return fail(gate.reason, gate.message);
  const subject = gate.text;

  let think;
  let search;
  try {
    think = parseOnOff(flags.think, "think");
    search = parseOnOff(flags.search, "search");
  } catch (error) {
    return fail("INVALID_ARGUMENTS", error.message);
  }

  const attachments = flags.attach
    ? String(flags.attach)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  for (const file of attachments) {
    if (!fs.existsSync(file)) return fail("INVALID_ARGUMENTS", `附件不存在：${file}`);
  }

  const threadArg = flags.thread === true ? "new" : flags.thread ?? null;
  let targetUrl = site.SITE_URL;
  if (threadArg && threadArg !== "new" && /^https?:/.test(threadArg)) targetUrl = threadArg;
  else if (!threadArg && session.threadUrl) targetUrl = session.threadUrl;

  const requestId = newRequestId();
  const startedAt = Date.now();
  const timeoutMs = Number(flags.timeout ?? 180000);

  let ctx;
  try {
    ctx = await launchBrowser({ headless: !!flags.headless });
  } catch (error) {
    return fail(error.code ?? "DEPENDENCY_MISSING", error.message);
  }

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await site.gotoSite(page, targetUrl);

    let st = await site.pageState(page);
    if (st.challenge) return fail("CLOUDFLARE_CHALLENGE", "页面出现人机验证，请在浏览器里手动完成后重试。", { state: st });
    if (st.hasPassword || st.hasTel) return fail("LOGIN_REQUIRED", "需要登录：请运行 dsb login（或 dsb setup）完成人工登录。", { state: st });
    if (st.rateLimited) return fail("RATE_LIMITED", "DeepSeek 提示请求过于频繁，请稍后再试。", { retryAfterMs: 300000 });

    let threadLost = false;
    if (!st.hasComposer) {
      if (targetUrl !== site.SITE_URL) {
        threadLost = true;
        await site.gotoSite(page, site.SITE_URL);
        st = await site.pageState(page);
      }
      if (!st.hasComposer) return fail("COMPOSER_NOT_FOUND", "页面上找不到输入框（可能改版或登录失效）。", { state: st });
    }

    if (attachments.length) {
      const up = await site.attachFiles(page, attachments);
      if (!up.ok) return fail(up.reason, up.message);
    }

    const tRes = await site.setToggle(page, "think", think);
    if (!tRes.ok) return fail(tRes.reason ?? "COMPOSER_NOT_FOUND", tRes.message ?? "找不到深度思考开关");
    const sRes = await site.setToggle(page, "search", search);
    if (!sRes.ok) return fail(sRes.reason ?? "COMPOSER_NOT_FOUND", sRes.message ?? "找不到智能搜索开关");

    const markersBefore = await site.snapshotMarkers(page);

    const injected = await site.injectPrompt(page, subject);
    if (!injected.ok) return fail("SEND_FAILED", `输入注入失败（${injected.valueLength}/${injected.expected} 字符进入输入框）`);

    const sent = await site.sendPrompt(page);
    if (!sent.ok) return fail(sent.reason, sent.message);

    const ans = await site.waitForAnswer(page, { timeoutMs });
    if (flags.debug) {
      const file = saveDebugHtml(await page.content(), "ask");
      process.stderr.write(`调试 HTML 已保存：${file}\n`);
    }

    const markersAfter = await site.snapshotMarkers(page);
    const requested = { think, search };
    const confirmed = {
      think: markersAfter.reasoning > markersBefore.reasoning,
      search: markersAfter.externalLinks > markersBefore.externalLinks,
    };

    if (!ans.ok && !ans.text) {
      return fail(ans.reason ?? "STREAM_STALLED", "等待回答超时，且没有抓到任何文本。", {
        threadUrl: ans.url,
        requested,
        confirmed,
      });
    }

    const threadUrl = ans.url && /\/a\/chat\/s\//.test(ans.url) ? ans.url : session.threadUrl ?? null;
    setSession({ threadUrl, title: session.title ?? null, state: "ANSWERED" }, wsid);
    appendAudit(
      {
        ts: nowIso(),
        requestId,
        threadUrl,
        requested,
        confirmed,
        chars: ans.text?.length ?? 0,
        truncated: !ans.ok,
        redactions: gate.redactions,
        elapsedMs: Date.now() - startedAt,
      },
      wsid
    );

    return emit({
      ok: true,
      requestId,
      threadUrl,
      modes: { requested, confirmed },
      text: ans.text ?? "",
      citations: ans.citations ?? [],
      sourcesFound: ans.sourcesFound ?? undefined,
      truncated: !ans.ok,
      elapsedMs: ans.elapsedMs ?? Date.now() - startedAt,
      threadLost: threadLost || undefined,
      redactions: gate.redactions.length ? gate.redactions : undefined,
      toggleClicks: [tRes.clicked ? "think" : null, sRes.clicked ? "search" : null].filter(Boolean),
      toggleState: { think: { before: tRes.before, after: tRes.after }, search: { before: sRes.before, after: sRes.after } },
    });
  } finally {
    if (!flags["keep-open"]) await ctx.close().catch(() => {});
  }
}

/* -------------------------------- thread / session ------------------------------- */

function cmdThread() {
  const sub = String(positionals[1] ?? "status").toLowerCase();
  const wsid = workspaceId();
  const session = getSession(wsid);
  if (sub === "status" || sub === "list") {
    return emit({ ok: true, workspaceId: wsid, threadUrl: session.threadUrl, title: session.title, state: session.state, checkpoint: session.checkpoint });
  }
  if (sub === "use") {
    const url = flags.url ?? positionals[2];
    if (!url) return fail("INVALID_ARGUMENTS", "用法：dsb thread use <url>");
    return emit({ ok: true, ...setSession({ threadUrl: url }, wsid) });
  }
  if (sub === "new") {
    return emit({ ok: true, ...setSession({ threadUrl: null, state: "NEW" }, wsid), note: "下一条 ask 会从首页开新对话" });
  }
  return fail("INVALID_ARGUMENTS", `未知子命令 thread ${sub}`);
}

function cmdSession() {
  const sub = String(positionals[1] ?? "get").toLowerCase();
  const wsid = workspaceId();
  if (sub === "get") return emit({ ok: true, session: getSession(wsid) });
  if (sub !== "set") return fail("INVALID_ARGUMENTS", `未知子命令 session ${sub}`);

  const patch = {};
  const cp = {};
  if (flags.url !== undefined) patch.threadUrl = flags.url;
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags.task !== undefined) patch.taskId = flags.task;
  if (flags.iteration !== undefined) patch.iteration = Number(flags.iteration);
  if (flags.state !== undefined) patch.state = flags.state;
  if (flags["protocol-state"] !== undefined) cp.protocolState = flags["protocol-state"];
  if (flags["waiting-for"] !== undefined) cp.waitingFor = flags["waiting-for"];
  if (flags["next-step"] !== undefined) cp.nextExpectedStep = flags["next-step"];
  if (flags.goal !== undefined) cp.originalGoal = flags.goal;
  if (flags["known-issues"] !== undefined) cp.knownIssues = flags["known-issues"];
  if (Object.keys(cp).length) patch.checkpointPatch = cp;
  if (flags["clear-checkpoint"]) patch.clearCheckpoint = true;
  if (!Object.keys(patch).length) return fail("INVALID_ARGUMENTS", "没有要写入的字段");

  try {
    return emit({ ok: true, ...setSession(patch, wsid) });
  } catch (error) {
    return fail(error.code ?? "INTERNAL_ERROR", error.message);
  }
}

/* ---------------------------------- misc ---------------------------------- */

function cmdLogs() {
  const n = Number(flags.lines ?? 50);
  const lines = tailLines(n, { verbose: !!flags.verbose });
  if (json) return emit({ ok: true, lines });
  process.stdout.write(`${lines.join("\n")}\n`);
  return { ok: true };
}

function cmdUpdateCheck() {
  const d = dirs();
  const cache = readJson(d.updateCheck) ?? {};
  const today = new Date().toISOString().slice(0, 10);
  if (!flags.force && cache.checkedOn === today) {
    return emit({ ok: true, version: VERSION, checked: false, updateAvailable: cache.updateAvailable ?? false, note: "今日已检查（缓存）" });
  }
  // 未配置远端仓库时，诚实返回「无法检查」
  const note = "未配置远端仓库（git remote），无法自动检查更新；更新方式见 references/install.md";
  writeJson(d.updateCheck, { checkedOn: today, updateAvailable: false, note });
  return emit({ ok: true, version: VERSION, checked: true, updateAvailable: false, note });
}

function usage() {
  process.stdout.write(`dsb ${VERSION} — deepseek-brain 机制层

用法：node <skill-root>/scripts/dsb/cli.mjs <命令> [选项]

命令：
  setup                 首次配置：装依赖 → 打开浏览器 → 人工登录一次
  login / logout        重新登录 / 清除登录态
  doctor [--deep] [--html]   体检（--deep 真机探测页面与选择器）
  ask --prompt-file f --think on|off --search on|off [--attach a,b] [--thread new|<url>] [--json]
  thread status|use <url>|new
  session get|set [...]      工作区线程与 checkpoint
  logs [-n 50] [--verbose]
  update-check [--force]

通用：--json 机器可读输出；--debug 保存页面 HTML；--keep-open 保留浏览器窗口
`);
  return { ok: true };
}

/* --------------------------------- dispatch --------------------------------- */

try {
  if (flags.version) emit({ ok: true, version: VERSION });
  else if (cmd === "setup") await cmdSetup();
  else if (cmd === "login") await cmdLogin();
  else if (cmd === "logout") await cmdLogout();
  else if (cmd === "doctor") await cmdDoctor();
  else if (cmd === "ask") await cmdAsk();
  else if (cmd === "thread") cmdThread();
  else if (cmd === "session") cmdSession();
  else if (cmd === "logs") cmdLogs();
  else if (cmd === "update-check") cmdUpdateCheck();
  else usage();
} catch (error) {
  fail(error.code ?? "INTERNAL_ERROR", error.message ?? String(error));
}
