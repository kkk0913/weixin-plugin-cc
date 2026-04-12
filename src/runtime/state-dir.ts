import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandTilde } from '../util/helpers.js';

const APP_NAME = 'weixin-plugin-cc-cx';

export function getLegacyStateDir(): string {
  return join(homedir(), '.claude', 'channels', 'weixin');
}

export function getDefaultStateDir(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, APP_NAME);
  }
  return join(homedir(), '.local', 'state', APP_NAME);
}

export function getStateDir(): string {
  const configured = process.env.WEIXIN_STATE_DIR;
  if (configured && configured.trim()) {
    return expandTilde(configured.trim());
  }
  return getDefaultStateDir();
}

export function ensureStateDirReady(): string {
  const stateDir = getStateDir();
  const legacyDir = getLegacyStateDir();

  if (stateDir !== legacyDir && !existsSync(stateDir) && existsSync(legacyDir)) {
    mkdirSync(join(stateDir, '..'), { recursive: true });
    try {
      renameSync(legacyDir, stateDir);
    } catch {
      cpSync(legacyDir, stateDir, { recursive: true });
    }
  }

  mkdirSync(stateDir, { recursive: true });
  return stateDir;
}
