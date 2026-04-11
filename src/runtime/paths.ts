import { join } from 'node:path';
import { ensureStateDirReady } from './state-dir.js';

export const STATE_DIR = ensureStateDirReady();
export const INBOX_DIR = join(STATE_DIR, 'inbox');
export const ACCOUNT_FILE = join(STATE_DIR, 'account.json');
export const CURSOR_FILE = join(STATE_DIR, '.cursor');
export const LOGIN_TRIGGER_FILE = join(STATE_DIR, '.login-trigger');
export const LOG_FILE = join(STATE_DIR, 'debug.log');
export const AUTO_APPROVE_FILE = join(STATE_DIR, '.auto-approve');
export const BRIDGE_SOCKET_FILE = join(STATE_DIR, 'daemon.sock');
export const USAGE_CACHE_FILE = join(STATE_DIR, '.usage-cache.json');
