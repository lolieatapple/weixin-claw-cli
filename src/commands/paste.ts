import { execSync } from "node:child_process";
import { sendMessage } from "../api/client.js";
import {
  loadAccount,
  listAccountIds,
} from "../auth/store.js";
import { log, error, ensureAccount, ensureContextToken } from "../utils.js";

function readClipboard(): string {
  const cmd = process.platform === "darwin" ? "pbpaste" : "xclip -selection clipboard -o";
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    throw new Error(
      process.platform === "darwin"
        ? "读取剪贴板失败"
        : "读取剪贴板失败，请确保已安装 xclip",
    );
  }
}

/** Resolve the bound user's WeChat ID (the person who scanned the QR code). */
function resolveBoundUserId(): string | null {
  const ids = listAccountIds();
  if (ids.length === 0) return null;
  const data = loadAccount(ids[0]);
  return data?.userId?.trim() || null;
}

export async function cmdPaste(): Promise<void> {
  const account = await ensureAccount();

  const to = resolveBoundUserId();
  if (!to) {
    error("未找到绑定的微信用户 ID，请重新登录 `weixin login`");
    process.exit(1);
  }

  const text = readClipboard();
  if (!text) {
    error("剪贴板为空");
    process.exit(1);
  }

  const contextToken = await ensureContextToken(account, to);
  if (!contextToken) {
    error("无法获取会话 token，请先用微信给机器人发一条消息，再重试");
    process.exit(1);
  }

  const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
  log(`发送剪贴板内容到 ${to}:`);
  console.log(`  "${preview}"`);

  const result = await sendMessage({
    baseUrl: account.baseUrl,
    token: account.token,
    to,
    text,
    contextToken,
  });

  log(`已发送 (id: ${result.messageId})`);
}
