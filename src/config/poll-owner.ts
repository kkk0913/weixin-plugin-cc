import { existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PollOwnerRecord {
  ownerId: string;
  pid: number;
  kind: string;
  priority: number;
  heartbeatAt: number;
  expiresAt: number;
}

interface PollLeaseControlOptions {
  kind: string;
  ownerId: string;
  pid?: number;
  priority: number;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 8_000;
const LOCK_RETRY_DELAY_MS = 10;
const LOCK_MAX_WAIT_MS = 250;
const LOCK_STALE_MS = 5_000;

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class PollLeaseControl {
  private readonly leasePath: string;
  private readonly lockPath: string;
  private readonly kind: string;
  private readonly ownerId: string;
  private readonly pid: number;
  private readonly priority: number;
  private readonly ttlMs: number;

  constructor(stateDir: string, options: PollLeaseControlOptions) {
    this.leasePath = join(stateDir, 'poll-owner.json');
    this.lockPath = join(stateDir, 'poll-owner.lock');
    this.kind = options.kind;
    this.ownerId = options.ownerId;
    this.pid = options.pid ?? process.pid;
    this.priority = options.priority;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  refresh(now = Date.now()): boolean {
    return this.withMutationLock(() => {
      const current = this.read();
      if (current && current.ownerId !== this.ownerId) {
        const currentExpired = current.expiresAt <= now || !isProcessAlive(current.pid);
        const canPreempt = current.priority < this.priority;
        if (!currentExpired && !canPreempt) {
          return false;
        }
      }

      const next: PollOwnerRecord = {
        ownerId: this.ownerId,
        pid: this.pid,
        kind: this.kind,
        priority: this.priority,
        heartbeatAt: now,
        expiresAt: now + this.ttlMs,
      };
      this.write(next);
      return true;
    });
  }

  getOwner(): PollOwnerRecord | null {
    const current = this.read();
    if (!current) {
      return null;
    }
    if (current.expiresAt <= Date.now() || !isProcessAlive(current.pid)) {
      return null;
    }
    return current;
  }

  release(): void {
    this.withMutationLock(() => {
      const current = this.read();
      if (!current || current.ownerId !== this.ownerId) {
        return;
      }
      try {
        unlinkSync(this.leasePath);
      } catch {
        // Ignore lease cleanup failures.
      }
    });
  }

  private read(): PollOwnerRecord | null {
    try {
      if (!existsSync(this.leasePath)) {
        return null;
      }
      return JSON.parse(readFileSync(this.leasePath, 'utf-8')) as PollOwnerRecord;
    } catch {
      return null;
    }
  }

  private write(record: PollOwnerRecord): void {
    mkdirSync(dirname(this.leasePath), { recursive: true });
    const tmp = `${this.leasePath}.${this.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.leasePath);
  }

  private withMutationLock<T>(fn: () => T): T {
    const lockFd = this.acquireLock();
    if (lockFd === null) {
      return false as T;
    }
    try {
      return fn();
    } finally {
      this.releaseLock(lockFd);
    }
  }

  private acquireLock(): number | null {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    while (Date.now() <= deadline) {
      try {
        const fd = openSync(this.lockPath, 'wx', 0o600);
        try {
          writeFileSync(fd, JSON.stringify({
            ownerId: this.ownerId,
            pid: this.pid,
            acquiredAt: Date.now(),
          }));
        } catch {
          closeSync(fd);
          try {
            unlinkSync(this.lockPath);
          } catch {
            // Ignore cleanup failure if write failed.
          }
          throw new Error('failed to initialize poll-owner lock');
        }
        return fd;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw err;
        }
        this.tryBreakStaleLock();
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_DELAY_MS);
      }
    }

    return null;
  }

  private releaseLock(fd: number): void {
    try {
      closeSync(fd);
    } catch {
      // Ignore close failure during lock cleanup.
    }
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Ignore lock cleanup failures.
    }
  }

  private tryBreakStaleLock(now = Date.now()): void {
    try {
      const raw = readFileSync(this.lockPath, 'utf-8');
      const lock = JSON.parse(raw) as { pid?: number; acquiredAt?: number };
      const lockPid = Number(lock.pid);
      const acquiredAt = Number(lock.acquiredAt);
      const staleByPid = !Number.isFinite(lockPid) || !isProcessAlive(lockPid);
      const staleByAge = !Number.isFinite(acquiredAt) || acquiredAt + LOCK_STALE_MS <= now;
      if (!staleByPid && !staleByAge) {
        return;
      }
    } catch {
      // Corrupted lock file is treated as stale.
    }

    try {
      unlinkSync(this.lockPath);
    } catch {
      // Another process may have removed or replaced it already.
    }
  }
}
