// ─── Message Item Types ─────────────────────────────────────────────
export const MessageType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// ─── CDN Media Reference ───────────────────────────────────────────
export interface CDNMedia {
  encrypt_query_param: string;
  aes_key: string; // base64 encoded
  encrypt_type: number; // 0 = fileid only, 1 = bundled
  full_url?: string;
}

// ─── Message Items ──────────────────────────────────────────────────
export interface TextItem {
  text: string;
}

export interface ImageItem {
  media: CDNMedia;
  mid_size?: number;
  thumb_size?: number;
}

export interface VoiceItem {
  media: CDNMedia;
  playtime?: number;
  text?: string; // speech-to-text transcription
}

export interface FileItem {
  media: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media: CDNMedia;
  video_size?: number;
  play_length?: number;
}

export interface RefMessage {
  title?: string;
  message_item?: MessageItem;
}

export interface MessageItem {
  type: MessageTypeValue;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  ref_msg?: RefMessage;
}

// ─── Core Message ───────────────────────────────────────────────────
export const MessageKind = {
  USER: 1,
  BOT: 2,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface WeixinMessage {
  seq: number;
  message_id: number;
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  create_time_ms: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type: number; // 1 = USER, 2 = BOT
  message_state: number; // 0 = NEW, 1 = GENERATING, 2 = FINISH
  item_list: MessageItem[];
  context_token: string;
}

// ─── API Types ──────────────────────────────────────────────────────
export interface BaseInfo {
  channel_version: string;
}

export interface GetUpdatesReq {
  get_updates_buf: string;
  base_info: BaseInfo;
}

export interface GetUpdatesResp {
  ret: number;
  errcode: number;
  errmsg: string;
  msgs: WeixinMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
}

export interface SendMessageReq {
  msg: WeixinMessage;
  base_info: BaseInfo;
}

export interface SendMessageResp {
  ret: number;
  errcode: number;
  errmsg: string;
}

export interface GetUploadUrlReq {
  filekey: string;
  media_type: number; // 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number; // AES padded size
  aeskey: string; // hex
  no_need_thumb: boolean;
}

export interface GetUploadUrlResp {
  upload_param: string;
  thumb_upload_param: string;
  upload_full_url: string;
}

export interface GetConfigReq {
  ilink_user_id: string;
  context_token?: string;
  base_info: BaseInfo;
}

export interface GetConfigResp {
  ret: number;
  errmsg: string;
  typing_ticket: string;
}

export interface SendTypingReq {
  ilink_user_id: string;
  typing_ticket: string;
  status: number; // 1 = TYPING, 2 = CANCEL
}

export interface LoginQrResp {
  ret: number;
  errcode: number;
  errmsg: string;
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResp {
  ret: number;
  errcode: number;
  errmsg: string;
  status: string; // wait, scaned, expired, scaned_but_redirect, confirmed
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

// ─── Account Config ─────────────────────────────────────────────────
export interface AccountConfig {
  token: string;
  baseUrl: string;
  userId: string; // ilink_user_id
  ilinkBotId: string;
  qrcode?: string; // 登录用的 qrcode，用于状态查询
  qrcodeUrl?: string; // 扫码登录链接
  createdAt?: number; // token 创建时间戳
  expiresIn?: number; // token 有效期（秒）
}

// ─── Media Types ────────────────────────────────────────────────────
export const MediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];
