import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeBackendAdapter } from '../../src/runtime/backends.js';

test('ClaudeBackendAdapter yesall enables auto-approve and approves all pending requests', async () => {
  const sentTexts: Array<{ chatId: string; contextToken: string; text: string }> = [];
  const approvedRequestIds: string[] = [];
  let autoApproveEnabled = false;

  const backend = new ClaudeBackendAdapter({
    inboxDir: '/tmp',
    debug: () => {},
    bridgeServer: null,
    sessionState: {
      storeMediaHandle: () => {},
    },
    toolHandlers: {
      listPendingPermissionRequestIds: () => ['req-1', 'req-2'],
      sendPermissionDecision: async (requestId: string) => {
        approvedRequestIds.push(requestId);
      },
      enableAutoApprove: () => {
        autoApproveEnabled = true;
      },
      getPendingPermissionCount: () => 0,
      getNextPendingPermissionRequestId: () => null,
      hasPendingPermission: () => false,
    } as any,
    sendTextMessage: async (chatId, contextToken, text) => {
      sentTexts.push({ chatId, contextToken, text });
    },
    ensureReady: async () => true,
    sendUnavailableMessage: async () => {},
  });

  const handled = await backend.tryHandleApprovalReply('user-1', 'ctx-1', 'yesall');

  assert.equal(handled, true);
  assert.equal(autoApproveEnabled, true);
  assert.deepEqual(approvedRequestIds, ['req-1', 'req-2']);
  assert.deepEqual(sentTexts, [{
    chatId: 'user-1',
    contextToken: 'ctx-1',
    text: '已全部允许并开启自动批准 ✓ (2)',
  }]);
});
