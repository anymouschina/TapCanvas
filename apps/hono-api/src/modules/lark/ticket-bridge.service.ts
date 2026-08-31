import { randomUUID, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { PrismaClient } from "../../types";
import type { AppContext } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";
import { AppError } from "../../middleware/error";
import { getProjectById } from "../project/project.repo";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";
const WECOM_TICKET_SCOPE = "ticket";
const TARGET_CHAT_DEFAULT = "oc_a8d7a2d6f4f01b3d6a6c0f7b4d2b9b4c";
const TARGET_MENTION_MOBILE_DEFAULT = "13000000000";

type TicketChannel = "wecom";
type TicketDirection = "inbound" | "outbound";
type TicketMappingKind = "forward" | "reply";
type TicketMessageKind = "text" | "image" | "unknown";

type WecomTicketConfig = {
  enabled: boolean;
  corpId: string;
  agentId: string;
  secret: string;
  token: string;
  aesKey: string;
  targetChatId: string;
  targetMentionMobiles: string[];
  brandName: string;
};

type WecomEnvelope = {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: string;
  content: string | null;
  msgId: string | null;
  agentId: string | null;
  picUrl: string | null;
  mediaId: string | null;
  fileName: string | null;
  event: string | null;
  eventKey: string | null;
};

type TicketRouteRow = {
  id: string;
  owner_id: string;
  project_id: string | null;
  source_channel: string;
  source_scope: string;
  source_external_user_id: string;
  source_open_conversation_id: string | null;
  target_channel: string;
  target_chat_id: string;
  target_thread_id: string | null;
  target_root_message_id: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type TicketMessageRow = {
  id: string;
  route_id: string;
  direction: string;
  channel: string;
  external_message_id: string | null;
  external_reply_to_message_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  message_kind: string;
  text_content: string | null;
  image_keys_json: string | null;
  raw_payload_json: string | null;
  created_at: string;
};

let schemaEnsured = false;
let schemaEnsuring: Promise<void> | null = null;
const wecomTokenCache = new Map<string, { token: string; expiresAt: number }>();
const feishuTenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function maybeString(value: unknown): string | null {
  const out = trimString(value);
  return out || null;
}

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileExtensionFromContentType(contentType: string): string {
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpeg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/bmp") return ".bmp";
  if (normalized === "image/heic") return ".heic";
  if (normalized === "image/heif") return ".heif";
  return ".jpeg";
}

function normalizeImageFilename(filename: string, contentType: string): string {
  const trimmed = filename.trim();
  const ext = fileExtensionFromContentType(contentType);
  if (!trimmed) return `ticket-image${ext}`;
  const lastSegment = trimmed.split(/[\\/]/).pop() || trimmed;
  const lower = lastSegment.toLowerCase();
  const knownSuffixes = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".bin"];
  for (const suffix of knownSuffixes) {
    if (lower.endsWith(suffix)) {
      const base = lastSegment.slice(0, -suffix.length).replace(/[.]+$/, "") || "ticket-image";
      return `${base}${ext}`;
    }
  }
  if (lastSegment.includes(".")) return lastSegment;
  return `${lastSegment}${ext}`;
}

function buildTicketConfig(c: AppContext): WecomTicketConfig {
  const corpId = trimString(c.env.WECOM_TICKET_CORP_ID);
  const agentId = trimString(c.env.WECOM_TICKET_AGENT_ID);
  const secret = trimString(c.env.WECOM_TICKET_AGENT_SECRET);
  const token = trimString(c.env.WECOM_TICKET_TOKEN);
  const aesKey = trimString(c.env.WECOM_TICKET_AES_KEY);
  const targetChatId = trimString(c.env.WECOM_TICKET_FEISHU_CHAT_ID) || TARGET_CHAT_DEFAULT;
  const targetMentionMobiles = parseCsvList(trimString(c.env.WECOM_TICKET_FEISHU_MENTION_MOBILES) || TARGET_MENTION_MOBILE_DEFAULT);
  const brandName = trimString(c.env.WECOM_TICKET_BRAND_NAME) || "TapCanvas 工单机器人";
  const enabled = Boolean(corpId && agentId && secret && token && aesKey && targetChatId);
  return {
    enabled,
    corpId,
    agentId,
    secret,
    token,
    aesKey,
    targetChatId,
    targetMentionMobiles,
    brandName,
  };
}

async function hasColumn(db: PrismaClient, table: string, column: string): Promise<boolean> {
  const rows = await queryAll<{ name: string }>(db, `PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

export async function ensureTicketBridgeSchema(db: PrismaClient): Promise<void> {
  if (schemaEnsured) return;
  if (schemaEnsuring) {
    await schemaEnsuring;
    return;
  }
  schemaEnsuring = (async () => {
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS ticket_bridge_routes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT,
        source_channel TEXT NOT NULL,
        source_scope TEXT NOT NULL,
        source_external_user_id TEXT NOT NULL,
        source_open_conversation_id TEXT,
        target_channel TEXT NOT NULL,
        target_chat_id TEXT NOT NULL,
        target_thread_id TEXT,
        target_root_message_id TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      )`,
    );
    await execute(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_bridge_route_source
       ON ticket_bridge_routes(source_channel, source_scope, source_external_user_id, target_chat_id)`,
    );
    await execute(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ticket_bridge_route_owner_status
       ON ticket_bridge_routes(owner_id, status, updated_at DESC)`,
    );
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS ticket_bridge_messages (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        channel TEXT NOT NULL,
        external_message_id TEXT,
        external_reply_to_message_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        message_kind TEXT NOT NULL,
        text_content TEXT,
        image_keys_json TEXT,
        raw_payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (route_id) REFERENCES ticket_bridge_routes(id)
      )`,
    );
    await execute(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_bridge_messages_external
       ON ticket_bridge_messages(channel, external_message_id)`,
    );
    await execute(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ticket_bridge_messages_route_created
       ON ticket_bridge_messages(route_id, created_at DESC)`,
    );
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS ticket_bridge_mappings (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        target_message_id TEXT NOT NULL,
        target_chat_id TEXT,
        target_thread_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (route_id) REFERENCES ticket_bridge_routes(id)
      )`,
    );
    await execute(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_bridge_mapping_source_target
       ON ticket_bridge_mappings(kind, source_message_id, target_message_id)`,
    );
    await execute(
      db,
      `CREATE INDEX IF NOT EXISTS idx_ticket_bridge_mapping_target
       ON ticket_bridge_mappings(target_message_id, kind, created_at DESC)`,
    );
    if (!(await hasColumn(db, "user_lark_apps", "ticket_chat_id"))) {
      await execute(db, `ALTER TABLE user_lark_apps ADD COLUMN ticket_chat_id TEXT`);
    }
    if (!(await hasColumn(db, "user_lark_apps", "ticket_mention_mobiles"))) {
      await execute(db, `ALTER TABLE user_lark_apps ADD COLUMN ticket_mention_mobiles TEXT`);
    }
    schemaEnsured = true;
  })();
  try {
    await schemaEnsuring;
  } finally {
    schemaEnsuring = null;
  }
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function xmlText(root: Element, tag: string): string | null {
  const node = root.getElementsByTagName(tag)[0];
  const text = node?.textContent?.trim() || "";
  return text || null;
}

function parseWecomXml(xml: string): WecomEnvelope {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  return {
    toUserName: trimString(xmlText(root, "ToUserName")),
    fromUserName: trimString(xmlText(root, "FromUserName")),
    createTime: Number(xmlText(root, "CreateTime") || 0),
    msgType: trimString(xmlText(root, "MsgType")) || "unknown",
    content: maybeString(xmlText(root, "Content")),
    msgId: maybeString(xmlText(root, "MsgId")),
    agentId: maybeString(xmlText(root, "AgentID")),
    picUrl: maybeString(xmlText(root, "PicUrl")),
    mediaId: maybeString(xmlText(root, "MediaId")),
    fileName: maybeString(xmlText(root, "FileName")),
    event: maybeString(xmlText(root, "Event")),
    eventKey: maybeString(xmlText(root, "EventKey")),
  };
}

function decodeBase64(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1] || 0;
  if (pad <= 0 || pad > 32) return buffer;
  return buffer.subarray(0, buffer.length - pad);
}

function pkcs7Pad(buffer: Buffer): Buffer {
  const blockSize = 32;
  const remainder = buffer.length % blockSize;
  const padLength = remainder === 0 ? blockSize : blockSize - remainder;
  const pad = Buffer.alloc(padLength, padLength);
  return Buffer.concat([buffer, pad]);
}

function parseCorpMessage(buffer: Buffer): { xml: string; receiveId: string } {
  const content = pkcs7Unpad(buffer);
  const xmlLength = content.readUInt32BE(16);
  const xml = content.subarray(20, 20 + xmlLength).toString("utf8");
  const receiveId = content.subarray(20 + xmlLength).toString("utf8");
  return { xml, receiveId };
}

function random16(): Buffer {
  return Buffer.from(randomUUID().replace(/-/g, "").slice(0, 16), "utf8");
}

function encryptWecomXml(xml: string, aesKey: string, corpId: string): string {
  const key = decodeBase64(`${aesKey}=`);
  const iv = key.subarray(0, 16);
  const xmlBuffer = Buffer.from(xml, "utf8");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(xmlBuffer.length, 0);
  const corpBuffer = Buffer.from(corpId, "utf8");
  const plain = Buffer.concat([random16(), lengthBuffer, xmlBuffer, corpBuffer]);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(pkcs7Pad(plain)), cipher.final()]);
  return encrypted.toString("base64");
}

function decryptWecomXml(encrypted: string, aesKey: string): { xml: string; receiveId: string } {
  const key = decodeBase64(`${aesKey}=`);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  return parseCorpMessage(plain);
}

function buildWecomSignature(token: string, timestamp: string, nonce: string, encrypted: string): string {
  const sha = createHash("sha1");
  sha.update([token, timestamp, nonce, encrypted].sort().join(""), "utf8");
  return sha.digest("hex");
}

function responseXmlForWecom(input: { token: string; aesKey: string; corpId: string; nonce: string; timestamp: string }): string {
  const encrypted = encryptWecomXml("success", input.aesKey, input.corpId);
  const msgSignature = buildWecomSignature(input.token, input.timestamp, input.nonce, encrypted);
  return `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt><MsgSignature><![CDATA[${msgSignature}]]></MsgSignature><TimeStamp>${input.timestamp}</TimeStamp><Nonce><![CDATA[${input.nonce}]]></Nonce></xml>`;
}

async function fetchWecomAccessToken(config: WecomTicketConfig): Promise<string> {
  const cacheKey = `${config.corpId}:${config.secret}`;
  const cached = wecomTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`;
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (!res.ok || data.errcode !== 0 || !data.access_token) {
    throw new AppError(`WeCom gettoken failed: ${data.errmsg || res.statusText || "unknown"}`, { status: 502, code: "wecom_gettoken_failed" });
  }
  const ttlMs = Math.max(60, (Number(data.expires_in || 7200) - 300)) * 1000;
  wecomTokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + ttlMs });
  return data.access_token;
}

