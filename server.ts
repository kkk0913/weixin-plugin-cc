#!/usr/bin/env node

import { runClaudeProxy } from './src/claude/proxy.js';
import { runWeixinDaemon } from './src/runtime/daemon.js';
import { ensureStateDirReady } from './src/runtime/state-dir.js';

const STATE_DIR = ensureStateDirReady();
const BRIDGE_SOCKET_FILE = `${STATE_DIR}/daemon.sock`;

function debugLog(msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function getServerRole(): 'daemon' | 'proxy' {
  if (process.env.WEIXIN_SERVER_ROLE === 'daemon' || process.argv.includes('--daemon')) {
    return 'daemon';
  }
  if (process.env.WEIXIN_SERVER_ROLE === 'proxy') {
    return 'proxy';
  }
  return process.stdin.isTTY ? 'daemon' : 'proxy';
}

async function main(): Promise<void> {
  if (getServerRole() === 'daemon') {
    await runWeixinDaemon();
    return;
  }

  await runClaudeProxy({
    bridgeSocketPath: BRIDGE_SOCKET_FILE,
    debug: debugLog,
  });
}

void main().catch(err => {
  process.stderr.write(`weixin channel: fatal: ${err}\n`);
  process.exit(1);
});
