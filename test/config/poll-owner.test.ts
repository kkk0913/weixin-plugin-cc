import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PollLeaseControl } from '../../src/config/poll-owner.js';

function makeStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'weixin-poll-'));
}

test('PollLeaseControl acquires and exposes active owner', () => {
  const now = Date.now();
  const lease = new PollLeaseControl(makeStateDir(), {
    ownerId: 'owner-a',
    kind: 'test',
    pid: process.pid,
    priority: 50,
    ttlMs: 100,
  });

  assert.equal(lease.refresh(now), true);
  assert.deepEqual(lease.getOwner(), {
    ownerId: 'owner-a',
    pid: process.pid,
    kind: 'test',
    priority: 50,
    heartbeatAt: now,
    expiresAt: now + 100,
  });
});

test('PollLeaseControl prevents same-priority takeover while lease is live', () => {
  const now = Date.now();
  const stateDir = makeStateDir();
  const first = new PollLeaseControl(stateDir, {
    ownerId: 'owner-a',
    kind: 'test',
    pid: process.pid,
    priority: 50,
    ttlMs: 100,
  });
  const second = new PollLeaseControl(stateDir, {
    ownerId: 'owner-b',
    kind: 'test',
    pid: process.pid,
    priority: 50,
    ttlMs: 100,
  });

  assert.equal(first.refresh(now), true);
  assert.equal(second.refresh(now + 50), false);
});

test('PollLeaseControl allows higher-priority takeover', () => {
  const now = Date.now();
  const stateDir = makeStateDir();
  const first = new PollLeaseControl(stateDir, {
    ownerId: 'owner-a',
    kind: 'test',
    pid: process.pid,
    priority: 50,
    ttlMs: 100,
  });
  const second = new PollLeaseControl(stateDir, {
    ownerId: 'owner-b',
    kind: 'test',
    pid: process.pid,
    priority: 60,
    ttlMs: 100,
  });

  assert.equal(first.refresh(now), true);
  assert.equal(second.refresh(now + 50), true);
  assert.equal(second.getOwner()?.ownerId, 'owner-b');
});

test('PollLeaseControl releases only owned lease', () => {
  const now = Date.now();
  const stateDir = makeStateDir();
  const first = new PollLeaseControl(stateDir, {
    ownerId: 'owner-a',
    kind: 'test',
    pid: process.pid,
    priority: 50,
    ttlMs: 100,
  });
  const second = new PollLeaseControl(stateDir, {
    ownerId: 'owner-b',
    kind: 'test',
    pid: process.pid,
    priority: 40,
    ttlMs: 100,
  });

  assert.equal(first.refresh(now), true);
  second.release();
  assert.equal(first.getOwner()?.ownerId, 'owner-a');
  first.release();
  assert.equal(first.getOwner(), null);
});
