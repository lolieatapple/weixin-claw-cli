import { resolveAccount, createContextTokenStore, loadSyncBuf, saveSyncBuf } from "./auth/store.js";
import { loginFlow } from "./auth/login.js";
import { getUpdates } from "./api/client.js";

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

/**
 * Ensure we have a contextToken for the target user.
 * If not cached on disk, do a quick getUpdates poll to obtain one.
 */
export async function ensureContextToken(
  account: { accountId: string; baseUrl: string; token?: string },
  to: string,
): Promise<string | undefined> {
  const ctxStore = createContextTokenStore();
  const cached = ctxStore.get(account.accountId, to);
  if (cached) return cached;

  log("首次发送，正在同步会话信息...");
  let getUpdatesBuf = loadSyncBuf(account.accountId);

  for (let i = 0; i < 3; i++) {
    const resp = await getUpdates({
      baseUrl: account.baseUrl,
      token: account.token,
      getUpdatesBuf,
    });

    if (resp.get_updates_buf) {
      saveSyncBuf(account.accountId, resp.get_updates_buf);
      getUpdatesBuf = resp.get_updates_buf;
    }

    for (const msg of resp.msgs ?? []) {
      if (msg.context_token && msg.from_user_id) {
        ctxStore.set(account.accountId, msg.from_user_id, msg.context_token);
      }
    }

    const token = ctxStore.get(account.accountId, to);
    if (token) return token;

    if ((resp.msgs?.length ?? 0) > 0) break;
  }

  return ctxStore.get(account.accountId, to);
}
