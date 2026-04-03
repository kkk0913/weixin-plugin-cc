import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { WeixinClient } from './api.js';
import type { CDNMedia } from './types.js';
import { MediaType, type MediaTypeValue } from './types.js';
import { encryptAesEcb, decryptAesEcb, generateAesKey, aesEcbPaddedSize } from './crypto.js';
import { generateFileKey } from '../util/helpers.js';

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
    aes_key: Buffer.from(aesKey).toString('base64'),
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
  const ext = '.bin';
  const fileName = `${generateFileKey()}${ext}`;
  const filePath = join(inboxDir, fileName);
  writeFileSync(filePath, decrypted);

  return filePath;
}
