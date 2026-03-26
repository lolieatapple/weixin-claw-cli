import * as readline from "node:readline";
import {
  getUpdates,
  sendMessage,
  extractTextFromMessage,
  describeMessageType,
} from "../api/client.js";
import {
  createContextTokenStore,
  loadSyncBuf,
  saveSyncBuf,
} from "../auth/store.js";
import { log, error, formatTime, ensureAccount } from "../utils.js";

const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export async function cmdChat(targetUserId?: string): Promise<void> {
  const account = await ensureAccount();

  const ctxStore = createContextTokenStore();
  let getUpdatesBuf = loadSyncBuf(account.accountId);
  let consecutiveFailures = 0;

  // Auto-detect target: if not provided, will use the first person who messages us
  let chatTarget = targetUserId ?? "";

  if (chatTarget) {
    log(`进入与 ${chatTarget} 的对话模式`);
  } else {
    log("等待第一条消息以确定对话对象...");
  }
  console.log("输入消息后按回车发送，输入 /quit 退出，/target <id> 切换对话对象");
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  const abortController = new AbortController();

  // Handle user input
  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return;

    if (input === "/quit" || input === "/exit") {
      log("退出对话。");
      abortController.abort();
      rl.close();
      process.exit(0);
    }

    if (input.startsWith("/target ")) {
      chatTarget = input.slice(8).trim();
      log(`对话对象已切换为: ${chatTarget}`);
      return;
    }

    if (input === "/target") {
      if (chatTarget) {
        log(`当前对话对象: ${chatTarget}`);
      } else {
        log("当前无对话对象，等待第一条消息或使用 /target <id> 设置");
      }
      return;
    }

    if (!chatTarget) {
      error("尚未确定对话对象，请等待收到消息或使用 /target <user_id> 设置");
      return;
    }

    try {
      const contextToken = ctxStore.get(account.accountId, chatTarget);
      await sendMessage({
        baseUrl: account.baseUrl,
        token: account.token,
        to: chatTarget,
        text: input,
        contextToken,
      });
      console.log(`\x1b[34m[${formatTime(Date.now())}] 我 →\x1b[0m ${input}`);
    } catch (err) {
      error(`发送失败: ${String(err)}`);
    }
  });

  rl.on("close", () => {
    abortController.abort();
  });

  // Long-poll loop for incoming messages
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
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          error(`连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，等待 30 秒...`);
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
        if (msg.context_token && msg.from_user_id) {
          ctxStore.set(account.accountId, msg.from_user_id, msg.context_token);
        }

        const from = msg.from_user_id ?? "unknown";

        // Auto-set chat target to first sender
        if (!chatTarget) {
          chatTarget = from;
          log(`已自动锁定对话对象: ${chatTarget}`);
        }

        const time = formatTime(msg.create_time_ms);
        const text = extractTextFromMessage(msg);
        const msgType = describeMessageType(msg);

        // Clear current line (in case user is typing) and print message
        process.stdout.write("\r\x1b[K");
        if (text) {
          console.log(`\x1b[33m[${time}]\x1b[0m \x1b[32m${from}\x1b[0m (${msgType}): ${text}`);
        } else {
          console.log(`\x1b[33m[${time}]\x1b[0m \x1b[32m${from}\x1b[0m [${msgType}]`);
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) break;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        error(`连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，等待 30 秒...`);
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
