import fs from "node:fs";
import path from "node:path";
import { sendMediaMessage } from "../api/client.js";
import { MessageItemType } from "../api/types.js";
import {
  uploadImage,
  uploadVideo,
  uploadFile,
  getMimeFromFilename,
} from "../api/cdn.js";
import {
  loadAccount,
  listAccountIds,
} from "../auth/store.js";
import { log, error, ensureAccount, ensureContextToken } from "../utils.js";

function resolveBoundUserId(): string | null {
  const ids = listAccountIds();
  if (ids.length === 0) return null;
  const data = loadAccount(ids[0]);
  return data?.userId?.trim() || null;
}

export async function cmdSendFile(
  filePath: string,
  targetUserId?: string,
  caption?: string,
): Promise<void> {
  const account = await ensureAccount();

  const to = targetUserId || resolveBoundUserId();
  if (!to) {
    error("未找到目标用户，请指定 --to <user_id> 或先登录绑定");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    error(`文件不存在: ${absPath}`);
    process.exit(1);
  }

  const mime = getMimeFromFilename(absPath);
  const fileName = path.basename(absPath);
  const fileSize = fs.statSync(absPath).size;
  const sizeStr =
    fileSize > 1024 * 1024
      ? `${(fileSize / 1024 / 1024).toFixed(1)}MB`
      : `${(fileSize / 1024).toFixed(1)}KB`;

  let typeLabel: string;
  if (mime.startsWith("image/")) typeLabel = "图片";
  else if (mime.startsWith("video/")) typeLabel = "视频";
  else typeLabel = "文件";

  log(`正在上传${typeLabel}: ${fileName} (${sizeStr})...`);

  const contextToken = await ensureContextToken(account, to);

  if (mime.startsWith("image/")) {
    const uploaded = await uploadImage(filePath, to, {
      baseUrl: account.baseUrl,
      token: account.token,
    });
    const result = await sendMediaMessage({
      baseUrl: account.baseUrl,
      token: account.token,
      to,
      text: caption,
      contextToken,
      mediaItem: {
        type: MessageItemType.IMAGE,
        image_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey, "hex").toString("base64"),
            encrypt_type: 1,
          },
          mid_size: uploaded.fileSizeCiphertext,
        },
      },
    });
    log(`图片已发送 (id: ${result.messageId})`);
  } else if (mime.startsWith("video/")) {
    const uploaded = await uploadVideo(filePath, to, {
      baseUrl: account.baseUrl,
      token: account.token,
    });
    const result = await sendMediaMessage({
      baseUrl: account.baseUrl,
      token: account.token,
      to,
      text: caption,
      contextToken,
      mediaItem: {
        type: MessageItemType.VIDEO,
        video_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey, "hex").toString("base64"),
            encrypt_type: 1,
          },
          video_size: uploaded.fileSizeCiphertext,
        },
      },
    });
    log(`视频已发送 (id: ${result.messageId})`);
  } else {
    const uploaded = await uploadFile(filePath, to, {
      baseUrl: account.baseUrl,
      token: account.token,
    });
    const result = await sendMediaMessage({
      baseUrl: account.baseUrl,
      token: account.token,
      to,
      text: caption,
      contextToken,
      mediaItem: {
        type: MessageItemType.FILE,
        file_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey, "hex").toString("base64"),
            encrypt_type: 1,
          },
          file_name: fileName,
          len: String(uploaded.fileSize),
        },
      },
    });
    log(`文件已发送 (id: ${result.messageId})`);
  }
}
