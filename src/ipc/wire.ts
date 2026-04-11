import net from 'node:net';
import type { BridgeMessage } from './protocol.js';

export type BridgeMessageHandler = (message: BridgeMessage) => void;

export function writeBridgeMessage(socket: net.Socket, message: BridgeMessage): void {
  socket.write(JSON.stringify(message) + '\n');
}

export function attachBridgeMessageParser(
  socket: net.Socket,
  onMessage: BridgeMessageHandler,
  onError?: (err: Error) => void,
): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        onMessage(JSON.parse(line) as BridgeMessage);
      } catch (err) {
        if (onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  });
}
