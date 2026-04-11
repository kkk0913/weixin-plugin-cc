import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexBridge } from '../../src/codex/bridge.js';

function makeStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'weixin-codex-'));
}

function makeBridge(stateDir = makeStateDir()) {
  const sentTexts: Array<{ chatId: string; contextToken: string; text: string }> = [];
  const bridge = new CodexBridge({
    stateDir,
    cwd: stateDir,
    sendText: async (chatId, contextToken, text) => {
      sentTexts.push({ chatId, contextToken, text });
    },
    getContextToken: () => undefined,
    debug: () => {},
  });
  return { bridge, sentTexts, stateDir };
}

test('CodexBridge creates and persists thread mapping on first submit', async () => {
  const { bridge, stateDir } = makeBridge();
  const calls: Array<{ method: string; params: any }> = [];

  (bridge as any).client = {
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'thread/start') {
        return { thread: { id: 'thread-1' } };
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-1' } };
      }
      throw new Error(`unexpected method ${method}`);
    },
  };

  await bridge.submitMessage({
    chatId: 'user-1',
    contextToken: 'ctx-1',
    text: 'hello',
    imagePaths: [],
    attachmentPaths: [],
  });

  assert.deepEqual(calls.map(call => call.method), ['thread/start', 'turn/start']);
  assert.equal((bridge as any).threadState.threads['user-1'], 'thread-1');

  const { bridge: reloaded } = makeBridge(stateDir);
  assert.equal((reloaded as any).threadState.threads['user-1'], 'thread-1');
});

test('CodexBridge resumes existing thread and steers active turn', async () => {
  const stateDir = makeStateDir();
  const first = makeBridge(stateDir).bridge;

  (first as any).client = {
    request: async (method: string) => {
      if (method === 'thread/start') {
        return { thread: { id: 'thread-1' } };
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-1' } };
      }
      throw new Error(`unexpected method ${method}`);
    },
  };

  await first.submitMessage({
    chatId: 'user-1',
    contextToken: 'ctx-1',
    text: 'hello',
    imagePaths: [],
    attachmentPaths: [],
  });

  const { bridge } = makeBridge(stateDir);
  const calls: Array<{ method: string; params: any }> = [];
  (bridge as any).client = {
    request: async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === 'thread/resume') {
        return { ok: true };
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-2' } };
      }
      if (method === 'turn/steer') {
        return { ok: true };
      }
      throw new Error(`unexpected method ${method}`);
    },
  };

  await bridge.submitMessage({
    chatId: 'user-1',
    contextToken: 'ctx-2',
    text: 'next',
    imagePaths: [],
    attachmentPaths: [],
  });
  await bridge.submitMessage({
    chatId: 'user-1',
    contextToken: 'ctx-2',
    text: 'follow up',
    imagePaths: [],
    attachmentPaths: [],
  });

  assert.deepEqual(calls.map(call => call.method), ['thread/resume', 'turn/start', 'turn/steer']);
  assert.equal(calls[2]?.params.expectedTurnId, 'turn-2');
});

test('CodexBridge resolves approval replies and reports result to chat', async () => {
  const { bridge, sentTexts } = makeBridge();
  const resolved: unknown[] = [];

  (bridge as any).pendingApprovals.set('req-1', {
    requestId: 'req-1',
    method: 'item/commandExecution/requestApproval',
    chatId: 'user-1',
    contextToken: 'ctx-1',
    params: { threadId: 'thread-1', command: 'ls' },
    resolve: (value: unknown) => resolved.push(value),
  });

  const handled = await bridge.maybeHandleApprovalReply('user-1', 'ctx-1', 'yes');
  assert.equal(handled, true);
  assert.deepEqual(resolved, [{ decision: 'accept' }]);
  assert.deepEqual(sentTexts, [{ chatId: 'user-1', contextToken: 'ctx-1', text: 'Approved.' }]);
  assert.equal((bridge as any).pendingApprovals.size, 0);
});

test('CodexBridge yesall resolves all matching pending approvals', async () => {
  const { bridge, sentTexts } = makeBridge();
  const resolved: unknown[] = [];

  for (const requestId of ['req-1', 'req-2']) {
    (bridge as any).pendingApprovals.set(requestId, {
      requestId,
      method: 'item/fileChange/requestApproval',
      chatId: 'user-1',
      contextToken: 'ctx-1',
      params: { threadId: 'thread-1', reason: 'edit file' },
      resolve: (value: unknown) => resolved.push(value),
    });
  }

  const handled = await bridge.maybeHandleApprovalReply('user-1', 'ctx-1', 'yesall');
  assert.equal(handled, true);
  assert.deepEqual(resolved, [{ decision: 'accept' }, { decision: 'accept' }]);
  assert.deepEqual(sentTexts, [{ chatId: 'user-1', contextToken: 'ctx-1', text: '已全部允许 ✓ (2)' }]);
  assert.equal((bridge as any).pendingApprovals.size, 0);
});
