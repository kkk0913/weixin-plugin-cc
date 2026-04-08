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
  if (data.length > 12 && data.subarray(4, 8).toString('ascii') === 'ftyp') return '.mp4';
  if (data.subarray(0, 3).toString('ascii') === 'ID3') return '.mp3';
  if (data.length > 1 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return '.mp3';
  return '.bin';
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

/**
 * Upload a local file to WeChat CDN.
 * Returns a CDNMedia reference for embedding in a MessageItem.
 */
export async function uploadMedia(
  filePath: string,
  toUserId: string,
  mediaType: MediaTypeValue,
  client: WeixinClient,
): Promise<CDNMedia> {
  const fileData = readFileSync(filePath);
  const aesKey = generateAesKey();
  const fileKey = generateFileKey();
  const rawSize = fileData.length;
  const md5 = createHash('md5').update(fileData).digest('hex');
  const paddedSize = aesEcbPaddedSize(rawSize);

  // Encrypt file data
  const encrypted = encryptAesEcb(fileData, aesKey);

  // Get upload URL
  const uploadResp = await client.getUploadUrl({
    filekey: fileKey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize: rawSize,
    rawfilemd5: md5,
    filesize: paddedSize,
    aeskey: aesKey,
    no_need_thumb: true,
  });

  // Upload to CDN
  const uploadParam = JSON.parse(uploadResp.upload_param);
  const uploadUrl = uploadResp.upload_full_url;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(encrypted)]), uploadParam.name ?? 'file');

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    throw new Error(`CDN upload failed: HTTP ${resp.status}`);
  }

  return {
    encrypt_query_param: uploadParam.encrypt_query_param ?? '',
    aes_key: Buffer.from(aesKey, 'hex').toString('base64'),
    encrypt_type: 0,
  };
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