async function fetchFeishuTenantToken(c: AppContext, ownerId: string): Promise<string> {
  const creds = await queryOne<{ app_id: string; app_secret: string; brand: string }>(
    c.env.DB,
    `SELECT app_id, app_secret, brand FROM user_lark_apps WHERE user_id = ?`,
    [ownerId],
  );
  if (!creds) {
    throw new AppError("Feishu app not configured for ticket owner", { status: 400, code: "ticket_feishu_app_missing" });
  }
  const cacheKey = `${ownerId}:${creds.app_id}:${creds.brand}`;
  const cached = feishuTenantTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const base = creds.brand === "lark" ? "https://open.larksuite.com/open-apis" : FEISHU_API_BASE;
  const res = await fetch(`${base}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: creds.app_id, app_secret: creds.app_secret }),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new AppError(`Feishu tenant token failed: ${data.msg || res.statusText || "unknown"}`, { status: 502, code: "ticket_feishu_token_failed" });
  }
  const ttlMs = Math.max(60, (Number(data.expire || 7200) - 300)) * 1000;
  feishuTenantTokenCache.set(cacheKey, { token: data.tenant_access_token, expiresAt: Date.now() + ttlMs });
  return data.tenant_access_token;
}

function buildTicketTitle(projectName: string | null, sender: string, messageText: string | null): string {
  const prefix = projectName ? `[${projectName}]` : "[企微工单]";
  const summary = (messageText || "图片/事件消息").replace(/\s+/g, " ").slice(0, 80);
  return `${prefix} ${sender}: ${summary}`;
}

async function ensureRoute(
  c: AppContext,
  input: {
    ownerId: string;
    projectId?: string | null;
    externalUserId: string;
    openConversationId?: string | null;
    targetChatId: string;
    title: string;
  },
): Promise<TicketRouteRow> {
  await ensureTicketBridgeSchema(c.env.DB);
  const existing = await queryOne<TicketRouteRow>(
    c.env.DB,
    `SELECT * FROM ticket_bridge_routes
     WHERE source_channel = ? AND source_scope = ? AND source_external_user_id = ? AND target_chat_id = ?
     LIMIT 1`,
    ["wecom", WECOM_TICKET_SCOPE, input.externalUserId, input.targetChatId],
  );
  const nowIso = new Date().toISOString();
  if (existing) {
    await execute(
      c.env.DB,
      `UPDATE ticket_bridge_routes
       SET updated_at = ?, project_id = COALESCE(?, project_id), source_open_conversation_id = COALESCE(?, source_open_conversation_id), title = COALESCE(?, title), status = 'open', closed_at = NULL
       WHERE id = ?`,
      [nowIso, input.projectId ?? null, input.openConversationId ?? null, input.title, existing.id],
    );
    const refreshed = await queryOne<TicketRouteRow>(c.env.DB, `SELECT * FROM ticket_bridge_routes WHERE id = ?`, [existing.id]);
    if (!refreshed) throw new Error("ticket route not found after update");
    return refreshed;
  }
  const id = randomUUID();
  await execute(
    c.env.DB,
    `INSERT INTO ticket_bridge_routes (
      id, owner_id, project_id, source_channel, source_scope, source_external_user_id, source_open_conversation_id,
      target_channel, target_chat_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ownerId,
      input.projectId ?? null,
      "wecom",
      WECOM_TICKET_SCOPE,
      input.externalUserId,
      input.openConversationId ?? null,
      "feishu",
      input.targetChatId,
      input.title,
      "open",
      nowIso,
      nowIso,
    ],
  );
  const created = await queryOne<TicketRouteRow>(c.env.DB, `SELECT * FROM ticket_bridge_routes WHERE id = ?`, [id]);
  if (!created) throw new Error("ticket route not found after insert");
  return created;
}

