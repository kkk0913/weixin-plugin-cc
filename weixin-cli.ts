#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStateDirReady } from './src/runtime/state-dir.js';

type AccessConfig = {
  mode: 'pairing' | 'allowlist' | 'disabled';
  allowedUsers: string[];
  pendingUsers: Record<string, string>;
};

const STATE_DIR = ensureStateDirReady();
const ACCOUNT_FILE = join(STATE_DIR, 'account.json');
const ACCESS_FILE = join(STATE_DIR, 'access.json');
const LOGIN_TRIGGER_FILE = join(STATE_DIR, '.login-trigger');

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
`);
}

function main(): void {
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

main();
