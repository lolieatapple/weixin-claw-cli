import { resolveAccount } from "./auth/store.js";
import { loginFlow } from "./auth/login.js";

const PREFIX = "\x1b[36m[weixin]\x1b[0m";

export function log(msg: string): void {
  console.log(`${PREFIX} ${msg}`);
}

export function error(msg: string): void {
  console.error(`\x1b[31m[weixin]\x1b[0m ${msg}`);
}

export function formatTime(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * Ensure an account is available. If not logged in, automatically start login flow.
 * Returns the resolved account or exits on failure.
 */
export async function ensureAccount(): Promise<{
  accountId: string;
  baseUrl: string;
  token?: string;
}> {
  const existing = resolveAccount();
  if (existing) return existing;

  log("未找到已登录账号，开始扫码登录...");
  console.log();
  const result = await loginFlow();
  if (!result.success) {
    error("登录失败，无法继续。");
    process.exit(1);
  }
  console.log();

  const account = resolveAccount();
  if (!account) {
    error("登录后仍无法读取账号数据，请重试。");
    process.exit(1);
  }
  return account;
}
