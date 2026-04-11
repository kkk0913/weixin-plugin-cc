export interface BridgeNotificationMeta {
  chat_id: string;
  message_id: string;
  user: string;
  ts: string;
  image_path?: string;
  attachment_file_ids?: string[];
  attachment_names?: string[];
  attachment_file_id?: string;
  attachment_name?: string;
}

export interface BridgeToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface BridgeToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface BridgePermissionRequestParams {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
}

export interface BridgePermissionDecisionParams {
  request_id: string;
  behavior: 'allow' | 'deny';
}

export type BridgeRequest =
  | { kind: 'request'; id: string; method: 'daemon/ping'; params?: Record<string, never> }
  | { kind: 'request'; id: string; method: 'claude/register'; params: { clientId: string } }
  | { kind: 'request'; id: string; method: 'tool/call'; params: BridgeToolCallRequest }
  | { kind: 'request'; id: string; method: 'claude/permission_request'; params: BridgePermissionRequestParams };

export type BridgeResponse =
  | { kind: 'response'; id: string; ok: true; result?: unknown }
  | { kind: 'response'; id: string; ok: false; error: string };

export type BridgeEvent =
  | { kind: 'event'; method: 'claude/channel'; params: { content: string | null; meta: BridgeNotificationMeta } }
  | { kind: 'event'; method: 'claude/permission'; params: BridgePermissionDecisionParams };

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent;
