import { listAccountIds, loadAccount } from "../auth/store.js";
import { log } from "../utils.js";

export function cmdAccounts(): void {
  const ids = listAccountIds();
  if (ids.length === 0) {
    log("暂无已登录账号，请先运行 `weixin login`");
    return;
  }

  console.log();
  log(`已登录账号 (${ids.length} 个):`);
  console.log();
  for (const id of ids) {
    const data = loadAccount(id);
    const baseUrl = data?.baseUrl ?? "(default)";
    const userId = data?.userId ?? "(unknown)";
    const savedAt = data?.savedAt ?? "(unknown)";
    console.log(`  ID:       ${id}`);
    console.log(`  User ID:  ${userId}`);
    console.log(`  Base URL: ${baseUrl}`);
    console.log(`  登录时间: ${savedAt}`);
    console.log();
  }
}
