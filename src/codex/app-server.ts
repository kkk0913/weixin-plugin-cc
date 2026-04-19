import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  CodexServerRequest,
  InitializeResponse,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';

export interface CodexAppServerClientOptions {
  command?: string;
  cwd: string;
  model?: string;
  debug?: (msg: string) => void;
  onProcessExit?: () => void;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerClient {
  private readonly command: string;
  private readonly cwd: string;
  private readonly model?: string;
  private readonly debug: (msg: string) => void;
  private readonly onProcessExit?: () => void;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private serverRequestHandler: ((request: CodexServerRequest) => Promise<unknown>) | null = null;

  constructor(opts: CodexAppServerClientOptions) {
    this.command = opts.command ?? 'codex';
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.debug = opts.debug ?? (() => {});
    this.onProcessExit = opts.onProcessExit;
  }

  setNotificationHandler(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  setServerRequestHandler(handler: (request: CodexServerRequest) => Promise<unknown>): void {
    this.serverRequestHandler = handler;
  }

  async start(): Promise<void> {
    if (this.proc) {
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) {
      return;
    }
    this.proc = null;
    proc.kill('SIGTERM');
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.start();

    const proc = this.proc;
    if (!proc) {
      throw new Error('codex app-server is not running');
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      id,
      method,
      params,
    };

    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
      });
    });

    proc.stdin.write(JSON.stringify(payload) + '\n');
    return response;
  }

  private async startInternal(): Promise<void> {
    this.debug(`starting codex app-server via ${this.command}`);
    const proc = spawn(this.command, ['-C', this.cwd, 'app-server'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.proc = proc;

    const stdout = createInterface({ input: proc.stdout });
    stdout.on('line', line => {
      void this.handleStdoutLine(line);
    });

    const stderr = createInterface({ input: proc.stderr });
    stderr.on('line', line => {
      this.debug(`codex stderr: ${line}`);
    });

    proc.on('error', err => {
      this.handleProcessExit(new Error(`failed to start codex app-server: ${err.message}`));
    });

    proc.on('close', code => {
      this.handleProcessExit(new Error(`codex app-server exited with code ${code ?? 'unknown'}`));
    });

    await this.request<InitializeResponse>('initialize', {
      clientInfo: { name: 'weixin-codex-bridge', version: '1.0.0' },
      capabilities: { experimentalApi: true },
      ...(this.model ? { model: this.model } : {}),
    });
  }

  private async handleStdoutLine(line: string): Promise<void> {
    const text = line.trim();
    if (!text) {
      return;
    }

    let message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(text) as JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
    } catch (err) {
      this.debug(`codex stdout parse failed: ${text} (${err})`);
      return;
    }

    if ('method' in message && 'id' in message) {
      await this.handleServerRequest(message as JsonRpcRequest);
      return;
    }

    if ('id' in message) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    if ('method' in message) {
      this.notificationHandler?.(message as JsonRpcNotification);
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? `request ${String(message.id)} failed`));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(message: JsonRpcRequest): Promise<void> {
    const proc = this.proc;
    if (!proc) {
      return;
    }

    if (!this.serverRequestHandler) {
      proc.stdin.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32601, message: `no handler for ${message.method}` },
        }) + '\n',
      );
      return;
    }

    try {
      const result = await this.serverRequestHandler(message as CodexServerRequest);
      proc.stdin.write(JSON.stringify({ id: message.id, result }) + '\n');
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      proc.stdin.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32000, message: messageText },
        }) + '\n',
      );
    }
  }

  private handleProcessExit(error: Error): void {
    this.debug(error.message);
    this.proc = null;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
    this.onProcessExit?.();
  }
}

