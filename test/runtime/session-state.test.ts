import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionState } from '../../src/runtime/session-state.js';

test('SessionState stores and consumes media handles once', () => {
  const state = new SessionState({
    mediaHandleTtlMs: 50,
    contextTokenTtlMs: 50,
  });

  const media = { file_id: 'media-1' } as any;
  state.storeMediaHandle('handle-1', media);
  assert.equal(state.takeMediaHandle('handle-1'), media);
  assert.equal(state.takeMediaHandle('handle-1'), null);
  state.dispose();
});

test('SessionState expires media handles by ttl', async () => {
  const state = new SessionState({
    mediaHandleTtlMs: 10,
    contextTokenTtlMs: 50,
  });

  state.storeMediaHandle('handle-1', { file_id: 'media-1' } as any);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(state.takeMediaHandle('handle-1'), null);
  state.dispose();
});

test('SessionState refreshes context token ttl on access', async () => {
  const state = new SessionState({
    mediaHandleTtlMs: 50,
    contextTokenTtlMs: 20,
  });

  state.setContextToken('user-1', 'ctx-1');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.getContextToken('user-1'), 'ctx-1');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(state.getContextToken('user-1'), 'ctx-1');
  state.dispose();
});

test('SessionState expires context token after ttl', async () => {
  const state = new SessionState({
    mediaHandleTtlMs: 50,
    contextTokenTtlMs: 10,
  });

  state.setContextToken('user-1', 'ctx-1');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(state.getContextToken('user-1'), undefined);
  state.dispose();
});
