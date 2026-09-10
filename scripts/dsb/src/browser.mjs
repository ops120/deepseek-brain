import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirs, ensureDir } from "./paths.mjs";
import { log } from "./logger.mjs";

/**
 * 浏览器自适应探测（五层，从最明确到最兜底）：
 *   1. 环境变量覆盖 DSB_BROWSER_PATH
 *   2. 常见安装路径（多厂商 / 多渠道 / 多盘符）
 *   3. PATH 里的可执行名
 *   4. Windows 注册表 App Paths（不写死盘符）
 *   5. 交给 Playwright 的 channel 机制
 * 返回 { executablePath } 或 { channel }，两者都拿不到才 null。
 */
export function findBrowser() {
  const envPath = process.env.DSB_BROWSER_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) return { executablePath: envPath, via: "env" };
    log("warn", `DSB_BROWSER_PATH 指向的文件不存在，已忽略：${envPath}`);
  }

  const rel = [
    "Google/Chrome/Application/chrome.exe",
    "Google/Chrome Beta/Application/chrome.exe",
    "Google/Chrome Dev/Application/chrome.exe",
    "Google/Chrome SxS/Application/chrome.exe",
    "Microsoft/Edge/Application/msedge.exe",
    "BraveSoftware/Brave-Browser/Application/brave.exe",
    "Vivaldi/Application/vivaldi.exe",
    "Chromium/Application/chrome.exe",
  ];
  const roots = [
    "C:/Program Files",
    "C:/Program Files (x86)",
    process.env.LOCALAPPDATA?.replace(/\\/g, "/"),
    process.env.PROGRAMFILES?.replace(/\\/g, "/"),
    process.env["PROGRAMFILES(X86)"]?.replace(/\\/g, "/"),
  ].filter(Boolean);

  const candidates = {
    win32: roots.flatMap((r) => rel.map((x) => `${r}/${x}`)),
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium",
      "/var/lib/flatpak/exports/bin/com.google.Chrome",
    ],
  }[process.platform] ?? [];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return { executablePath: file, via: "path-scan" };
    } catch {
      /* 权限问题忽略 */
    }
  }

  const names =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe", "brave.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file)) return { executablePath: file, via: "PATH" };
      } catch {
        /* ignore */
      }
    }
  }

  if (process.platform === "win32") {
    for (const exe of ["chrome.exe", "msedge.exe"]) {
      try {
        const out = execFileSync(
          "reg",
          ["query", `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, "/ve"],
          { encoding: "utf8", windowsHide: true, timeout: 5000 }
        );
        const match = out.match(/REG_SZ\s+(.+\.exe)/i);
        if (match && fs.existsSync(match[1].trim())) return { executablePath: match[1].trim(), via: "registry" };
      } catch {
        /* 注册表项不存在 */
      }
    }
  }

  return { channel: "chrome", via: "playwright-channel" };
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
      new Error("未找到可用的 Chromium 系浏览器（Chrome / Edge / Brave）。可用 DSB_BROWSER_PATH 指定路径。"),
      { code: "DEPENDENCY_MISSING" }
    );
  }

  const launchOpts = {
    headless,
    // 有头：viewport: null 让窗口能真正最大化（固定视口会压制窗口尺寸）
    // 无头：没有窗口，必须给显式视口
    viewport: headless ? { width: 1280, height: 900 } : null,
    // chromiumSandbox 默认 false 时 Playwright 会注入 --no-sandbox：
    // Chrome 会显示「不受支持的命令行标记」警告条，且是自动化特征（会招致更严的风控）
    chromiumSandbox: true,
    locale: "zh-CN",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
    ],
  };
  if (found.executablePath) launchOpts.executablePath = found.executablePath;
  else launchOpts.channel = found.channel;

  log("info", `browser launch: ${found.executablePath ?? `channel=${found.channel}`} (via ${found.via}), headless=${headless}`);

  const ctx = await pw.chromium.launchPersistentContext(d.profile, launchOpts);
  ctx.setDefaultTimeout(20000);

  // 降低自动化特征：navigator.webdriver 是最明显的指纹之一
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    const orig = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (orig) {
      window.navigator.permissions.query = (p) =>
        p && p.name === "notifications" ? Promise.resolve({ state: Notification.permission }) : orig(p);
    }
  });

  return ctx;
}

export async function openPage(ctx) {
  const pages = ctx.pages();
  return pages.length > 0 ? pages[0] : ctx.newPage();
}
