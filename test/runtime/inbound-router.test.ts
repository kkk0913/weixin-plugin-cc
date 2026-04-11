import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundRouter } from '../../src/runtime/inbound-router.js';
import { MessageType, type WeixinMessage } from '../../src/weixin/types.js';
import type { ChatBackend } from '../../src/runtime/backends.js';
import type { BackendRoute } from '../../src/config/backend-route.js';

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

function makeBackend(route: BackendRoute) {
  const calls = {
    ensureReady: [] as Array<[string, string]>,
    approval: [] as Array<[string, string, string]>,
    deliver: [] as WeixinMessage[],
  };

  const backend: ChatBackend = {
    route,
    async ensureReady(chatId, contextToken) {
      calls.ensureReady.push([chatId, contextToken]);
      return true;
    },
    async tryHandleApprovalReply(chatId, contextToken, text) {
      calls.approval.push([chatId, contextToken, text]);
      return text === 'yes';
    },
    async deliver(msg) {
      calls.deliver.push(msg);
    },
  };

  return { backend, calls };
}

test('inbound router dispatches normal chat to active backend', async () => {
  const claude = makeBackend('claude');
  const codex = makeBackend('codex');
  const sentTexts: string[] = [];

  const router = createInboundRouter({
    inboxDir: '/tmp',
    debug: () => {},
    access: {
      reload: () => {},
      gate: () => ({ action: 'deliver' }),
    },
    client: {
      isAuthed: false,
      sendMessage: async () => ({}),
      getConfig: async () => ({ typing_ticket: '' }),
      sendTyping: async () => ({}),
    },
    backendRoutes: {
      reload: () => {},
      getBackend: () => 'claude',
      setBackend: () => {},
    } as any,
    sessionState: {
      setContextToken: () => {},
    },
    sendTextMessage: async (_chatId, _contextToken, text) => {
      sentTexts.push(text);
    },
    getStatsText: async () => 'stats',
    backends: {
      claude: claude.backend,
      codex: codex.backend,
    },
  });

  await router(makeTextMessage('hello'));
  assert.equal(claude.calls.deliver.length, 1);
  assert.equal(codex.calls.deliver.length, 0);
  assert.deepEqual(sentTexts, []);
});

test('inbound router handles backend switch before delivery', async () => {
  const claude = makeBackend('claude');
  const codex = makeBackend('codex');
  const sentTexts: string[] = [];
  const setBackendCalls: Array<[string, BackendRoute]> = [];

  const router = createInboundRouter({
    inboxDir: '/tmp',
    debug: () => {},
    access: {
      reload: () => {},
      gate: () => ({ action: 'deliver' }),
    },
    client: {
      isAuthed: false,
      sendMessage: async () => ({}),
      getConfig: async () => ({ typing_ticket: '' }),
      sendTyping: async () => ({}),
    },
    backendRoutes: {
      reload: () => {},
      getBackend: () => 'claude',
      setBackend: (chatId: string, backend: BackendRoute) => {
        setBackendCalls.push([chatId, backend]);
      },
    } as any,
    sessionState: {
      setContextToken: () => {},
    },
    sendTextMessage: async (_chatId, _contextToken, text) => {
      sentTexts.push(text);
    },
    getStatsText: async () => 'stats',
    backends: {
      claude: claude.backend,
      codex: codex.backend,
    },
  });

  await router(makeTextMessage('/codex'));
  assert.deepEqual(codex.calls.ensureReady, [['user-1', 'ctx-1']]);
  assert.deepEqual(setBackendCalls, [['user-1', 'codex']]);
  assert.equal(sentTexts[0], '已切换到 Codex 模式。后续消息会转发给 Codex。');
  assert.equal(claude.calls.deliver.length, 0);
  assert.equal(codex.calls.deliver.length, 0);
});

test('inbound router routes stats command to text response', async () => {
  const claude = makeBackend('claude');
  const codex = makeBackend('codex');
  const sentTexts: string[] = [];

  const router = createInboundRouter({
    inboxDir: '/tmp',
    debug: () => {},
    access: {
      reload: () => {},
      gate: () => ({ action: 'deliver' }),
    },
    client: {
      isAuthed: false,
      sendMessage: async () => ({}),
      getConfig: async () => ({ typing_ticket: '' }),
      sendTyping: async () => ({}),
    },
    backendRoutes: {
      reload: () => {},
      getBackend: () => 'claude',
      setBackend: () => {},
    } as any,
    sessionState: {
      setContextToken: () => {},
    },
    sendTextMessage: async (_chatId, _contextToken, text) => {
      sentTexts.push(text);
    },
    getStatsText: async () => 'stats-output',
    backends: {
      claude: claude.backend,
      codex: codex.backend,
    },
  });

  await router(makeTextMessage('/stats'));
  assert.deepEqual(sentTexts, ['stats-output']);
  assert.equal(claude.calls.deliver.length, 0);
});

test('inbound router stops when approval reply is consumed', async () => {
  const claude = makeBackend('claude');
  const codex = makeBackend('codex');

  const router = createInboundRouter({
    inboxDir: '/tmp',
    debug: () => {},
    access: {
      reload: () => {},
      gate: () => ({ action: 'deliver' }),
    },
    client: {
      isAuthed: false,
      sendMessage: async () => ({}),
      getConfig: async () => ({ typing_ticket: '' }),
      sendTyping: async () => ({}),
    },
    backendRoutes: {
      reload: () => {},
      getBackend: () => 'claude',
      setBackend: () => {},
    } as any,
    sessionState: {
      setContextToken: () => {},
    },
    sendTextMessage: async () => {},
    getStatsText: async () => 'stats-output',
    backends: {
      claude: claude.backend,
      codex: codex.backend,
    },
  });

  await router(makeTextMessage('yes'));
  assert.deepEqual(claude.calls.approval, [['user-1', 'ctx-1', 'yes']]);
  assert.equal(claude.calls.deliver.length, 0);
});
