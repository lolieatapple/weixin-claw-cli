import { sendMessage } from "../api/client.js";
import { createContextTokenStore } from "../auth/store.js";
import { log, ensureAccount } from "../utils.js";

export async function cmdSend(to: string, text: string): Promise<void> {
  const account = await ensureAccount();

  const ctxStore = createContextTokenStore();
  const contextToken = ctxStore.get(account.accountId, to);

  const result = await sendMessage({
    baseUrl: account.baseUrl,
    token: account.token,
    to,
    text,
    contextToken,
  });

  log(`消息已发送 (id: ${result.messageId})`);
}
