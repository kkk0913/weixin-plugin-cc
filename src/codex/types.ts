export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface RateLimitWindow {
  resetsAt: number | null;
  usedPercent: number;
  windowDurationMins: number | null;
}

export interface CreditsSnapshot {
  balance: string | null;
  hasCredits: boolean;
  unlimited: boolean;
}

export type PlanType =
  | 'free'
  | 'go'
  | 'plus'
  | 'pro'
  | 'team'
  | 'self_serve_business_usage_based'
  | 'business'
  | 'enterprise_cbp_usage_based'
  | 'enterprise'
  | 'edu'
  | 'unknown';

export interface RateLimitSnapshot {
  credits?: CreditsSnapshot | null;
  limitId?: string | null;
  limitName?: string | null;
  planType?: PlanType | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null;
}

export interface UserTextInput {
  type: 'text';
  text: string;
  text_elements: JsonValue[];
}

export interface LocalImageInput {
  type: 'localImage';
  path: string;
}

export type UserInput = UserTextInput | LocalImageInput;

export interface ThreadInfo {
  id: string;
}

export interface ThreadStartParams {
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: 'user' | 'guardian_subagent';
  sandbox?: SandboxMode;
  model?: string;
  serviceName?: string;
  developerInstructions?: string;
  ephemeral?: boolean;
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
}

export interface ThreadStartResponse {
  thread: ThreadInfo;
}

export interface ThreadResumeParams {
  threadId: string;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: 'user' | 'guardian_subagent';
  sandbox?: SandboxMode;
  model?: string;
  developerInstructions?: string;
  persistExtendedHistory: boolean;
}

export interface TurnInfo {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: {
    message: string;
    additionalDetails?: string | null;
  } | null;
}

export interface TurnStartResponse {
  turn: TurnInfo;
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
}

export interface TurnSteerParams {
  threadId: string;
  input: UserInput[];
  expectedTurnId: string;
}

export interface AgentMessageItem {
  type: 'agentMessage';
  id: string;
  text: string;
}

export interface UserMessageItem {
  type: 'userMessage';
  id: string;
  content: UserInput[];
}

export type ThreadItem = AgentMessageItem | UserMessageItem | { type: string; id: string; [key: string]: unknown };

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: TurnInfo;
}

export interface ErrorNotification {
  threadId: string;
  turnId: string;
  willRetry: boolean;
  error: {
    message: string;
    additionalDetails?: string | null;
  };
}

export interface CommandExecutionRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  additionalPermissions?: JsonValue | null;
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface RequestPermissionProfile {
  network: JsonValue | null;
  fileSystem: JsonValue | null;
}

export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  permissions: RequestPermissionProfile;
}

export interface ToolRequestUserInputQuestion {
  id: string;
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
  }>;
}

export interface ToolRequestUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
}

export interface McpServerElicitationRequestParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: 'form' | 'url';
  message: string;
  url?: string;
}

export type CodexServerRequest =
  | { id: JsonRpcId; method: 'item/commandExecution/requestApproval'; params: CommandExecutionRequestApprovalParams }
  | { id: JsonRpcId; method: 'item/fileChange/requestApproval'; params: FileChangeRequestApprovalParams }
  | { id: JsonRpcId; method: 'item/permissions/requestApproval'; params: PermissionsRequestApprovalParams }
  | { id: JsonRpcId; method: 'item/tool/requestUserInput'; params: ToolRequestUserInputParams }
  | { id: JsonRpcId; method: 'mcpServer/elicitation/request'; params: McpServerElicitationRequestParams }
  | { id: JsonRpcId; method: 'item/tool/call'; params: JsonValue };
