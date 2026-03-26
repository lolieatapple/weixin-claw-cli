import { sendMessage } from "../api/client.js";
import { log, ensureAccount, ensureContextToken } from "../utils.js";

export async function cmdSend(to: string, text: string): Promise<void> {
  const account = await ensureAccount();

  const contextToken = await ensureContextToken(account, to);

  const result = await sendMessage({
    baseUrl: account.baseUrl,
    token: account.token,
    to,
    text,
    contextToken,
  });

  log(`消息已发送 (id: ${result.messageId})`);
}
