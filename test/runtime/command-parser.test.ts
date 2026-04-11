import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBackendSwitchCommand, isStatsCommand } from '../../src/runtime/command-parser.js';

test('detectBackendSwitchCommand parses direct aliases', () => {
  assert.equal(detectBackendSwitchCommand('/codex'), 'codex');
  assert.equal(detectBackendSwitchCommand('/cc'), 'claude');
  assert.equal(detectBackendSwitchCommand('code x'), 'codex');
  assert.equal(detectBackendSwitchCommand('Claude Code'), 'claude');
});

test('detectBackendSwitchCommand parses natural language forms', () => {
  assert.equal(detectBackendSwitchCommand('switch to codex'), 'codex');
  assert.equal(detectBackendSwitchCommand('切换到 code s'), 'claude');
  assert.equal(detectBackendSwitchCommand('改成 codex。'), 'codex');
});

test('detectBackendSwitchCommand ignores unrelated text', () => {
  assert.equal(detectBackendSwitchCommand('hello world'), null);
  assert.equal(detectBackendSwitchCommand('/stats'), null);
});

test('isStatsCommand only accepts stats command', () => {
  assert.equal(isStatsCommand('/stats'), true);
  assert.equal(isStatsCommand(' /stats '), true);
  assert.equal(isStatsCommand('/Stats'), true);
  assert.equal(isStatsCommand('stats'), false);
});
