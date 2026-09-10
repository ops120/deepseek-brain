import { redact } from "./logger.mjs";

export const DEFAULT_MAX_BYTES = 50 * 1024;
export const HARD_MAX_BYTES = 200 * 1024;

const PRIVATE_KEY_BLOCKS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/,
];

const HOME_PATHS = [
  [/\b[A-Za-z]:\\Users\\[^\\\s"'`]+/g, "C:\\Users\\[user]"],
  [/\/Users\/[^/\s"'`]+/g, "/Users/[user]"],
  [/\/home\/[^/\s"'`]+/g, "/home/[user]"],
];

/**
 * 发送前确定性闸门（裁决者）。
 * @returns {{ok:true, text:string, redactions:string[], warnings:string[]} | {ok:false, reason:string, message:string, detail?:string}}
 */
export function sanitizeOutbound(text, { allowSensitive = false, allowLarge = false, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, reason: "INVALID_ARGUMENTS", message: "prompt 为空" };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  const cap = allowLarge ? HARD_MAX_BYTES : maxBytes;
  if (bytes > cap) {
    return {
      ok: false,
      reason: "PAYLOAD_TOO_LARGE",
      message: `prompt 约 ${bytes} 字节，超过上限 ${cap} 字节；请先摘要或分片（--allow-large 可放宽到 ${HARD_MAX_BYTES}）。`,
    };
  }

  if (allowSensitive) {
    // 用户明确知情同意：放行内容，但仍拒绝整段私钥（除非再次显式豁免由调用方决定）
    for (const re of PRIVATE_KEY_BLOCKS) {
      if (re.test(text)) {
        return {
          ok: false,
          reason: "SENSITIVE_BLOCKED",
          message: "内容包含私钥块，即使 --allow-sensitive 也拒绝发送；请移除后再试。",
        };
      }
    }
    return { ok: true, text, redactions: [], warnings: ["allow-sensitive：脱敏已按用户同意关闭"] };
  }

  const redactions = [];
  for (const re of PRIVATE_KEY_BLOCKS) {
    if (re.test(text)) {
      return {
        ok: false,
        reason: "SENSITIVE_BLOCKED",
        message: "内容包含私钥块（PEM/PGP），已拒绝发送；请移除或改为摘要后再试。",
      };
    }
  }

  let out = text;
  const before = out;
  out = redact(out);
  if (out !== before) redactions.push("secrets");

  for (const [re, rep] of HOME_PATHS) {
    const prev = out;
    out = out.replace(re, rep);
    if (out !== prev && !redactions.includes("home-paths")) redactions.push("home-paths");
  }

  return { ok: true, text: out, redactions, warnings: [] };
}
