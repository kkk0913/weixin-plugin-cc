import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { AccessControl } from '../config/access.js';
import { BackendRouteControl } from '../config/backend-route.js';
import { PollLeaseControl } from '../config/poll-owner.js';
import { expandTilde } from '../util/helpers.js';
import { FlagFile } from '../state/flag-file.js';
import { MessageType } from '../weixin/types.js';
import { LoginManager, type PollRuntimeState } from './login.js';
import { SessionState } from './session-state.js';
import { ClaudeToolHandlers } from './tool-handlers.js';
import { WeixinClient } from '../weixin/api.js';
import { createInboundRouter } from './inbound-router.js';
import { ClaudeBridgeServer } from './bridge-server.js';
import {
  ACCOUNT_FILE,
  AUTO_APPROVE_FILE,
  BRIDGE_SOCKET_FILE,
  CURSOR_FILE,
  INBOX_DIR,
  LOGIN_TRIGGER_FILE,
  LOG_FILE,
  STATE_DIR,
} from './paths.js';
import { BackendManager } from './backend-manager.js';
import { PollingService } from './polling-service.js';
import { StatsService } from './stats-service.js';
import { DaemonLifecycle, type LifecycleState } from './lifecycle.js';
import { ClaudeBackendAdapter, CodexBackendAdapter } from './backends.js';

const MAX_CHUNK_LIMIT = 2048;
const MEDIA_HANDLE_TTL_MS = 30 * 60 * 1000;
const CONTEXT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const POLL_LEASE_RETRY_MS = 1000;

const client = new WeixinClient();
const loginManager = new LoginManager({
  accountFile: ACCOUNT_FILE,
  loginTriggerFile: LOGIN_TRIGGER_FILE,
  client,
});
const access = new AccessControl(STATE_DIR);
const backendRoutes = new BackendRouteControl(STATE_DIR);
const pollLease = new PollLeaseControl(STATE_DIR, {
  ownerId: `daemon-${process.pid}-${randomBytes(4).toString('hex')}`,
  kind: 'weixin-daemon',
  priority: 50,
});
const sessionState = new SessionState({
  mediaHandleTtlMs: MEDIA_HANDLE_TTL_MS,
  contextTokenTtlMs: CONTEXT_TOKEN_TTL_MS,
});
const autoApproveFlag = new FlagFile(AUTO_APPROVE_FILE);

let sessionExpired = false;
let loginTriggerCallback: (() => void) | null = null;
let bridgeServer: ClaudeBridgeServer | null = null;

const lifecycleState: LifecycleState = {
  polling: true,
  shuttingDown: false,
};

const pollRuntimeState: PollRuntimeState = {
  get sessionExpired() {
    return sessionExpired;
  },
  set sessionExpired(value: boolean) {
    sessionExpired = value;
  },
  get polling() {
    return lifecycleState.polling;
  },
  set polling(value: boolean) {
    lifecycleState.polling = value;
  },
};

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // Ignore debug log write failures.
  }
}

function resetSessionAutoApprove(): void {
  autoApproveFlag.disable();
}

function assertAllowedChat(chatId: string): void {
  access.reload();
  const result = access.gate(chatId);
  if (result.action !== 'deliver') {
    throw new Error(`chat ${chatId} is not allowlisted — pair first by having the user message from WeChat`);
  }
}

async function sendTextMessage(chatId: string, contextToken: string, text: string): Promise<void> {
  await client.sendMessage(chatId, contextToken, {
    type: MessageType.TEXT,
    text_item: { text },
  });
}

function hasActiveClaudeClient(): boolean {
  return bridgeServer?.hasActiveClient() ?? false;
}

function sendBridgePermissionDecision(requestId: string, behavior: 'allow' | 'deny'): boolean {
  return bridgeServer?.sendEventToClaude({
    kind: 'event',
    event_id: '',
    method: 'claude/permission',
    params: { request_id: requestId, behavior },
  }) ?? false;
}

const backendManager = new BackendManager({
  stateDir: STATE_DIR,
  cwd: expandTilde(process.env.WEIXIN_CODEX_CWD?.trim() || process.cwd()),
  codexCommand: process.env.WEIXIN_CODEX_COMMAND?.trim() || undefined,
  model: process.env.WEIXIN_CODEX_MODEL?.trim() || undefined,
  approvalPolicy: (process.env.WEIXIN_CODEX_APPROVAL_POLICY?.trim() as any) || 'on-request',
  sandbox: (process.env.WEIXIN_CODEX_SANDBOX?.trim() as any) || 'workspace-write',
  debug: debugLog,
  sendTextMessage,
  getContextToken: userId => sessionState.getContextToken(userId),
  hasActiveClaudeClient,
});

const statsService = new StatsService({
  debug: debugLog,
  getCodexBridge: () => backendManager.ensureCodexBridgeStarted(),
  model: process.env.WEIXIN_CODEX_MODEL,
});

