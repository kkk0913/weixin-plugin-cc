import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { WeixinClient } from './api.js';
import type { CDNMedia } from './types.js';
import { MediaType, type MediaTypeValue } from './types.js';
import { encryptAesEcb, decryptAesEcb, generateAesKey, aesEcbPaddedSize } from './crypto.js';
import { generateFileKey } from '../util/helpers.js';

function hasPrefix(data: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => data[index] === byte);
}

function detectFileExtension(data: Buffer): string {
  if (hasPrefix(data, [0xff, 0xd8, 0xff])) return '.jpg';
  if (hasPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return '.png';
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a') return '.gif';
  if (data.subarray(0, 6).toString('ascii') === 'GIF89a') return '.gif';
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return '.webp';
  if (data.subarray(0, 4).toString('ascii') === '%PDF') return '.pdf';
  if (hasPrefix(data, [0x50, 0x4b, 0x03, 0x04])) return '.zip';

  // ISO Base Media (ftyp box) - MP4/MOV/M4V, etc. Check brand for more specificity
  if (data.length > 16 && data.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('ascii');
    // QuickTime brand
    if (brand === 'qt  ') return '.mov';
    // MP4 brands
    if (['isom', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)) return '.mp4';
    // M4A audio
    if (brand === 'M4A ') return '.m4a';
    // Generic ftyp container
    return '.mp4';
  }

  if (data.subarray(0, 3).toString('ascii') === 'ID3') return '.mp3';
  if (data.length > 1 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return '.mp3';
  return '.bin';
}

function extractEncryptQueryParam(
  uploadResp: { upload_param?: string; upload_full_url?: string },
  responseHeaderValue?: string | null,
): string {
  if (responseHeaderValue) {
    return responseHeaderValue;
  }
  if (uploadResp.upload_param) {
    try {
      const uploadParam = JSON.parse(uploadResp.upload_param) as { encrypt_query_param?: string };
      if (uploadParam.encrypt_query_param) {
        return uploadParam.encrypt_query_param;
      }
    } catch {
      // Fall through to upload_full_url parsing.
    }
  }

  if (uploadResp.upload_full_url) {
    const url = new URL(uploadResp.upload_full_url);
    return url.searchParams.get('encrypted_query_param')
      ?? url.searchParams.get('encrypt_query_param')
      ?? '';
  }

  return '';
}

/** Maps MessageType → MediaType */
export function messageItemToMediaType(type: number): MediaTypeValue {
  switch (type) {
    case 2: return MediaType.IMAGE;
    case 3: return MediaType.VOICE;
    case 4: return MediaType.FILE;
    case 5: return MediaType.VIDEO;
    default: return MediaType.FILE;
  }
}

export interface UploadMediaResult {
  media: CDNMedia;
  rawSize: number;
  paddedSize: number;
  rawMd5: string;
  encryptedMd5: string;
  uploadMethod: 'PUT' | 'POST';
}

/**
 * Upload a local file to WeChat CDN.
 * Returns a CDNMedia reference for embedding in a MessageItem.
 */
export async function uploadMediaDetailed(
  filePath: string,
  toUserId: string,
  mediaType: MediaTypeValue,
  client: WeixinClient,
  debug?: (msg: string) => void,
): Promise<UploadMediaResult> {
  const fileData = readFileSync(filePath);
  const aesKey = generateAesKey();
  const fileKey = generateFileKey();
  const rawSize = fileData.length;
  const rawMd5 = createHash('md5').update(fileData).digest('hex');
  const paddedSize = aesEcbPaddedSize(rawSize);

  // Encrypt file data
  const encrypted = encryptAesEcb(fileData, aesKey);
  const encryptedMd5 = createHash('md5').update(encrypted).digest('hex');

  // Get upload URL
  const uploadResp = await client.getUploadUrl({
    filekey: fileKey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize: rawSize,
    rawfilemd5: rawMd5,
    filesize: paddedSize,
    aeskey: aesKey,
    no_need_thumb: true,
  });

  const uploadUrl = uploadResp.upload_full_url;
  if (!uploadUrl) {
    throw new Error('CDN upload failed: missing upload_full_url');
  }

  // Current Weixin gateway returns a direct CDN upload URL. In practice the
  // CDN accepts POST uploads for file payloads even when upload_param is
  // omitted, so derive encrypt_query_param from either the legacy upload_param
  // JSON or the upload URL itself.
  const requestInit = {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(encrypted.length),
    },
    body: new Uint8Array(encrypted),
  } satisfies RequestInit;

  let uploadMethod: 'PUT' | 'POST' = 'PUT';
  let resp = await fetch(uploadUrl, { ...requestInit, method: uploadMethod });
  if (!resp.ok) {
    debug?.(`uploadMedia: PUT failed user=${toUserId} mediaType=${mediaType} status=${resp.status}, retrying POST`);
    uploadMethod = 'POST';
    resp = await fetch(uploadUrl, { ...requestInit, method: uploadMethod });
  }

  if (!resp.ok) {
    throw new Error(`CDN upload failed: HTTP ${resp.status} (${uploadMethod})`);
  }

  const media: CDNMedia = {
    encrypt_query_param: extractEncryptQueryParam(uploadResp, resp.headers.get('x-encrypted-param')),
    // Match the observed openclaw-weixin outbound shape: base64(hex string),
    // not base64(raw 16 bytes).
    aes_key: Buffer.from(aesKey, 'utf8').toString('base64'),
    encrypt_type: 1,
  };
  return { media, rawSize, paddedSize, rawMd5, encryptedMd5, uploadMethod };
}

export async function uploadMedia(
  filePath: string,
  toUserId: string,
  mediaType: MediaTypeValue,
  client: WeixinClient,
  debug?: (msg: string) => void,
): Promise<CDNMedia> {
  const result = await uploadMediaDetailed(filePath, toUserId, mediaType, client, debug);
  return result.media;
}

/**
 * Download a media file from WeChat CDN.
 * Returns the local file path where the decrypted file was saved.
 */
export async function downloadMedia(
  cdnMedia: CDNMedia,
  inboxDir: string,
): Promise<string> {
  mkdirSync(inboxDir, { recursive: true });

  // Download encrypted data
  const url = cdnMedia.full_url ?? cdnMedia.encrypt_query_param;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`CDN download failed: HTTP ${resp.status}`);
  }
  const encrypted = Buffer.from(await resp.arrayBuffer());

  // Decrypt
  const aesKey = Buffer.from(cdnMedia.aes_key, 'base64').toString('hex');
  const decrypted = decryptAesEcb(encrypted, aesKey);

  // Save to inbox
  const ext = detectFileExtension(decrypted);
  const fileName = `${generateFileKey()}${ext}`;
  const filePath = join(inboxDir, fileName);
  writeFileSync(filePath, decrypted);

  return filePath;
}
