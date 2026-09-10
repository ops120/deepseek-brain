/**
 * chat.deepseek.com 页面交互层。
 * 选择器尽量用「文本 / 结构」而不是哈希类名；所有不确定处都由 doctor --deep 真机复核。
 */

export const SITE_URL = "https://chat.deepseek.com/";

export const LABELS = {
  think: "深度思考",
  search: "智能搜索",
  newChat: "开启新对话",
  stop: "停止生成",
  composerPlaceholder: "给 DeepSeek 发送消息",
};

export async function gotoSite(page, url = SITE_URL) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
}

export async function pageState(page) {
  return page.evaluate(() => {
    const body = document.body ? document.body.innerText || "" : "";
    const has = (sel) => !!document.querySelector(sel);
    return {
      url: location.href,
      title: document.title,
      hasComposer: has("textarea"),
      hasPassword: has('input[type="password"]'),
      hasTel: has('input[type="tel"]'),
      challenge: /just a moment|checking your browser|cf-challenge|人机验证|请稍候|验证中/i.test(
        `${document.title} ${body.slice(0, 1000)}`
      ),
      rateLimited: /请求过于频繁|访问过于频繁|too many requests|服务繁忙|请稍后再试/i.test(body),
      stopVisible: body.includes("停止生成"),
      textSample: body.replace(/\s+/g, " ").trim().slice(0, 240),
    };
  });
}

/** 等登录完成（轮询；不做任何凭证输入）。 */
export async function waitForLogin(page, { timeoutMs = 600000, pollMs = 2500, onTick } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const st = await pageState(page).catch(() => null);
    if (st) {
      last = st;
      if (st.challenge) return { ok: false, reason: "CLOUDFLARE_CHALLENGE", state: st };
      if (st.hasComposer && !st.hasPassword && !st.hasTel) return { ok: true, state: st };
      onTick?.(st, Date.now() - started);
    }
    await page.waitForTimeout(pollMs);
  }
  return { ok: false, reason: "LOGIN_REQUIRED", state: last };
}

/** 在 composer 作用域内找「深度思考 / 智能搜索」胶囊。 */
export async function probeToggles(page) {
  return page.evaluate((labels) => {
    const ta = document.querySelector("textarea");
    if (!ta) return { scopeFound: false, toggles: [] };
    let scope = ta;
    for (let i = 0; i < 8 && scope.parentElement; i++) {
      scope = scope.parentElement;
      const t = scope.innerText || "";
      if (t.includes(labels.think) && t.includes(labels.search)) break;
    }
    const guess = (el) => {
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        const cls = typeof node.className === "string" ? node.className : "";
        const aria =
          node.getAttribute?.("aria-pressed") ?? node.getAttribute?.("aria-checked") ?? node.getAttribute?.("data-state") ?? "";
        if (["true", "checked", "on", "open"].includes(String(aria).toLowerCase())) return true;
        if (["false", "unchecked", "off", "closed"].includes(String(aria).toLowerCase())) return false;
        if (/(^|[^a-z])(active|selected|checked|enabled)([^a-z]|$)/i.test(cls) && !/inactive|unselected|disabled/i.test(cls)) return true;
        node = node.parentElement;
      }
      return null;
    };
    const out = [];
    for (const label of [labels.think, labels.search]) {
      const cands = [...scope.querySelectorAll("div,button,span")].filter((el) => {
        const t = (el.innerText || "").trim();
        if (t !== label) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        return ![...el.children].some((c) => (c.innerText || "").trim() === label);
      });
      const el = cands[cands.length - 1] ?? null;
      if (!el) {
        out.push({ label, found: false });
        continue;
      }
      const r = el.getBoundingClientRect();
      // 可点击的胶囊通常是这个文字节点自身或其直接父级
      const clickTarget = el.closest("button,[role=button],div") ?? el;
      const cr = clickTarget.getBoundingClientRect();
      out.push({
        label,
        found: true,
        x: Math.round(cr.x + cr.width / 2),
        y: Math.round(cr.y + cr.height / 2),
        guess: guess(el),
        className: typeof el.className === "string" ? el.className.slice(0, 120) : null,
      });
    }
    return { scopeFound: true, toggles: out };
  }, LABELS);
}

export async function setToggle(page, which, want) {
  const labels = LABELS;
  const label = which === "think" ? labels.think : labels.search;
  const before = await probeToggles(page);
  const t = before.toggles.find((x) => x.label === label);
  if (!t?.found) return { ok: false, reason: "COMPOSER_NOT_FOUND", message: `未找到「${label}」开关` };
  if (want === null || want === undefined) return { ok: true, before: t.guess, after: t.guess, clicked: false };
  if (t.guess === want) return { ok: true, before: t.guess, after: t.guess, clicked: false };
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(700);
  const after = await probeToggles(page);
  const t2 = after.toggles.find((x) => x.label === label);
  return { ok: true, before: t.guess, after: t2?.guess ?? null, clicked: true, classChanged: t.className !== t2?.className };
}

