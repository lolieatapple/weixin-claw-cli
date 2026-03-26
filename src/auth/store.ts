import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type AccountData = {
  token?: string;
  baseUrl?: string;
  userId?: string;
  savedAt?: string;
};

export type ContextTokenStore = {
  get(accountId: string, userId: string): string | undefined;
  set(accountId: string, userId: string, token: string): void;
};

function resolveStateDir(): string {
  return (
    process.env.WEIXIN_CLAW_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".weixin")
  );
}

function resolveAccountsDir(): string {
  return path.join(resolveStateDir(), "accounts");
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

function resolveAccountIndexPath(): string {
  return path.join(resolveStateDir(), "accounts.json");
}

function resolveContextTokenPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.context-tokens.json`);
}

function resolveSyncBufPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.sync.json`);
}

/** Normalize accountId: replace @ and . with - for filesystem safety. */
export function normalizeAccountId(raw: string): string {
  return raw.replace(/[@.]/g, "-");
}

// ── Account Index ───────────────────────────────────────────────────────────

export function listAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
  } catch {
    return [];
  }
}

export function registerAccountId(accountId: string): void {
  const dir = resolveStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const existing = listAccountIds();
  if (existing.includes(accountId)) return;
  const updated = [...existing, accountId];
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), "utf-8");
}

// ── Account Data ────────────────────────────────────────────────────────────

export function loadAccount(accountId: string): AccountData | null {
  try {
    const filePath = resolveAccountPath(accountId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AccountData;
  } catch {
    return null;
  }
}

export function saveAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = loadAccount(accountId) ?? {};
  const token = update.token?.trim() || existing.token;
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
  const userId = update.userId?.trim() || existing.userId;

  const data: AccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = resolveAccountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

/** Get the first (or specified) account's resolved config. */
export function resolveAccount(accountId?: string): {
  accountId: string;
  baseUrl: string;
  token?: string;
} | null {
  const ids = listAccountIds();
  const id = accountId ?? ids[0];
  if (!id) return null;
  const data = loadAccount(id);
  if (!data) return null;
  return {
    accountId: id,
    baseUrl: data.baseUrl?.trim() || "https://ilinkai.weixin.qq.com",
    token: data.token?.trim(),
  };
}

// ── Context Tokens ──────────────────────────────────────────────────────────

export function createContextTokenStore(): ContextTokenStore {
  const store = new Map<string, string>();

  function key(accountId: string, userId: string): string {
    return `${accountId}:${userId}`;
  }

  function persistToDisk(accountId: string): void {
    const prefix = `${accountId}:`;
    const tokens: Record<string, string> = {};
    for (const [k, v] of store) {
      if (k.startsWith(prefix)) {
        tokens[k.slice(prefix.length)] = v;
      }
    }
    const filePath = resolveContextTokenPath(accountId);
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(tokens, null, 0), "utf-8");
    } catch {
      // best-effort
    }
  }

  function restoreFromDisk(accountId: string): void {
    const filePath = resolveContextTokenPath(accountId);
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, "utf-8");
      const tokens = JSON.parse(raw) as Record<string, string>;
      for (const [userId, token] of Object.entries(tokens)) {
        if (typeof token === "string" && token) {
          store.set(key(accountId, userId), token);
        }
      }
    } catch {
      // ignore
    }
  }

  // Restore all known accounts on init
  for (const id of listAccountIds()) {
    restoreFromDisk(id);
  }

  return {
    get(accountId: string, userId: string): string | undefined {
      return store.get(key(accountId, userId));
    },
    set(accountId: string, userId: string, token: string): void {
      store.set(key(accountId, userId), token);
      persistToDisk(accountId);
    },
  };
}

// ── Sync Buf ────────────────────────────────────────────────────────────────

export function loadSyncBuf(accountId: string): string {
  const filePath = resolveSyncBufPath(accountId);
  try {
    if (!fs.existsSync(filePath)) return "";
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { buf?: string };
    return raw.buf ?? "";
  } catch {
    return "";
  }
}

export function saveSyncBuf(accountId: string, buf: string): void {
  const filePath = resolveSyncBufPath(accountId);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ buf }), "utf-8");
}
