import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermissionChatId } from '../../src/claude/proxy.js';

test('resolvePermissionChatId prefers explicit chat_id', () => {
  const chatId = resolvePermissionChatId({
    request_id: 'req-1',
    chat_id: 'chat-explicit',
    tool_name: 'Bash',
    description: 'Run a command',
    input_preview: 'chat_id="chat-preview"',
  });

  assert.equal(chatId, 'chat-explicit');
});

test('resolvePermissionChatId extracts chat_id from input preview', () => {
  const chatId = resolvePermissionChatId({
    request_id: 'req-1',
    tool_name: 'Bash',
    description: 'Run a command',
    input_preview: 'reply({"chat_id":"chat-preview","text":"ok"})',
  });

  assert.equal(chatId, 'chat-preview');
});

test('resolvePermissionChatId falls back to the most recent channel chat id', () => {
  const chatId = resolvePermissionChatId(
    {
      request_id: 'req-1',
      tool_name: 'Bash',
      description: 'Run a command',
      input_preview: 'bash -lc ls',
    },
    'chat-last-seen',
  );

  assert.equal(chatId, 'chat-last-seen');
});
