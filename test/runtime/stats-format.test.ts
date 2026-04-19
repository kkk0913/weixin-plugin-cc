import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBackendStatusText } from '../../src/runtime/stats-format.js';

test('formatBackendStatusText marks connected backends as online', () => {
  assert.equal(
    formatBackendStatusText({
      claudeConnected: true,
      codexConnected: true,
    }),
    [
      '【连接状态】',
      '━━━━━━━━━━━━━━━━',
      'Claude Code: 在线',
      'Codex: 在线',
      '',
    ].join('\n'),
  );
});

test('formatBackendStatusText marks disconnected backends as offline', () => {
  assert.equal(
    formatBackendStatusText({
      claudeConnected: false,
      codexConnected: false,
    }),
    [
      '【连接状态】',
      '━━━━━━━━━━━━━━━━',
      'Claude Code: 离线',
      'Codex: 离线',
      '',
    ].join('\n'),
  );
});
