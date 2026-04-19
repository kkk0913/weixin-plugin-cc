#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectEnv } from './src/runtime/env.js';

type AccessConfig = {
  mode: 'pairing' | 'allowlist' | 'disabled';
  allowedUsers: string[];
  pendingUsers: Record<string, string>;
};

loadProjectEnv();
const { ensureStateDirReady } = await import('./src/runtime/state-dir.js');
const STATE_DIR = ensureStateDirReady();
const ACCOUNT_FILE = join(STATE_DIR, 'account.json');
const ACCESS_FILE = join(STATE_DIR, 'access.json');
const LOGIN_TRIGGER_FILE = join(STATE_DIR, '.login-trigger');
const SOCKET_FILE = join(STATE_DIR, 'daemon.sock');

const DEFAULT_ACCESS: AccessConfig = {
  mode: 'pairing',
  allowedUsers: [],
  pendingUsers: {},
};

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
}

function writeTrigger(): void {
  ensureStateDir();
  const tmp = LOGIN_TRIGGER_FILE + '.tmp';
  writeFileSync(tmp, 'login\n', { mode: 0o600 });
  renameSync(tmp, LOGIN_TRIGGER_FILE);
}

function clearSession(): void {
  try {
    unlinkSync(ACCOUNT_FILE);
  } catch {
    // Ignore missing session file.
  }
}

function loadAccess(): AccessConfig {
  try {
    if (!existsSync(ACCESS_FILE)) {
      return { ...DEFAULT_ACCESS };
    }
    return { ...DEFAULT_ACCESS, ...JSON.parse(readFileSync(ACCESS_FILE, 'utf-8')) } as AccessConfig;
  } catch {
    return { ...DEFAULT_ACCESS };
  }
}

function printStatus(): void {
  const hasSession = existsSync(ACCOUNT_FILE);
  const access = loadAccess();
  const pendingEntries = Object.entries(access.pendingUsers);

  console.log(`Session: ${hasSession ? 'saved' : 'not logged in'}`);
  console.log(`Access mode: ${access.mode}`);
  console.log(`Allowed users: ${access.allowedUsers.length}`);
  if (access.allowedUsers.length > 0) {
    for (const userId of access.allowedUsers) {
      console.log(`- ${userId}`);
    }
  }
  console.log(`Pending pairings: ${pendingEntries.length}`);
  if (pendingEntries.length > 0) {
    for (const [userId, code] of pendingEntries) {
      console.log(`- ${code}: ${userId}`);
    }
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run login         Trigger QR login in the running server
  npm run relogin       Clear saved session, then trigger fresh QR login
  npm run clear         Remove saved session
  npm run status        Show current session and access state
  npm run daemon        Start the daemon in the background (kills stale first)
`);
}

async function findDaemonPids(): Promise<number[]> {
  const { execSync } = await import('node:child_process');
  const patterns = ['bun server\\.ts', 'node server\\.ts', 'tsx server\\.ts'];
  for (const pattern of patterns) {
    try {
      const stdout = execSync(`pgrep -f "${pattern}"`, { encoding: 'utf-8' });
      const pids = stdout
        .trim()
        .split('\n')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid);
      if (pids.length > 0) return pids;
    } catch {
      // Try next pattern
    }
  }
  return [];
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(200);
  }
  return !isProcessAlive(pid);
}

async function startDaemon(): Promise<void> {
  const pids = await findDaemonPids();
  if (pids.length > 0) {
    for (const pid of pids) {
      if (!isProcessAlive(pid)) continue;
      console.log(`Stopping existing daemon (pid=${pid})...`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
    await sleep(500);
    for (const pid of pids) {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    await sleep(300);
  }

  // Remove stale socket file if any.
  try {
    unlinkSync(SOCKET_FILE);
  } catch {
    // ignore missing
  }

  const { spawn } = await import('node:child_process');
  const child = spawn('bun', ['server.ts'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WEIXIN_SERVER_ROLE: 'daemon' },
  });
  child.unref();
  console.log(`Daemon started (pid=${child.pid}). Logs: ${STATE_DIR}/debug.log`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  switch (command) {
    case 'login':
      writeTrigger();
      console.log('Login triggered. Check the running server output for the browser login link.');
      return;

    case 'relogin':
      clearSession();
      writeTrigger();
      console.log('Session cleared and login triggered. Check the running server output for the browser login link.');
      return;

    case 'clear':
      clearSession();
      console.log('Session cleared.');
      return;

    case 'status':
      printStatus();
      return;

    case 'start-daemon':
    case 'daemon':
      await startDaemon();
      return;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

void main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
