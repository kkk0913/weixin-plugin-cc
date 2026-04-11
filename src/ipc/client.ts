import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type { BridgeEvent, BridgeRequest } from './protocol.js';
import { attachBridgeMessageParser, writeBridgeMessage } from './wire.js';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class DaemonBridgeClient {
  private readonly socketPath: string;
  private readonly debug?: (msg: string) => void;
  private socket: net.Socket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private eventHandler: ((event: BridgeEvent) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;

  constructor(socketPath: string, debug?: (msg: string) => void) {
    this.socketPath = socketPath;
    this.debug = debug;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = net.createConnection(this.socketPath);
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        socket.off('connect', onConnect);
        reject(err);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });

    socket.on('close', () => {
      this.debug?.('daemon bridge disconnected');
      this.socket = null;
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        pending.reject(new Error(`daemon request ${id} interrupted`));
      }
      this.disconnectHandler?.();
    });

    attachBridgeMessageParser(
      socket,
      message => {
        if (message.kind === 'event') {
          this.eventHandler?.(message);
          return;
        }
        if (message.kind !== 'response') {
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error));
        }
      },
      err => {
        this.debug?.(`daemon bridge parse failed: ${err.message}`);
      },
    );

    this.socket = socket;
    this.debug?.(`daemon bridge connected: ${this.socketPath}`);
  }

  onEvent(handler: (event: BridgeEvent) => void): void {
    this.eventHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  async request<T, M extends BridgeRequest['method']>(
    method: M,
    params: Extract<BridgeRequest, { method: M }>['params'],
  ): Promise<T> {
    await this.connect();
    if (!this.socket) {
      throw new Error('daemon bridge not connected');
    }

    const id = randomBytes(8).toString('hex');
    const message = {
      kind: 'request' as const,
      id,
      method,
      params,
    } as Extract<BridgeRequest, { method: M }>;

    const responsePromise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
    });
    writeBridgeMessage(this.socket, message);
    return responsePromise;
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    await new Promise<void>(resolve => {
      socket.once('close', () => resolve());
      socket.end();
    });
  }
}