export async function attachFiles(page, files) {
  if (!files?.length) return { ok: true, attached: 0 };
  const input = page.locator('input[type="file"]').first();
  const count = await page.locator('input[type="file"]').count();
  if (count === 0) return { ok: false, reason: "UPLOAD_REJECTED", message: "页面上没有找到文件输入框" };
  try {
    await input.setInputFiles(files, { timeout: 30000 });
    await page.waitForTimeout(2500);
    return { ok: true, attached: files.length };
  } catch (error) {
    return { ok: false, reason: "UPLOAD_REJECTED", message: `附件上传失败：${error.message}` };
  }
}

/** React 受控 textarea 的安全注入（原生 setter + input 事件），超长分片。 */
export async function injectPrompt(page, text) {
  const composer = page.locator("textarea").first();
  await composer.waitFor({ state: "visible", timeout: 20000 });
  const CHUNK = 8000;
  if (text.length <= CHUNK) {
    await composer.evaluate((ta, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(ta, value);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
  } else {
    let acc = "";
    for (let i = 0; i < text.length; i += CHUNK) {
      acc += text.slice(i, i + CHUNK);
      const value = acc;
      await composer.evaluate((ta, v) => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        set.call(ta, v);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(300);
  const value = await composer.inputValue();
  return { ok: value.length >= Math.min(text.length, 20), valueLength: value.length, expected: text.length };
}

export async function sendPrompt(page) {
  const composer = page.locator("textarea").first();
  await composer.press("Enter");
  await page.waitForTimeout(1500);
  const value = await composer.inputValue().catch(() => "");
  if (value.trim() === "") return { ok: true, method: "enter" };
  // 兜底：点发送按钮（输入框所在容器里最靠右的圆形可点区域）
  const box = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return null;
    let scope = ta;
    for (let i = 0; i < 6 && scope.parentElement; i++) scope = scope.parentElement;
    const taRect = ta.getBoundingClientRect();
    const cands = [...scope.querySelectorAll("button,[role=button],div")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 24 && r.width <= 72 && r.height >= 24 && r.height <= 72 && r.x > taRect.right - 120 && r.y < taRect.bottom + 40;
    });
    const el = cands[cands.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!box) return { ok: false, reason: "SEND_FAILED", message: "Enter 未发送且找不到发送按钮" };
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(1500);
  const after = await composer.inputValue().catch(() => "");
  return after.trim() === "" ? { ok: true, method: "button" } : { ok: false, reason: "SEND_FAILED", message: "点击发送后输入框仍有内容" };
}

/** 页面内抽取：答案文本 / 推理块 / 引用 / 是否仍在生成。 */
export const EXTRACT_FN = () => {
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const clean = (s) =>
    (s || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "section", "article"]);
  // 自己走 DOM 取文本：跳过引用角标，同时保留块级元素换行
  const collectText = (node) => {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.nodeValue;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const cls = typeof el.className === "string" ? el.className : "";
      if (/cite/i.test(cls)) continue; // 引用角标（含其内部 opacity:0 的占位符）
      const style = el.getAttribute ? el.getAttribute("style") || "" : "";
      if (/opacity:\s*0(\D|$)/.test(style)) continue; // 不可见占位文本
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        out += "\n";
        continue;
      }
      if (tag === "script" || tag === "style") continue;
      if (tag === "tr") out += "\n";
      if (tag === "td" || tag === "th") out += " | ";
      const block = BLOCK.has(tag) && tag !== "td" && tag !== "th";
      if (block) out += "\n";
      out += collectText(el);
      if (block) out += "\n";
    }
    return out;
  };
  const body = document.body ? document.body.innerText || "" : "";

  let scope = null;
  // 首选：DeepSeek 的语义化类名（2026-09 实测）
  const answers = [...document.querySelectorAll('[class*="ds-assistant-message-main-content"]')].filter(visible);
  if (answers.length) scope = answers[answers.length - 1];
  let nodes = [];
  if (!scope) nodes = [...document.querySelectorAll('[class*="ds-markdown"]')].filter(visible);
  if (!scope && !nodes.length) nodes = [...document.querySelectorAll('[class*="markdown" i]')].filter(visible);
  if (!scope && nodes.length) {
    scope = nodes[nodes.length - 1];
  } else if (!scope) {
    const blocks = [...document.querySelectorAll("p, pre, ul, ol, table, h1, h2, h3, h4, h5, h6")].filter(visible);
    if (blocks.length) {
      let node = blocks[blocks.length - 1];
      let best = node;
      for (let i = 0; i < 8 && node.parentElement; i++) {
        node = node.parentElement;
        const len = (node.innerText || "").length;
        if (len > 6000) break;
        best = node;
      }
      scope = best;
    }
  }

  const text = scope ? clean(collectText(scope)) : "";
  const messages = [...document.querySelectorAll('[class*="ds-message"]')].filter(visible);
  const msgScope = messages.length ? messages[messages.length - 1] : scope;
  const citations = [];
  const seen = new Set();
  for (const root of [scope, msgScope].filter(Boolean)) {
    for (const a of root.querySelectorAll('a[href^="http"]')) {
      // 只收引用角标对应的来源链接；来源卡片本身不带标题
      if (!a.querySelector('[class*="cite" i]')) continue;
      const url = a.href;
      if (!url || seen.has(url)) continue;
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* 保底用原始 url */
      }
      seen.add(url);
      citations.push({ title: host, url });
    }
  }
  const scopeText = msgScope ? msgScope.innerText || "" : body;
  const found = scopeText.match(/搜索到\s*(\d+)\s*个网页/);
  // 「停止生成」必须是可见叶子节点的文字：body.includes 会被隐藏模板/无关文本误触发
  const stopVisible = [...document.querySelectorAll("div,button,span")].some(
    (el) =>
      el.children.length === 0 &&
      (el.textContent || "").trim() === "停止生成" &&
      el.getClientRects().length > 0
  );
  return {
    text,
    answerCount: answers.length,
    reasoning: document.querySelectorAll('[class*="ds-think-content"]').length > 0,
    stopVisible,
    citations,
    sourcesFound: found ? Number(found[1]) : null,
    composerEmpty: (document.querySelector("textarea")?.value ?? "").trim() === "",
    url: location.href,
  };
};

