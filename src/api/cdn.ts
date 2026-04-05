import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";
import type { ClientOptions } from "./client.js";
import type { ImageItem, CDNMedia } from "./types.js";
import { UploadMediaType } from "./types.js";

export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

export type UploadedFileInfo = {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskey: string;
  fileSize: number;
  fileSizeCiphertext: number;
};

// ── AES-128-ECB ─────────────────────────────────────────────────────────────

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

// ── CDN URL ─────────────────────────────────────────────────────────────────

function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

// ── getUploadUrl API ────────────────────────────────────────────────────────

async function getUploadUrl(
  opts: ClientOptions & {
    filekey: string;
    media_type: number;
    to_user_id: string;
    rawsize: number;
    rawfilemd5: string;
    filesize: number;
    no_need_thumb: boolean;
    aeskey: string;
  },
): Promise<{ upload_param?: string }> {
  const base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  const url = new URL("ilink/bot/getuploadurl", base);

  const body = JSON.stringify({
    filekey: opts.filekey,
    media_type: opts.media_type,
    to_user_id: opts.to_user_id,
    rawsize: opts.rawsize,
    rawfilemd5: opts.rawfilemd5,
    filesize: opts.filesize,
    no_need_thumb: opts.no_need_thumb,
    aeskey: opts.aeskey,
    base_info: { channel_version: "standalone-cli-0.1.0" },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": Buffer.from(
      String(crypto.randomBytes(4).readUInt32BE(0)),
      "utf-8",
    ).toString("base64"),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    throw new Error(`getUploadUrl failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { upload_param?: string };
}

// ── CDN Upload ──────────────────────────────────────────────────────────────

const UPLOAD_MAX_RETRIES = 3;

async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam: string;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const ciphertext = encryptAesEcb(params.buf, params.aeskey);
  const cdnUrl = buildCdnUploadUrl({
    cdnBaseUrl: params.cdnBaseUrl,
    uploadParam: params.uploadParam,
    filekey: params.filekey,
  });

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? (await res.text());
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
        throw new Error(`CDN upload server error: ${errMsg}`);
      }
      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt >= UPLOAD_MAX_RETRIES) break;
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}

// ── High-level upload ───────────────────────────────────────────────────────

async function uploadMediaToCdn(params: {
  filePath: string;
  toUserId: string;
  opts: ClientOptions;
  cdnBaseUrl: string;
  mediaType: number;
}): Promise<UploadedFileInfo> {
  const plaintext = await fs.readFile(params.filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await getUploadUrl({
    ...params.opts,
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadParam) {
    throw new Error("getUploadUrl returned no upload_param");
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    filekey,
    cdnBaseUrl: params.cdnBaseUrl,
    aeskey,
  });

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

export async function uploadImage(
  filePath: string,
  toUserId: string,
  opts: ClientOptions,
  cdnBaseUrl = CDN_BASE_URL,
): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    filePath,
    toUserId,
    opts,
    cdnBaseUrl,
    mediaType: UploadMediaType.IMAGE,
  });
}

export async function uploadVideo(
  filePath: string,
  toUserId: string,
  opts: ClientOptions,
  cdnBaseUrl = CDN_BASE_URL,
): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    filePath,
    toUserId,
    opts,
    cdnBaseUrl,
    mediaType: UploadMediaType.VIDEO,
  });
}

export async function uploadFile(
  filePath: string,
  toUserId: string,
  opts: ClientOptions,
  cdnBaseUrl = CDN_BASE_URL,
): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({
    filePath,
    toUserId,
    opts,
    cdnBaseUrl,
    mediaType: UploadMediaType.FILE,
  });
}

// ── MIME ─────────────────────────────────────────────────────────────────────

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function getMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

// ── AES Key Resolution (matching official SDK) ────────────────────────────

/**
 * Resolve the 16-byte AES key from image/file item.
 * Priority: item.aeskey (hex) > item.media.aes_key (base64, possibly hex-inside-base64)
 */
export function resolveAesKey(opts: {
  aeskey?: string;
  media?: CDNMedia;
}): Buffer | null {
  // Priority 1: direct hex-encoded key (e.g., image_item.aeskey)
  if (opts.aeskey?.trim()) {
    const key = Buffer.from(opts.aeskey, "hex");
    if (key.length === 16) return key;
  }

  // Priority 2: base64-encoded key from media.aes_key
  const b64Key = opts.media?.aes_key;
  if (!b64Key?.trim()) return null;

  const decoded = Buffer.from(b64Key, "base64");
  if (decoded.length === 16) {
    // Direct 16 raw bytes
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    // 32 ASCII hex chars inside base64 → decode again to get 16 bytes
    return Buffer.from(decoded.toString("ascii"), "hex");
  }

  return null;
}

// ── AES-128-ECB Decrypt ───────────────────────────────────────────────────

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── CDN Download ──────────────────────────────────────────────────────────

export async function downloadFromCdn(opts: {
  media?: CDNMedia;
  aeskey?: string;
  cdnBaseUrl?: string;
}): Promise<Buffer> {
  const media = opts.media;
  if (!media?.encrypt_query_param) {
    throw new Error("No encrypt_query_param in media");
  }

  const baseUrl = opts.cdnBaseUrl ?? CDN_BASE_URL;
  const url = `${baseUrl}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CDN download failed: ${res.status} ${res.statusText}`);
  }

  const raw = Buffer.from(await res.arrayBuffer());

  const key = resolveAesKey({ aeskey: opts.aeskey, media });
  if (key) {
    return decryptAesEcb(raw, key);
  }
  return raw;
}

/** Detect image format from magic bytes and return extension */
export function detectImageExt(data: Buffer): string {
  if (data.length < 4) return ".bin";
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return ".jpg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return ".png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return ".gif";
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57 && data[9] === 0x45) return ".webp";
  if (data[0] === 0x42 && data[1] === 0x4D) return ".bmp";
  return ".bin";
}
