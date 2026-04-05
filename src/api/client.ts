import crypto from "node:crypto";
import path from "node:path";
import type {
  BaseInfo,
  GetUpdatesResp,
  SendMessageReq,
  QRCodeResponse,
  QRStatusResponse,
  MessageItem,
  WeixinMessage,
} from "./types.js";
import {
  MessageType,
  MessageItemType,
  MessageState,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "standalone-cli-0.1.0";
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_BOT_TYPE = "3";

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export type ClientOptions = {
  baseUrl: string;
  token?: string;
  routeTag?: string;
};

function buildHeaders(opts: {
  token?: string;
  body: string;
  routeTag?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(opts.body, "utf-8")),
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  if (opts.routeTag) {
    headers.SKRouteTag = opts.routeTag;
  }
  return headers;
}

async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  routeTag?: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({
    token: params.token,
    body: params.body,
    routeTag: params.routeTag,
  });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

// ── QR Login ────────────────────────────────────────────────────────────────

export async function fetchQRCode(
  apiBaseUrl: string,
  botType = DEFAULT_BOT_TYPE,
  routeTag?: string,
): Promise<QRCodeResponse> {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    base,
  );

  const headers: Record<string, string> = {};
  if (routeTag) headers.SKRouteTag = routeTag;

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Failed to fetch QR code: ${response.status} ${response.statusText} body=${body}`);
  }
  return (await response.json()) as QRCodeResponse;
}

export async function pollQRStatus(
  apiBaseUrl: string,
  qrcode: string,
  routeTag?: string,
): Promise<QRStatusResponse> {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  );

  const headers: Record<string, string> = {
    "iLink-App-ClientVersion": "1",
  };
  if (routeTag) headers.SKRouteTag = routeTag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to poll QR status: ${response.status} ${response.statusText}`,
      );
    }
    return JSON.parse(rawText) as QRStatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "wait" };
    }
    throw err;
  }
}

// ── Message API ─────────────────────────────────────────────────────────────

export async function getUpdates(
  opts: ClientOptions & { getUpdatesBuf?: string },
): Promise<GetUpdatesResp> {
  const timeout = DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiFetch({
      baseUrl: opts.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: opts.getUpdatesBuf ?? "",
        base_info: buildBaseInfo(),
      }),
      token: opts.token,
      routeTag: opts.routeTag,
      timeoutMs: timeout,
      label: "getUpdates",
    });
    return JSON.parse(rawText) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: opts.getUpdatesBuf };
    }
    throw err;
  }
}

export async function sendMessage(
  opts: ClientOptions & {
    to: string;
    text: string;
    contextToken?: string;
  },
): Promise<{ messageId: string }> {
  const clientId = `wcli-${crypto.randomUUID()}`;
  const itemList: MessageItem[] = opts.text
    ? [{ type: MessageItemType.TEXT, text_item: { text: opts.text } }]
    : [];

  const body: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: opts.to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: itemList.length ? itemList : undefined,
      context_token: opts.contextToken ?? undefined,
    },
  };

  await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...body, base_info: buildBaseInfo() }),
    token: opts.token,
    routeTag: opts.routeTag,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });

  return { messageId: clientId };
}

/** Send a media message (image/video/file) after CDN upload. */
export async function sendMediaMessage(
  opts: ClientOptions & {
    to: string;
    text?: string;
    contextToken?: string;
    mediaItem: MessageItem;
  },
): Promise<{ messageId: string }> {
  const items: MessageItem[] = [];
  if (opts.text) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: opts.text } });
  }
  items.push(opts.mediaItem);

  let lastClientId = "";
  for (const item of items) {
    lastClientId = `wcli-${crypto.randomUUID()}`;
    const body: SendMessageReq = {
      msg: {
        from_user_id: "",
        to_user_id: opts.to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: opts.contextToken ?? undefined,
      },
    };
    await apiFetch({
      baseUrl: opts.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      body: JSON.stringify({ ...body, base_info: buildBaseInfo() }),
      token: opts.token,
      routeTag: opts.routeTag,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      label: "sendMediaMessage",
    });
  }

  return { messageId: lastClientId };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function extractTextFromMessage(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (!parts.length) return text;
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

/** Download media (image/file/video) from a message item, returns decrypted bytes or null */
export async function downloadMediaFromItem(item: MessageItem): Promise<{ data: Buffer; ext: string } | null> {
  const { downloadFromCdn, detectImageExt } = await import("./cdn.js");

  if (item.type === MessageItemType.IMAGE && item.image_item) {
    const img = item.image_item;
    const data = await downloadFromCdn({
      media: img.media,
      aeskey: img.aeskey,
    });
    return { data, ext: detectImageExt(data) };
  }

  if (item.type === MessageItemType.FILE && item.file_item?.media) {
    const file = item.file_item;
    const data = await downloadFromCdn({ media: file.media });
    const ext = file.file_name ? path.extname(file.file_name) || ".bin" : ".bin";
    return { data, ext };
  }

  if (item.type === MessageItemType.VIDEO && item.video_item?.media) {
    const data = await downloadFromCdn({ media: item.video_item.media });
    return { data, ext: ".mp4" };
  }

  return null;
}

export function describeMessageType(msg: WeixinMessage): string {
  const types = msg.item_list?.map((i) => {
    switch (i.type) {
      case MessageItemType.TEXT: return "文本";
      case MessageItemType.IMAGE: return "图片";
      case MessageItemType.VOICE: return "语音";
      case MessageItemType.FILE: return "文件";
      case MessageItemType.VIDEO: return "视频";
      default: return `未知(${i.type})`;
    }
  }) ?? [];
  return types.join("+");
}
