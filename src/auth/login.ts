import { fetchQRCode, pollQRStatus, DEFAULT_BASE_URL } from "../api/client.js";
import {
  normalizeAccountId,
  saveAccount,
  registerAccountId,
} from "./store.js";
import { log, error } from "../utils.js";

const MAX_QR_REFRESH_COUNT = 3;

export async function loginFlow(opts?: { baseUrl?: string }): Promise<{
  success: boolean;
  accountId?: string;
  baseUrl?: string;
}> {
  const apiBaseUrl = opts?.baseUrl || DEFAULT_BASE_URL;

  log("正在获取登录二维码...");
  let qrResponse = await fetchQRCode(apiBaseUrl);
  let qrcode = qrResponse.qrcode;

  // Display QR code in terminal
  try {
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(qrResponse.qrcode_img_content, { small: true }, (qr: string) => {
        console.log(qr);
        resolve();
      });
    });
  } catch {
    // fallback
  }
  log(`如果二维码未能成功展示，请用浏览器打开以下链接扫码：`);
  console.log(`  ${qrResponse.qrcode_img_content}`);
  console.log();
  log("等待扫码...");

  const deadline = Date.now() + 480_000;
  let scannedPrinted = false;
  let qrRefreshCount = 1;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(apiBaseUrl, qrcode);

    switch (status.status) {
      case "wait":
        break;

      case "scaned":
        if (!scannedPrinted) {
          log("已扫码，请在微信上确认...");
          scannedPrinted = true;
        }
        break;

      case "expired": {
        qrRefreshCount++;
        if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
          error("二维码多次过期，请重新登录。");
          return { success: false };
        }
        log(`二维码已过期，正在刷新...(${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`);
        qrResponse = await fetchQRCode(apiBaseUrl);
        qrcode = qrResponse.qrcode;
        scannedPrinted = false;
        try {
          const qrterm = await import("qrcode-terminal");
          await new Promise<void>((resolve) => {
            qrterm.default.generate(qrResponse.qrcode_img_content, { small: true }, (qr: string) => {
              console.log(qr);
              resolve();
            });
          });
        } catch {
          // fallback
        }
        console.log(`  ${qrResponse.qrcode_img_content}`);
        break;
      }

      case "confirmed": {
        if (!status.ilink_bot_id) {
          error("登录失败：服务器未返回 bot ID。");
          return { success: false };
        }

        const accountId = normalizeAccountId(status.ilink_bot_id);
        const baseUrl = status.baseurl || apiBaseUrl;

        saveAccount(accountId, {
          token: status.bot_token,
          baseUrl,
          userId: status.ilink_user_id,
        });
        registerAccountId(accountId);

        log(`与微信连接成功！`);
        log(`Account ID: ${accountId}`);
        return { success: true, accountId, baseUrl };
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  error("登录超时，请重试。");
  return { success: false };
}