const toolHandlers = new ClaudeToolHandlers({
  stateDir: STATE_DIR,
  inboxDir: INBOX_DIR,
  autoApproveFile: AUTO_APPROVE_FILE,
  maxChunkLimit: MAX_CHUNK_LIMIT,
  debug: debugLog,
  sendTextMessage,
  sendPermissionDecision: sendBridgePermissionDecision,
  assertAllowedChat,
  getContextToken: userId => sessionState.getContextToken(userId),
  takeMediaHandle: handle => sessionState.takeMediaHandle(handle),
  client,
  access,
});

const backends = {
  claude: new ClaudeBackendAdapter({
    inboxDir: INBOX_DIR,
    debug: debugLog,
    bridgeServer: {
      sendEventToClaude: event => bridgeServer?.sendEventToClaude(event) ?? false,
    },
    sessionState,
    toolHandlers,
    sendTextMessage,
    ensureReady: (chatId, contextToken) => backendManager.ensureClaudeBackendReady(chatId, contextToken),
    sendUnavailableMessage: (chatId, contextToken) => backendManager.sendBackendUnavailableMessage('claude', chatId, contextToken),
  }),
  codex: new CodexBackendAdapter({
    inboxDir: INBOX_DIR,
    debug: debugLog,
    resolveBridge: (chatId, contextToken) => backendManager.ensureCodexBackendReady(chatId, contextToken),
    sendUnavailableMessage: (chatId, contextToken) => backendManager.sendBackendUnavailableMessage('codex', chatId, contextToken),
  }),
};

const handleInbound = createInboundRouter({
  inboxDir: INBOX_DIR,
  debug: debugLog,
  access,
  client,
  backendRoutes,
  sessionState,
  sendTextMessage,
  getStatsText: () => statsService.getCombinedStatsText(),
  backends,
});

const pollingService = new PollingService({
  cursorFile: CURSOR_FILE,
  client,
  pollLease,
  handleInbound,
  debug: debugLog,
  checkLoginTrigger: () => loginManager.checkLoginTrigger(),
  onLoginTriggered: () => {
    loginTriggerCallback?.();
  },
  onSessionExpired: () => {
    sessionExpired = true;
    lifecycleState.polling = false;
  },
  isPolling: () => lifecycleState.polling,
  pollLeaseRetryMs: POLL_LEASE_RETRY_MS,
});

const lifecycle = new DaemonLifecycle({
  state: lifecycleState,
  pollLease,
  sessionState,
  getBridgeServer: () => bridgeServer,
  backendManager,
  debug: debugLog,
});

function setLoginTriggerCallback(cb: () => void): void {
  loginTriggerCallback = cb;
}

export async function runWeixinDaemon(): Promise<void> {
  resetSessionAutoApprove();
  bridgeServer = new ClaudeBridgeServer(BRIDGE_SOCKET_FILE, {
    debug: debugLog,
    onToolCall: req => toolHandlers.handleToolCall(req),
    onPermissionRequest: params => toolHandlers.handlePermissionRequest(params),
  });
  await bridgeServer.listen();
  lifecycle.installSignalHandlers();

  setLoginTriggerCallback(() => {
    lifecycleState.polling = false;
  });

  debugLog('daemon starting...');
  const saved = loginManager.loadAccount();
  if (saved) {
    client.setAuth(saved);
    process.stderr.write('weixin channel: restored saved session\n');
    const isExpired = saved.createdAt && (Date.now() - saved.createdAt) > 6 * 24 * 60 * 60 * 1000;
    if (isExpired) {
      process.stderr.write('weixin channel: saved session is older than 6 days, may need re-login\n');
    }
    process.stderr.write('weixin channel: starting message poll\n');
    await loginManager.runWithAutoReLogin(() => pollingService.run(), pollRuntimeState);
  } else {
    await loginManager.waitForLoginTrigger();
    try {
      await loginManager.startBrowserLogin();
      process.stderr.write('weixin channel: login complete, starting message poll\n');
      await loginManager.runWithAutoReLogin(() => pollingService.run(), pollRuntimeState);
    } catch (err) {
      process.stderr.write(`weixin channel: login failed: ${err}\n`);
      process.stderr.write('weixin channel: run npm run login to retry\n');
      return;
    }
  }

  if (loginManager.checkLoginTrigger() || sessionExpired) {
    try {
      await loginManager.startBrowserLogin();
      process.stderr.write('weixin channel: login complete, starting message poll\n');
      lifecycleState.polling = true;
      await loginManager.runWithAutoReLogin(() => pollingService.run(), pollRuntimeState);
    } catch (err) {
      process.stderr.write(`weixin channel: login failed: ${err}\n`);
      process.stderr.write('weixin channel: run npm run login to retry\n');
    }
  }

  if (!existsSync(BRIDGE_SOCKET_FILE)) {
    debugLog('daemon bridge socket missing before exit');
  }
}
