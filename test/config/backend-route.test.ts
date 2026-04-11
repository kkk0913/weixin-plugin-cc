import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackendRouteControl } from '../../src/config/backend-route.js';

function makeStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'weixin-route-'));
}

test('BackendRouteControl defaults to claude', () => {
  const routes = new BackendRouteControl(makeStateDir());
  assert.equal(routes.getBackend('user-a'), 'claude');
});

test('BackendRouteControl persists non-default route', () => {
  const stateDir = makeStateDir();
  const routes = new BackendRouteControl(stateDir);
  routes.setBackend('user-a', 'codex');

  const reloaded = new BackendRouteControl(stateDir);
  assert.equal(reloaded.getBackend('user-a'), 'codex');
});

test('BackendRouteControl removes per-chat override when switching to default', () => {
  const stateDir = makeStateDir();
  const routes = new BackendRouteControl(stateDir);
  routes.setBackend('user-a', 'codex');
  routes.setBackend('user-a', 'claude');

  const reloaded = new BackendRouteControl(stateDir);
  assert.equal(reloaded.getBackend('user-a'), 'claude');
});