/**
 * 页面级标记计数：推理块数量 + 外部链接数量。
 * 用「发送前后差值」判断本次回答是否真的开了深度思考 / 智能搜索，
 * 避免把历史消息里的推理块算进来。
 */
export const MARKER_FN = () => {
  const body = document.body ? document.body.innerText || "" : "";
  const external = [...document.querySelectorAll('a[href^="http"]')].filter((a) => {
    try {
      return !/(^|\.)deepseek\.com$/.test(new URL(a.href).hostname);
    } catch {
      return false;
    }
  }).length;
  const thinkBlocks = document.querySelectorAll('[class*="ds-think-content"]').length;
  const textMarkers = (body.match(/已深度思考|深度思考（用时|思考过程|已思考/g) || []).length;
  return {
    reasoning: thinkBlocks || textMarkers,
    externalLinks: external,
    searchBanners: (body.match(/搜索到\s*\d+\s*个网页/g) || []).length,
    answers: document.querySelectorAll('[class*="ds-assistant-message-main-content"]').length,
  };
};

export async function snapshotMarkers(page) {
  try {
    return await page.evaluate(MARKER_FN);
  } catch {
    return { reasoning: 0, externalLinks: 0 };
  }
}

/**
 * 监听页面自身的 completion 流。
 * 消息列表会虚拟化（旧消息被卸载），所以「助手消息条数」不能当基线；
 * 网络信号才是可靠判据：该请求结束 = 生成结束。
 */
export function watchCompletion(page, urlPart = "/api/v0/chat/completion") {
  const state = { seen: false, done: false, failed: false };
  const match = (req) => req.url().includes(urlPart);
  const onRequest = (req) => {
    if (match(req)) state.seen = true;
  };
  const onFinished = (req) => {
    if (match(req)) state.done = true;
  };
  const onFailed = (req) => {
    if (match(req)) state.failed = true;
  };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    get state() {
      return { ...state };
    },
    reset() {
      state.seen = false;
      state.done = false;
      state.failed = false;
    },
    dispose() {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}

/**
 * 等本次回答完成。
 * 主判据：completion 流未结束 → 一律视为生成中（避免把上一条答案误判成本次完成）。
 * 次判据：文本连续 N 次采样不变 → 结束（网络信号缺失时的兜底）。
 */
export async function waitForAnswer(page, { timeoutMs = 180000, pollMs = 800, stableSamples = 3, completion = null, onPoll } = {}) {
  const started = Date.now();
  let last = "";
  let stable = 0;
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    lastState = await page.evaluate(EXTRACT_FN).catch(() => null);
    const cs = completion?.state ?? { seen: false, done: false, failed: false };
    const generating = cs.seen && !cs.done && !cs.failed;
    const text = lastState?.text ?? "";
    if (!generating && text.length > 0 && text === last) stable += 1;
    else stable = 0;
    last = text;
    onPoll?.({
      len: text.length,
      stable,
      generating,
      network: `${cs.seen ? "seen" : "-"}/${cs.done ? "done" : cs.failed ? "failed" : "-"}`,
      answerCount: lastState?.answerCount ?? -1,
    });
    if (!generating && text.length > 0 && stable >= stableSamples) {
      return { ok: true, ...lastState, elapsedMs: Date.now() - started, networkSignal: cs.seen };
    }
    await page.waitForTimeout(pollMs);
  }
  return { ok: false, reason: "STREAM_STALLED", ...(lastState ?? {}), elapsedMs: Date.now() - started };
}
