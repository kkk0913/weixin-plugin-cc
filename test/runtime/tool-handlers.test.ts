import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeToolHandlers } from '../../src/runtime/tool-handlers.js';

test('ClaudeToolHandlers reply sends FILE items with md5 and len metadata', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'weixin-tool-handlers-'));
  const stateDir = join(tmpDir, 'state');
  const inboxDir = join(stateDir, 'inbox');
  const filePath = join(inboxDir, 'sample.txt');
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(filePath, 'hello file\n');

  const sentItems: Array<{ chatId: string; contextToken: string; item: any }> = [];
  const sentItemLists: Array<{ chatId: string; contextToken: string; items: any[] }> = [];

  const toolHandlers = new ClaudeToolHandlers({
    stateDir,
    inboxDir: tmpDir,
    autoApproveFile: join(tmpDir, '.auto-approve'),
    maxChunkLimit: 2000,
    debug: () => {},
    sendTextMessage: async () => {},
    sendPermissionDecision: () => true,
    assertAllowedChat: () => {},
    getContextToken: () => 'ctx-1',
    takeMediaHandle: () => null,
    client: {
      getUploadUrl: async () => ({
        upload_param: JSON.stringify({ name: 'sample.txt', encrypt_query_param: 'enc-param' }),
        thumb_upload_param: '',
        upload_full_url: 'https://example.invalid/upload',
      }),
      sendMessage: async (chatId: string, contextToken: string, item: any) => {
        sentItems.push({ chatId, contextToken, item });
        return {};
      },
      sendMessageItems: async (chatId: string, contextToken: string, items: any[]) => {
        sentItemLists.push({ chatId, contextToken, items });
        return {};
      },
    } as any,
    access: {
      reload: () => {},
      allowedUsers: [],
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, headers: new Headers() }) as Response;

  try {
    const result = await toolHandlers.handleToolCall({
      name: 'reply',
      arguments: {
        chat_id: 'chat-1',
        text: '',
        files: [filePath],
      },
    } as any);

    assert.equal(result.isError, undefined);
    assert.equal(sentItems.length, 0);
    assert.equal(sentItemLists.length, 1);
    assert.deepEqual(sentItemLists[0].items[0], {
      type: 1,
      text_item: { text: '附件：sample.txt' },
    });
    assert.equal(sentItemLists[0].items[1].type, 4);
    assert.deepEqual(sentItemLists[0].items[1].file_item.media, {
      encrypt_query_param: 'enc-param',
      aes_key: sentItemLists[0].items[1].file_item.media.aes_key,
      encrypt_type: 1,
    });
    assert.equal(sentItemLists[0].items[1].file_item.file_name, 'sample.txt');
    assert.equal(sentItemLists[0].items[1].file_item.len, '16');
    assert.equal(sentItemLists[0].items[1].file_item.md5.length, 32);
    assert.notEqual(sentItemLists[0].items[1].file_item.md5, '14f21c9a90ca89a660e63f886a91bd4a');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
