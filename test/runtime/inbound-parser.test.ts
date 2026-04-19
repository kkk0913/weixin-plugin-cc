import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInboundMessage } from '../../src/runtime/inbound-parser.js';
import { MessageType, type WeixinMessage } from '../../src/weixin/types.js';

function makeTextMessage(text: string): WeixinMessage {
  return {
    message_id: 1,
    create_time_ms: Date.now(),
    message_type: MessageType.TEXT,
    from_user_id: 'user-1',
    to_user_id: 'bot-1',
    context_token: 'ctx-1',
    item_list: [{
      type: MessageType.TEXT,
      text_item: { text },
    }],
  } as WeixinMessage;
}

test('parseInboundMessage detects backend switch', () => {
  const parsed = parseInboundMessage(makeTextMessage('/codex'), 'claude');
  assert.deepEqual(parsed, { kind: 'backend_switch', text: '/codex', target: 'codex' });
});

test('parseInboundMessage detects stats command', () => {
  const parsed = parseInboundMessage(makeTextMessage('/stats'), 'claude');
  assert.deepEqual(parsed, { kind: 'stats', text: '/stats' });
});

test('parseInboundMessage detects status command', () => {
  const parsed = parseInboundMessage(makeTextMessage('/status'), 'claude');
  assert.deepEqual(parsed, { kind: 'status', text: '/status' });
});

test('parseInboundMessage detects approval reply', () => {
  const parsed = parseInboundMessage(makeTextMessage('yes'), 'codex');
  assert.deepEqual(parsed, { kind: 'approval_reply', text: 'yes' });
});

test('parseInboundMessage falls back to chat message', () => {
  const parsed = parseInboundMessage(makeTextMessage('please summarize this'), 'claude');
  assert.deepEqual(parsed, { kind: 'chat', text: 'please summarize this' });
});

test('parseInboundMessage handles non-text inbound as chat', () => {
  const msg = {
    ...makeTextMessage('ignored'),
    item_list: [{
      type: MessageType.IMAGE,
      image_item: { media: {} },
    }],
  } as WeixinMessage;
  const parsed = parseInboundMessage(msg, 'claude');
  assert.deepEqual(parsed, { kind: 'chat', text: null });
});