async function insertMessage(
  c: AppContext,
  input: {
    routeId: string;
    direction: TicketDirection;
    channel: TicketChannel | "feishu";
    externalMessageId?: string | null;
    externalReplyToMessageId?: string | null;
    senderId?: string | null;
    senderName?: string | null;
    messageKind: TicketMessageKind;
    textContent?: string | null;
    imageKeys?: string[];
    rawPayload?: Record<string, unknown> | null;
  },
): Promise<TicketMessageRow> {
  await ensureTicketBridgeSchema(c.env.DB);
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  await execute(
    c.env.DB,
    `INSERT INTO ticket_bridge_messages (
      id, route_id, direction, channel, external_message_id, external_reply_to_message_id,
      sender_id, sender_name, message_kind, text_content, image_keys_json, raw_payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.routeId,
      input.direction,
      input.channel,
      input.externalMessageId ?? null,
      input.externalReplyToMessageId ?? null,
      input.senderId ?? null,
      input.senderName ?? null,
      input.messageKind,
      input.textContent ?? null,
      input.imageKeys && input.imageKeys.length ? JSON.stringify(input.imageKeys) : null,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      nowIso,
    ],
  );
  const row = await queryOne<TicketMessageRow>(c.env.DB, `SELECT * FROM ticket_bridge_messages WHERE id = ?`, [id]);
  if (!row) throw new Error("ticket message not found after insert");
  return row;
}

async function insertMapping(
  c: AppContext,
  input: {
    routeId: string;
    kind: TicketMappingKind;
    sourceMessageId: string;
    targetMessageId: string;
    targetChatId?: string | null;
    targetThreadId?: string | null;
  },
): Promise<void> {
  await ensureTicketBridgeSchema(c.env.DB);
  await execute(
    c.env.DB,
    `INSERT INTO ticket_bridge_mappings (
      id, route_id, kind, source_message_id, target_message_id, target_chat_id, target_thread_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      input.routeId,
      input.kind,
      input.sourceMessageId,
      input.targetMessageId,
      input.targetChatId ?? null,
      input.targetThreadId ?? null,
      new Date().toISOString(),
    ],
  );
}

