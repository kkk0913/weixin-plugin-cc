import test from 'node:test';
import assert from 'node:assert/strict';
import { pollLoop } from '../../src/runtime/polling.js';
import type { WeixinMessage } from '../../src/weixin/types.js';

function makeTextMessage(from: string, text: string): WeixinMessage {
  return {
    from_user_id: from,
    to_user_id: 'bot',
    message_type: 1,
    context_token: `ctx-${from}`,
    item_list: [{ type: 1, text_item: { text } }],
  } as WeixinMessage;
}

test('pollLoop preserves per-chat ordering while allowing cross-chat concurrency', async () => {
  let polling = true;
  let updatesCalls = 0;
  const starts: Record<string, number> = {};
  const finishes: Record<string, number> = {};
  const order: string[] = [];

  await pollLoop({
    client: {
      getUpdates: async () => {
        updatesCalls += 1;
        if (updatesCalls === 1) {
          polling = false;
          return {
            ret: 0,
            errcode: 0,
            errmsg: '',
            get_updates_buf: 'cursor-1',
            msgs: [
              makeTextMessage('chat-a', 'a1'),
              makeTextMessage('chat-b', 'b1'),
              makeTextMessage('chat-a', 'a2'),
            ],
          };
        }
        return { ret: 0, errcode: 0, errmsg: '', get_updates_buf: 'cursor-1', msgs: [] };
      },
    } as any,
    pollLease: {
      refresh: () => true,
      release: () => {},
    } as any,
    loadCursor: () => '',
    saveCursor: () => {},
    handleInbound: async msg => {
      const key = `${msg.from_user_id}:${msg.item_list?.[0]?.text_item?.text ?? ''}`;
      starts[key] = Date.now();
      order.push(`start:${key}`);
      if (key === 'chat-a:a1') {
        await new Promise(resolve => setTimeout(resolve, 30));
      } else {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      finishes[key] = Date.now();
      order.push(`finish:${key}`);
    },
    debug: () => {},
    checkLoginTrigger: () => false,
    onLoginTriggered: () => {},
    onSessionExpired: () => {},
    isPolling: () => polling,
    pollLeaseRetryMs: 1,
  });

  assert.ok(starts['chat-b:b1'] < finishes['chat-a:a1'], `expected chat-b to run before chat-a:a1 finished; order=${order.join(',')}`);
  assert.ok(starts['chat-a:a2'] >= finishes['chat-a:a1'], `expected chat-a second message to wait for first; order=${order.join(',')}`);
});
