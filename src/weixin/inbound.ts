import { safeName, generateFileKey } from '../util/helpers.js';
import { downloadMedia } from './media.js';
import { MessageType, type CDNMedia, type WeixinMessage } from './types.js';

export interface ClaudeInboundPayload {
  text: string | null;
  imagePath?: string;
  attachmentFileIds: string[];
  attachmentNames: string[];
  attachmentFileId?: string;
  attachmentName?: string;
}

export interface CodexInboundPayload {
  text: string | null;
  imagePaths: string[];
  attachmentPaths: string[];
}

export interface PrepareClaudeInboundOptions {
  inboxDir: string;
  storeMediaHandle: (handle: string, media: CDNMedia) => void;
  onError?: (error: unknown) => void;
}

export interface PrepareCodexInboundOptions {
  inboxDir: string;
  onError?: (error: unknown) => void;
}

export function extractTextContent(msg: WeixinMessage): string | null {
  for (const item of msg.item_list) {
    if (item.type === MessageType.TEXT && item.text_item?.text) {
      return item.text_item.text;
    }
    if (item.type === MessageType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return null;
}

export async function prepareInboundForClaude(
  msg: WeixinMessage,
  opts: PrepareClaudeInboundOptions,
): Promise<ClaudeInboundPayload> {
  let imagePath: string | undefined;
  const attachmentFileIds: string[] = [];
  const attachmentNames: string[] = [];

  for (const item of msg.item_list) {
    try {
      if (item.type === MessageType.IMAGE && item.image_item?.media) {
        imagePath = await downloadMedia(item.image_item.media, opts.inboxDir);
      } else if (item.type === MessageType.FILE && item.file_item?.media) {
        const handle = generateFileKey();
        opts.storeMediaHandle(handle, item.file_item.media);
        attachmentFileIds.push(handle);
        const safe = safeName(item.file_item.file_name);
        if (safe) {
          attachmentNames.push(safe);
        }
      } else if (item.type === MessageType.VOICE && item.voice_item?.media) {
        const handle = generateFileKey();
        opts.storeMediaHandle(handle, item.voice_item.media);
        attachmentFileIds.push(handle);
        const safe = safeName(item.voice_item.text);
        if (safe) {
          attachmentNames.push(safe);
        }
      } else if (item.type === MessageType.VIDEO && item.video_item?.media) {
        const handle = generateFileKey();
        opts.storeMediaHandle(handle, item.video_item.media);
        attachmentFileIds.push(handle);
      }
    } catch (error) {
      opts.onError?.(error);
    }
  }

  return {
    text: extractTextContent(msg),
    imagePath,
    attachmentFileIds,
    attachmentNames,
    attachmentFileId: attachmentFileIds[0],
    attachmentName: attachmentNames[0],
  };
}

export async function prepareInboundForCodex(
  msg: WeixinMessage,
  opts: PrepareCodexInboundOptions,
): Promise<CodexInboundPayload> {
  const imagePaths: string[] = [];
  const attachmentPaths: string[] = [];

  for (const item of msg.item_list) {
    try {
      if (item.type === MessageType.IMAGE && item.image_item?.media) {
        imagePaths.push(await downloadMedia(item.image_item.media, opts.inboxDir));
      } else if (item.type === MessageType.FILE && item.file_item?.media) {
        attachmentPaths.push(await downloadMedia(item.file_item.media, opts.inboxDir));
      } else if (item.type === MessageType.VIDEO && item.video_item?.media) {
        attachmentPaths.push(await downloadMedia(item.video_item.media, opts.inboxDir));
      } else if (item.type === MessageType.VOICE && item.voice_item?.media) {
        attachmentPaths.push(await downloadMedia(item.voice_item.media, opts.inboxDir));
      }
    } catch (error) {
      opts.onError?.(error);
    }
  }

  return {
    text: extractTextContent(msg),
    imagePaths,
    attachmentPaths,
  };
}
