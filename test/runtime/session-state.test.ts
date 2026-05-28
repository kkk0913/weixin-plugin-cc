import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('SessionState persists context tokens per account+peer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weixin-session-state-'));
  const file = join(dir, 'context-tokens.json');

  try {
    const stateA = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-a',
    });
    stateA.setContextToken('user-1', 'ctx-a1');
    stateA.dispose();

    const stateARestore = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-a',
    });
    const stateBRestore = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-b',
    });

    assert.equal(stateARestore.getContextToken('user-1'), 'ctx-a1');
    assert.equal(stateBRestore.getContextToken('user-1'), undefined);

    stateARestore.dispose();
    stateBRestore.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionState does not rewrite persisted tokens on read refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weixin-session-state-'));
  const file = join(dir, 'context-tokens.json');

  try {
    const state = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-a',
    });
    state.setContextToken('user-1', 'ctx-a1');
    const before = readFileSync(file, 'utf-8');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(state.getContextToken('user-1'), 'ctx-a1');
    const after = readFileSync(file, 'utf-8');
    assert.equal(after, before);
    state.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionState lists users for current account scope only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weixin-session-state-'));
  const file = join(dir, 'context-tokens.json');

  try {
    const stateA = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-a',
    });
    stateA.setContextToken('user-1', 'ctx-a1');
    stateA.setContextToken('user-2', 'ctx-a2');
    stateA.dispose();

    const stateB = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-b',
    });
    stateB.setContextToken('user-3', 'ctx-b3');
    stateB.dispose();

    const stateARestore = new SessionState({
      mediaHandleTtlMs: 50,
      contextTokenTtlMs: 1000,
      contextTokenFile: file,
      getContextTokenScope: () => 'account-a',
    });
    assert.deepEqual(stateARestore.listContextTokenUsers().sort(), ['user-1', 'user-2']);
    stateARestore.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