async function updateRouteRootMessage(c: AppContext, routeId: string, messageId: string): Promise<void> {
  await execute(
    c.env.DB,
    `UPDATE ticket_bridge_routes SET target_root_message_id = COALESCE(target_root_message_id, ?), updated_at = ? WHERE id = ?`,
    [messageId, new Date().toISOString(), routeId],
  );
}

async function uploadImageBufferToFeishu(c: AppContext, ownerId: string, input: { buffer: Buffer; contentType: string; filename: string }): Promise<string> {
  const token = await fetchFeishuTenantToken(c, ownerId);
  const boundary = `----tapcanvas-${randomUUID()}`;
  const normalizedFilename = normalizeImageFilename(input.filename, input.contentType);
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\nmessage\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${normalizedFilename}"\r\nContent-Type: ${input.contentType}\r\n\r\n`),
    input.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const res = await fetch(`${FEISHU_API_BASE}/im/v1/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(chunks),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: { image_key?: string } };
  const imageKey = trimString(data?.data?.image_key);
  if (!res.ok || data.code !== 0 || !imageKey) {
    throw new AppError(`Feishu image upload failed: ${data.msg || res.statusText || "unknown"}`, { status: 502, code: "ticket_feishu_image_upload_failed" });
  }
  return imageKey;
}

async function uploadImageFromUrlToFeishu(c: AppContext, ownerId: string, imageUrl: string): Promise<string> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) {
    throw new AppError(`Failed to download WeCom image: ${imageRes.status}`, { status: 502, code: "ticket_wecom_image_download_failed" });
  }
  const contentType = trimString(imageRes.headers.get("content-type")) || "image/jpeg";
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  return uploadImageBufferToFeishu(c, ownerId, {
    buffer,
    contentType,
    filename: normalizeImageFilename("ticket-image", contentType),
  });
}

async function fetchWecomMediaBuffer(config: WecomTicketConfig, mediaId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const accessToken = await fetchWecomAccessToken(config);
  const res = await fetch(`${WECOM_API_BASE}/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`);
  if (!res.ok) {
    throw new AppError(`Failed to fetch WeCom media: ${res.status}`, { status: 502, code: "ticket_wecom_media_fetch_failed" });
  }
  const contentType = trimString(res.headers.get("content-type")) || "image/jpeg";
  if (contentType.includes("application/json")) {
    const body = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    throw new AppError(`Failed to fetch WeCom media: ${body.errmsg || "unknown"}`, { status: 502, code: "ticket_wecom_media_fetch_failed" });
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

async function uploadWecomImageToFeishu(
  c: AppContext,
  input: {
    ownerId: string;
    config: WecomTicketConfig;
    mediaId?: string | null;
    picUrl?: string | null;
    fileName?: string | null;
  },
): Promise<string> {
  if (input.mediaId) {
    const media = await fetchWecomMediaBuffer(input.config, input.mediaId);
    return uploadImageBufferToFeishu(c, input.ownerId, {
      buffer: media.buffer,
      contentType: media.contentType,
      filename: normalizeImageFilename(input.fileName || `wecom-${input.mediaId}`, media.contentType),
    });
  }
  if (input.picUrl) {
    return uploadImageFromUrlToFeishu(c, input.ownerId, input.picUrl);
  }
  throw new AppError("WeCom image message missing media source", { status: 400, code: "ticket_wecom_image_missing" });
}

async function sendFeishuMessage(
  c: AppContext,
  input: {
    ownerId: string;
    chatId: string;
    msgType: "text" | "post" | "image";
    content: Record<string, unknown>;
    replyInThread?: boolean;
    replyMessageId?: string | null;
  },
): Promise<{ messageId: string; threadId: string | null }> {
  const token = await fetchFeishuTenantToken(c, input.ownerId);
  const res = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: input.chatId,
      msg_type: input.msgType,
      content: JSON.stringify(input.content),
      ...(input.replyInThread && input.replyMessageId ? { reply_in_thread: true, reply_message_id: input.replyMessageId } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: { message_id?: string; thread_id?: string; root_id?: string };
  };
  const messageId = trimString(data?.data?.message_id);
  if (!res.ok || data.code !== 0 || !messageId) {
    throw new AppError(`Feishu send message failed: ${data.msg || res.statusText || "unknown"}`, { status: 502, code: "ticket_feishu_send_failed" });
  }
  const threadId = trimString(data?.data?.thread_id) || trimString(data?.data?.root_id) || null;
  return { messageId, threadId };
}

function buildForwardTextBlock(input: { brandName: string; senderId: string; senderName: string; projectName: string | null; content: string | null }): string {
  const header = `【${input.brandName}】收到新的企微工单`;
  const projectLine = input.projectName ? `项目：${input.projectName}` : null;
  const userLine = `用户：${input.senderName} (${input.senderId})`;
  const body = input.content?.trim() || "[无文本，仅图片消息]";
  return [header, projectLine, userLine, "", body].filter(Boolean).join("\n");
}

function buildMentionPost(input: { title: string; bodyText: string; mentionMobiles: string[] }): Record<string, unknown> {
  const mentionNodes = input.mentionMobiles.map((mobile) => ({ tag: "at", user_id: mobile, user_name: mobile }));
  return {
    zh_cn: {
      title: input.title,
      content: [
        [{ tag: "text", text: input.bodyText }],
        mentionNodes.length ? mentionNodes : [{ tag: "text", text: "" }],
      ],
    },
  };
}

async function resolveProjectOwnerForTicket(c: AppContext, projectId: string | null): Promise<{ ownerId: string; projectName: string | null }> {
  if (!projectId) {
    throw new AppError("projectId is required for ticket routing", { status: 400, code: "ticket_project_required" });
  }
  const project = await getProjectById(c.env.DB, projectId);
  if (!project) {
    throw new AppError("Project not found", { status: 404, code: "ticket_project_not_found" });
  }
  return { ownerId: String(project.owner_id), projectName: trimString(project.name) || null };
}

function isMessageEvent(envelope: WecomEnvelope): boolean {
  return envelope.msgType === "text" || envelope.msgType === "image";
}

function assertWecomMessageSignature(token: string, timestamp: string, nonce: string, encrypted: string, msgSignature: string): void {
  const expected = buildWecomSignature(token, timestamp, nonce, encrypted);
  if (expected !== msgSignature) {
    throw new AppError("Invalid WeCom message signature", { status: 401, code: "ticket_wecom_signature_invalid" });
  }
}

export async function handleWecomTicketWebhook(c: AppContext, projectId: string | null): Promise<Response> {
  const config = buildTicketConfig(c);
  if (!config.enabled) {
    throw new AppError("WeCom ticket bridge not configured", { status: 503, code: "ticket_bridge_not_configured" });
  }
  const msgSignature = trimString(c.req.query("msg_signature"));
  const timestamp = trimString(c.req.query("timestamp"));
  const nonce = trimString(c.req.query("nonce"));
  const echostr = trimString(c.req.query("echostr"));
  if (echostr) {
    assertWecomMessageSignature(config.token, timestamp, nonce, echostr, msgSignature);
    const decrypted = decryptWecomXml(echostr, config.aesKey);
    return c.text(decrypted.xml);
  }
  const rawBody = await c.req.text();
  const bodyDoc = new DOMParser().parseFromString(rawBody, "text/xml");
  const bodyRoot = bodyDoc.documentElement;
  const encrypted = trimString(xmlText(bodyRoot, "Encrypt"));
  if (!encrypted) {
    throw new AppError("Missing Encrypt payload", { status: 400, code: "ticket_wecom_encrypt_missing" });
  }
  assertWecomMessageSignature(config.token, timestamp, nonce, encrypted, msgSignature);
  const decrypted = decryptWecomXml(encrypted, config.aesKey);
  if (decrypted.receiveId !== config.corpId) {
    throw new AppError("WeCom corpId mismatch", { status: 401, code: "ticket_wecom_receive_id_invalid" });
  }
  const envelope = parseWecomXml(decrypted.xml);
  if (!isMessageEvent(envelope)) {
    const responseXml = responseXmlForWecom({
      token: config.token,
      aesKey: config.aesKey,
      corpId: config.corpId,
      nonce,
      timestamp: timestamp || `${Math.floor(Date.now() / 1000)}`,
    });
    return c.body(responseXml, 200, { "Content-Type": "application/xml; charset=utf-8" });
  }

  const senderId = envelope.fromUserName || "unknown-user";
  const senderName = senderId;
  const { ownerId, projectName } = await resolveProjectOwnerForTicket(c, projectId);
  const title = buildTicketTitle(projectName, senderName, envelope.content);
  const route = await ensureRoute(c, {
    ownerId,
    projectId,
    externalUserId: senderId,
    openConversationId: envelope.toUserName || null,
    targetChatId: config.targetChatId,
    title,
  });
  const inbound = await insertMessage(c, {
    routeId: route.id,
    direction: "inbound",
    channel: "wecom",
    externalMessageId: envelope.msgId,
    senderId,
    senderName,
    messageKind: envelope.msgType === "image" ? "image" : "text",
    textContent: envelope.content,
    rawPayload: envelope as unknown as Record<string, unknown>,
  });

  const imageKey = envelope.msgType === "image"
    ? await uploadWecomImageToFeishu(c, {
        ownerId,
        config,
        mediaId: envelope.mediaId,
        picUrl: envelope.picUrl,
        fileName: envelope.fileName,
      })
    : null;

  if (imageKey) {
    const imageSent = await sendFeishuMessage(c, {
      ownerId,
      chatId: route.target_chat_id,
      msgType: "image",
      content: { image_key: imageKey },
    });
    await updateRouteRootMessage(c, route.id, imageSent.messageId);
    const outboundImage = await insertMessage(c, {
      routeId: route.id,
      direction: "outbound",
      channel: "feishu",
      externalMessageId: imageSent.messageId,
      senderName: config.brandName,
      messageKind: "image",
      imageKeys: [imageKey],
      textContent: envelope.picUrl || envelope.mediaId || null,
    });
    await insertMapping(c, {
      routeId: route.id,
      kind: "forward",
      sourceMessageId: inbound.id,
      targetMessageId: outboundImage.id,
      targetChatId: route.target_chat_id,
      targetThreadId: imageSent.threadId,
    });

    const bodyText = buildForwardTextBlock({
      brandName: config.brandName,
      senderId,
      senderName,
      projectName,
      content: envelope.content,
    });
    const post = buildMentionPost({ title, bodyText, mentionMobiles: config.targetMentionMobiles });
    const contextSent = await sendFeishuMessage(c, {
      ownerId,
      chatId: route.target_chat_id,
      msgType: "post",
      content: post,
      replyInThread: true,
      replyMessageId: imageSent.messageId,
    });
    const outboundContext = await insertMessage(c, {
      routeId: route.id,
      direction: "outbound",
      channel: "feishu",
      externalMessageId: contextSent.messageId,
      externalReplyToMessageId: imageSent.messageId,
      senderName: config.brandName,
      messageKind: "text",
      textContent: bodyText,
    });
    await insertMapping(c, {
      routeId: route.id,
      kind: "forward",
      sourceMessageId: inbound.id,
      targetMessageId: outboundContext.id,
      targetChatId: route.target_chat_id,
      targetThreadId: contextSent.threadId || imageSent.threadId,
    });
  } else {
    const bodyText = buildForwardTextBlock({
      brandName: config.brandName,
      senderId,
      senderName,
      projectName,
      content: envelope.content,
    });
    const post = buildMentionPost({ title, bodyText, mentionMobiles: config.targetMentionMobiles });
    const threadRoot = await sendFeishuMessage(c, {
      ownerId,
      chatId: route.target_chat_id,
      msgType: "post",
      content: post,
    });
    await updateRouteRootMessage(c, route.id, threadRoot.messageId);
    const outboundRoot = await insertMessage(c, {
      routeId: route.id,
      direction: "outbound",
      channel: "feishu",
      externalMessageId: threadRoot.messageId,
      senderName: config.brandName,
      messageKind: "text",
      textContent: bodyText,
    });
    await insertMapping(c, {
      routeId: route.id,
      kind: "forward",
      sourceMessageId: inbound.id,
      targetMessageId: outboundRoot.id,
      targetChatId: route.target_chat_id,
      targetThreadId: threadRoot.threadId,
    });
  }

  const responseXml = responseXmlForWecom({
    token: config.token,
    aesKey: config.aesKey,
    corpId: config.corpId,
    nonce,
    timestamp: timestamp || `${Math.floor(Date.now() / 1000)}`,
  });
  return c.body(responseXml, 200, { "Content-Type": "application/xml; charset=utf-8" });
}

async function findInboundWecomMessageByFeishuMessage(c: AppContext, messageId: string): Promise<{ route: TicketRouteRow; message: TicketMessageRow } | null> {
  await ensureTicketBridgeSchema(c.env.DB);
  const row = await queryOne<{ route_id: string; source_message_id: string }>(
    c.env.DB,
    `SELECT route_id, source_message_id FROM ticket_bridge_mappings WHERE target_message_id = ? ORDER BY created_at DESC LIMIT 1`,
    [messageId],
  );
  if (!row) return null;
  const route = await queryOne<TicketRouteRow>(c.env.DB, `SELECT * FROM ticket_bridge_routes WHERE id = ?`, [row.route_id]);
  const message = await queryOne<TicketMessageRow>(c.env.DB, `SELECT * FROM ticket_bridge_messages WHERE id = ?`, [row.source_message_id]);
  if (!route || !message) return null;
  return { route, message };
}

async function sendWecomAppMessage(config: WecomTicketConfig, toUser: string, content: string): Promise<void> {
  const accessToken = await fetchWecomAccessToken(config);
  const res = await fetch(`${WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: Number(config.agentId),
      text: { content },
      safe: 0,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
  if (!res.ok || data.errcode !== 0) {
    throw new AppError(`WeCom send message failed: ${data.errmsg || res.statusText || "unknown"}`, { status: 502, code: "ticket_wecom_send_failed" });
  }
}

export async function handleFeishuTicketReply(c: AppContext, projectId: string | null): Promise<Response> {
  await ensureTicketBridgeSchema(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const eventType = trimString(body.header && typeof body.header === "object" ? (body.header as Record<string, unknown>).event_type : "");
  if (eventType === "im.message.receive_v1") {
    const event = body.event && typeof body.event === "object" ? (body.event as Record<string, unknown>) : {};
    const message = event.message && typeof event.message === "object" ? (event.message as Record<string, unknown>) : {};
    const sender = event.sender && typeof event.sender === "object" ? (event.sender as Record<string, unknown>) : {};
    const senderId = sender.sender_id && typeof sender.sender_id === "object" ? (sender.sender_id as Record<string, unknown>) : {};
    const messageId = trimString(message.message_id);
    const parentId = trimString(message.parent_id) || trimString(message.root_id);
    const chatId = trimString(message.chat_id);
    const messageType = trimString(message.message_type);
    const contentObj = safeJsonParse(trimString(message.content)) || {};
    const textContent = trimString(contentObj.text);
    if (!messageId || !parentId || !chatId || messageType !== "text" || !textContent) {
      return c.json({ ok: true, skipped: true });
    }
    const inbound = await findInboundWecomMessageByFeishuMessage(c, parentId);
    if (!inbound) {
      return c.json({ ok: true, skipped: true, reason: "mapping_not_found" });
    }
    const route = inbound.route;
    if (projectId && route.project_id && projectId !== route.project_id) {
      throw new AppError("project mismatch for feishu reply", { status: 400, code: "ticket_project_mismatch" });
    }
    const config = buildTicketConfig(c);
    if (!config.enabled) {
      throw new AppError("WeCom ticket bridge not configured", { status: 503, code: "ticket_bridge_not_configured" });
    }
    await sendWecomAppMessage(config, route.source_external_user_id, textContent);
    const outboundWecom = await insertMessage(c, {
      routeId: route.id,
      direction: "outbound",
      channel: "wecom",
      externalReplyToMessageId: inbound.message.external_message_id,
      senderId: trimString(senderId.user_id) || trimString(senderId.open_id) || "feishu-bot",
      senderName: trimString((sender as Record<string, unknown>).name) || "飞书研发",
      messageKind: "text",
      textContent,
      rawPayload: body,
    });
    const feishuReply = await insertMessage(c, {
      routeId: route.id,
      direction: "inbound",
      channel: "feishu",
      externalMessageId: messageId,
      externalReplyToMessageId: parentId,
      senderId: trimString(senderId.user_id) || trimString(senderId.open_id),
      senderName: trimString((sender as Record<string, unknown>).name) || "飞书研发",
      messageKind: "text",
      textContent,
      rawPayload: body,
    });
    await insertMapping(c, {
      routeId: route.id,
      kind: "reply",
      sourceMessageId: feishuReply.id,
      targetMessageId: outboundWecom.id,
      targetChatId: chatId,
      targetThreadId: messageId,
    });
    return c.json({ ok: true, delivered: true });
  }
  return c.json({ ok: true, skipped: true, reason: "unsupported_event" });
}

export async function verifyWecomTicketHandshake(c: AppContext): Promise<Response> {
  const config = buildTicketConfig(c);
  if (!config.enabled) {
    throw new AppError("WeCom ticket bridge not configured", { status: 503, code: "ticket_bridge_not_configured" });
  }
  const msgSignature = trimString(c.req.query("msg_signature"));
  const timestamp = trimString(c.req.query("timestamp"));
  const nonce = trimString(c.req.query("nonce"));
  const echostr = trimString(c.req.query("echostr"));
  if (!msgSignature || !timestamp || !nonce || !echostr) {
    throw new AppError("missing handshake query params", { status: 400, code: "ticket_wecom_handshake_invalid" });
  }
  assertWecomMessageSignature(config.token, timestamp, nonce, echostr, msgSignature);
  const decrypted = decryptWecomXml(echostr, config.aesKey);
  return c.text(decrypted.xml);
}

export async function verifyFeishuCallback(body: Record<string, unknown>): Promise<Response | null> {
  const challenge = trimString(body.challenge);
  if (challenge) {
    return new Response(JSON.stringify({ challenge }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return null;
}
