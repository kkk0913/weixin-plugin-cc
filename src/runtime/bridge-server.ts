import net from 'node:net';
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  BridgeEvent,
  BridgeMessage,
  BridgePermissionRequestParams,
  BridgeToolCallRequest,
  BridgeToolCallResult,
} from '../ipc/protocol.js';
import { attachBridgeMessageParser, writeBridgeMessage } from '../ipc/wire.js';

export interface ClaudeClientSession {
  clientId: string;
  socket: net.Socket;
  connectedAt: number;
}

export interface BridgeServerHandlers {
  debug: (msg: string) => void;
  onToolCall: (req: BridgeToolCallRequest) => Promise<BridgeToolCallResult>;
  onPermissionRequest: (params: BridgePermissionRequestParams) => Promise<void>;
}

const SINGLE_CLIENT_ERROR = 'claude proxy already registered';

function sendBridgeResponse(socket: net.Socket, id: string, ok: true, result?: unknown): void;
function sendBridgeResponse(socket: net.Socket, id: string, ok: false, error: string): void;
function sendBridgeResponse(socket: net.Socket, id: string, ok: boolean, payload?: unknown): void {
  if (ok) {
    writeBridgeMessage(socket, { kind: 'response', id, ok: true, result: payload });
    return;
  }
  writeBridgeMessage(socket, { kind: 'response', id, ok: false, error: String(payload ?? 'unknown error') });
}

export class ClaudeBridgeServer {
  private readonly socketPath: string;
  private readonly handlers: BridgeServerHandlers;
  private readonly claudeClients = new Map<string, ClaudeClientSession>();
  private activeClaudeClientId: string | null = null;
  private server: net.Server | null = null;

  constructor(socketPath: string, handlers: BridgeServerHandlers) {
    this.socketPath = socketPath;
    this.handlers = handlers;
  }

  hasActiveClient(): boolean {
    return this.getActiveClient() !== null;
  }

  sendEventToClaude(event: BridgeEvent): boolean {
    const claudeClient = this.getActiveClient();
    if (!claudeClient) {
      return false;
    }
    writeBridgeMessage(claudeClient.socket, event);
    return true;
  }

  closeAllClients(): void {
    for (const session of this.claudeClients.values()) {
      session.socket.destroy();
    }
    this.claudeClients.clear();
    this.activeClaudeClientId = null;
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true });
    await this.ensureSocketAvailable();
    this.server = net.createServer(socket => {
      let registeredClientId: string | null = null;

      attachBridgeMessageParser(
        socket,
        message => {
          if (message.kind === 'request' && message.method === 'claude/register') {
            registeredClientId = message.params.clientId;
          }
          void this.handleBridgeRequest(socket, message);
        },
        err => {
          this.handlers.debug(`bridge parse failed: ${err.message}`);
        },
      );

      socket.on('close', () => {
        if (registeredClientId) {
          this.unregisterClaudeClient(registeredClientId);
        }
      });
      socket.on('error', err => {
        this.handlers.debug(`bridge socket error: ${err.message}`);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => resolve());
    });

    try {
      chmodSync(this.socketPath, 0o600);
    } catch {
      // Ignore chmod failure on unsupported platforms.
    }
    this.handlers.debug(`daemon bridge listening: ${this.socketPath}`);
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
    try {
      unlinkSync(this.socketPath);
    } catch {
      // Ignore socket cleanup failures.
    }
  }

  private getActiveClient(): ClaudeClientSession | null {
    if (!this.activeClaudeClientId) {
      return null;
    }
    return this.claudeClients.get(this.activeClaudeClientId) ?? null;
  }

  private pickNewestClaudeClient(): ClaudeClientSession | null {
    let newest: ClaudeClientSession | null = null;
    for (const clientSession of this.claudeClients.values()) {
      if (!newest || clientSession.connectedAt > newest.connectedAt) {
        newest = clientSession;
      }
    }
    return newest;
  }

  private registerClaudeClient(clientId: string, socket: net.Socket): void {
    const activeClient = this.getActiveClient();
    if (activeClient && activeClient.clientId !== clientId) {
      throw new Error(`${SINGLE_CLIENT_ERROR}: ${activeClient.clientId}`);
    }
    const session: ClaudeClientSession = {
      clientId,
      socket,
      connectedAt: Date.now(),
    };
    this.claudeClients.set(clientId, session);
    this.activeClaudeClientId = clientId;
    this.handlers.debug(`claude proxy registered: client=${clientId} pid=${process.pid}`);
  }

  private unregisterClaudeClient(clientId: string): void {
    this.claudeClients.delete(clientId);
    if (this.activeClaudeClientId === clientId) {
      this.activeClaudeClientId = this.pickNewestClaudeClient()?.clientId ?? null;
    }
    this.handlers.debug(`claude proxy disconnected: client=${clientId}`);
  }

  private async handleBridgeRequest(socket: net.Socket, message: BridgeMessage): Promise<void> {
    if (message.kind !== 'request') {
      return;
    }

    try {
      switch (message.method) {
        case 'daemon/ping':
          sendBridgeResponse(socket, message.id, true, { ok: true });
          return;

        case 'claude/register':
          this.registerClaudeClient(message.params.clientId, socket);
          sendBridgeResponse(socket, message.id, true, { active: true });
          return;

        case 'tool/call':
          sendBridgeResponse(socket, message.id, true, await this.handlers.onToolCall(message.params));
          return;

        case 'claude/permission_request':
          await this.handlers.onPermissionRequest(message.params);
          sendBridgeResponse(socket, message.id, true, { queued: true });
          return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendBridgeResponse(socket, message.id, false, msg);
    }
  }

  private async ensureSocketAvailable(): Promise<void> {
    if (!existsSync(this.socketPath)) {
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const probe = net.createConnection(this.socketPath);
        probe.once('connect', () => {
          probe.end();
          resolve();
        });
        probe.once('error', err => reject(err));
      });
      throw new Error(`weixin daemon already running on ${this.socketPath}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (String(err).includes('already running')) {
        throw err;
      }
      if (code !== 'ENOENT' && code !== 'ECONNREFUSED') {
        throw err;
      }
    }

    try {
      unlinkSync(this.socketPath);
    } catch {
      // Ignore stale socket cleanup failure.
    }
  }
}
