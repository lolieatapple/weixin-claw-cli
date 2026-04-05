import fs from "node:fs";
import path from "node:path";
import { getUpdates, extractTextFromMessage, describeMessageType, downloadMediaFromItem } from "../api/client.js";
import { MessageItemType } from "../api/types.js";
import {
  createContextTokenStore,
  loadSyncBuf,
  saveSyncBuf,
} from "../auth/store.js";
import { log, error, formatTime, ensureAccount } from "../utils.js";

const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

export async function cmdListen(): Promise<void> {
  const account = await ensureAccount();

  const ctxStore = createContextTokenStore();
  let getUpdatesBuf = loadSyncBuf(account.accountId);
  let consecutiveFailures = 0;

  log("开始监听消息... (Ctrl+C 退出)");
  console.log();

  const abortController = new AbortController();
  process.on("SIGINT", () => {
    console.log();
    log("停止监听。");
    abortController.abort();
    process.exit(0);
  });

  while (!abortController.signal.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf,
      });

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        consecutiveFailures++;
        error(`getUpdates 失败: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          error(`连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，等待 30 秒后重试...`);
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortController.signal);
        } else {
          await sleep(RETRY_DELAY_MS, abortController.signal);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        saveSyncBuf(account.accountId, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      for (const msg of resp.msgs ?? []) {
        // Cache context token for replies
        if (msg.context_token && msg.from_user_id) {
          ctxStore.set(account.accountId, msg.from_user_id, msg.context_token);
        }

        const from = msg.from_user_id ?? "unknown";
        const time = formatTime(msg.create_time_ms);
        const text = extractTextFromMessage(msg);
        const msgType = describeMessageType(msg);

        if (text) {
          console.log(`\x1b[33m[${time}]\x1b[0m \x1b[32m${from}\x1b[0m (${msgType}): ${text}`);
        } else {
          console.log(`\x1b[33m[${time}]\x1b[0m \x1b[32m${from}\x1b[0m [${msgType}]`);
        }

        // Auto-download media (images, files, videos)
        for (const item of msg.item_list ?? []) {
          const isMedia = item.type === MessageItemType.IMAGE
            || item.type === MessageItemType.FILE
            || item.type === MessageItemType.VIDEO;
          if (!isMedia) continue;

          try {
            const result = await downloadMediaFromItem(item);
            if (result) {
              const dir = path.resolve("downloads");
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const filename = `${from}_${Date.now()}${result.ext}`;
              const filepath = path.join(dir, filename);
              fs.writeFileSync(filepath, result.data);
              log(`  ↳ 已保存: ${filepath} (${(result.data.length / 1024).toFixed(1)}KB)`);
            }
          } catch (err) {
            error(`  ↳ 媒体下载失败: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) break;
      consecutiveFailures++;
      error(`请求错误: ${String(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        error(`连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，等待 30 秒后重试...`);
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, abortController.signal);
      } else {
        await sleep(RETRY_DELAY_MS, abortController.signal);
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
