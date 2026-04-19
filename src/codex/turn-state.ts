import type {
  AgentMessageDeltaNotification,
  ErrorNotification,
  ItemCompletedNotification,
  TurnCompletedNotification,
} from './types.js';

export interface TurnContext {
  chatId: string;
  contextToken: string;
  itemOrder: string[];
  itemTexts: Map<string, string>;
  lastError: string | null;
}

export interface CompletedTurnResult {
  turn: TurnContext | null;
  reply: string;
  errorText: string | null;
  interrupted: boolean;
}

export class CodexTurnState {
  private readonly activeTurns = new Map<string, string>();
  private readonly turnContexts = new Map<string, TurnContext>();

  getActiveTurnId(threadId: string): string | undefined {
    return this.activeTurns.get(threadId);
  }

  startTurn(threadId: string, turnId: string, chatId: string, contextToken: string): void {
    this.activeTurns.set(threadId, turnId);
    this.turnContexts.set(turnId, {
      chatId,
      contextToken,
      itemOrder: [],
      itemTexts: new Map(),
      lastError: null,
    });
  }

  handleAgentMessageDelta(notification: AgentMessageDeltaNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn) {
      return;
    }
    if (!turn.itemTexts.has(notification.itemId)) {
      turn.itemOrder.push(notification.itemId);
      turn.itemTexts.set(notification.itemId, '');
    }
    turn.itemTexts.set(notification.itemId, (turn.itemTexts.get(notification.itemId) ?? '') + notification.delta);
  }

  handleItemCompleted(notification: ItemCompletedNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn || notification.item.type !== 'agentMessage') {
      return;
    }
    const item = notification.item as { id: string; text: string };
    if (!turn.itemTexts.has(item.id)) {
      turn.itemOrder.push(item.id);
    }
    turn.itemTexts.set(item.id, item.text);
  }

  handleTurnError(notification: ErrorNotification): void {
    const turn = this.turnContexts.get(notification.turnId);
    if (!turn || notification.willRetry) {
      return;
    }
    turn.lastError = notification.error.additionalDetails
      ? `${notification.error.message}\n${notification.error.additionalDetails}`
      : notification.error.message;
  }

  clearActiveTurns(): void {
    this.activeTurns.clear();
  }

  completeTurn(notification: TurnCompletedNotification): CompletedTurnResult {
    const turn = this.turnContexts.get(notification.turn.id) ?? null;
    this.turnContexts.delete(notification.turn.id);
    this.activeTurns.delete(notification.threadId);

    if (!turn) {
      return {
        turn: null,
        reply: '',
        errorText: notification.turn.error?.additionalDetails
          ? `${notification.turn.error.message}\n${notification.turn.error.additionalDetails}`
          : notification.turn.error?.message ?? null,
        interrupted: notification.turn.status === 'interrupted',
      };
    }

    const reply = turn.itemOrder
      .map(itemId => turn.itemTexts.get(itemId)?.trim())
      .filter((text): text is string => Boolean(text))
      .join('\n\n')
      .trim();

    const errorText = notification.turn.error?.additionalDetails
      ? `${notification.turn.error.message}\n${notification.turn.error.additionalDetails}`
      : notification.turn.error?.message ?? turn.lastError ?? null;

    return {
      turn,
      reply,
      errorText,
      interrupted: notification.turn.status === 'interrupted',
    };
  }
}
