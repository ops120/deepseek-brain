import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dirs, ensureDir } from "./paths.mjs";

const CANDIDATES = {
  win32: [
    ["chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
    ["chrome", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
    ["msedge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
    ["msedge", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"],
  ],
  darwin: [
    ["chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["msedge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  ],
  linux: [
    ["chrome", "/usr/bin/google-chrome"],
    ["chrome", "/usr/bin/chromium"],
    ["chrome", "/usr/bin/chromium-browser"],
    ["msedge", "/usr/bin/microsoft-edge"],
  ],
};

/** 找一个可用的系统浏览器；找不到返回 null（此时才需要下载 chromium）。 */
export function findBrowser() {
  const list = CANDIDATES[process.platform] ?? [];
  for (const [channel, file] of list) {
    if (fs.existsSync(file)) return { channel, path: file, source: "system" };
  }
  return null;
}

export function depsEntry() {
  return path.join(dirs().deps, "node_modules", "playwright-core", "index.js");
}

export function depsInstalled() {
  return fs.existsSync(depsEntry());
}

export async function loadPlaywright() {
  const entry = depsEntry();
  if (!fs.existsSync(entry)) {
    throw Object.assign(new Error("playwright-core 未安装：先运行 dsb setup"), { code: "DEPENDENCY_MISSING" });
  }
  const mod = await import(pathToFileURL(entry).href);
  return mod.default ?? mod;
}

/**
 * 启动持久化浏览器（登录态存在 profile 目录）。
 * 默认有头：用户可看到，也降低被识别为自动化的概率。
 */
export async function launchBrowser({ headless = false } = {}) {
  const pw = await loadPlaywright();
  const d = dirs();
  ensureDir(d.profile, 0o700);
  const found = findBrowser();
  if (!found) {
    throw Object.assign(
      new Error("未找到系统 Chrome / Edge。请安装其一，或设置 DSB_BROWSER_PATH 指向浏览器可执行文件。"),
      { code: "DEPENDENCY_MISSING" }
    );
  }
  const executablePath = process.env.DSB_BROWSER_PATH || found.path;
  const ctx = await pw.chromium.launchPersistentContext(d.profile, {
    executablePath,
    headless,
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  });
  ctx.setDefaultTimeout(20000);
  return ctx;
}

export async function openPage(ctx) {
  const pages = ctx.pages();
  const page = pages.length > 0 ? pages[0] : await ctx.newPage();
  return page;
}
