import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessControl } from '../../src/config/access.js';

function makeStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'weixin-access-'));
}

test('AccessControl creates pairing code for unknown user in pairing mode', () => {
  const access = new AccessControl(makeStateDir());
  const result = access.gate('user-a');
  assert.equal(result.action, 'pair');
  assert.equal(typeof result.code, 'string');
  assert.ok(result.code && result.code.length > 0);
});

test('AccessControl reuses pending pairing code after reload', () => {
  const stateDir = makeStateDir();
  const access = new AccessControl(stateDir);
  const first = access.gate('user-a');
  assert.equal(first.action, 'pair');

  const reloaded = new AccessControl(stateDir);
  const second = reloaded.gate('user-a');
  assert.deepEqual(second, first);
});

test('AccessControl approve moves user into allowlist', () => {
  const access = new AccessControl(makeStateDir());
  const pending = access.gate('user-a');
  assert.equal(pending.action, 'pair');

  const approvedUser = access.approve(pending.code!);
  assert.equal(approvedUser, 'user-a');
  assert.deepEqual(access.allowedUsers, ['user-a']);
  assert.deepEqual(access.gate('user-a'), { action: 'deliver' });
});

test('AccessControl revoke removes allowlisted user', () => {
  const access = new AccessControl(makeStateDir());
  const pending = access.gate('user-a');
  access.approve(pending.code!);

  assert.equal(access.revoke('user-a'), true);
  assert.equal(access.revoke('user-a'), false);
});
