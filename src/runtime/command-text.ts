import type { BackendRoute } from '../config/backend-route.js';

const BACKEND_DISPLAY_NAMES: Record<BackendRoute, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

const BACKEND_SWITCH_MESSAGES: Record<BackendRoute, string> = {
  claude: '已切换到 Claude Code 模式。后续消息会转发给 Claude。',
  codex: '已切换到 Codex 模式。后续消息会转发给 Codex。',
};

const BACKEND_ALREADY_ACTIVE_MESSAGES: Record<BackendRoute, string> = {
  claude: '当前已经是 Claude Code 模式。',
  codex: '当前已经是 Codex 模式。',
};

const HELP_COMMAND_LINES = [
  '/help 查看帮助',
  '/stats 查看 Claude 用量和 Codex rate limit',
  '/status 查看当前运行状态',
  '/claude 切换到 Claude Code',
  '/codex 切换到 Codex',
];

const HELP_APPROVAL_LINES = [
  'yes / y 允许当前请求',
  'no / n 拒绝当前请求',
  'yesall 允许当前聊天里的全部待审批请求',
  'stopall 关闭自动连续允许',
];

const HELP_MISC_LINES = [
  '直接发文本会转发给当前后端',
  '图片和附件会按当前后端支持方式处理',
];

export function getBackendDisplayName(backend: BackendRoute): string {
  return BACKEND_DISPLAY_NAMES[backend];
}

export function getBackendSwitchMessage(backend: BackendRoute): string {
  return BACKEND_SWITCH_MESSAGES[backend];
}

export function getBackendAlreadyActiveMessage(backend: BackendRoute): string {
  return BACKEND_ALREADY_ACTIVE_MESSAGES[backend];
}

export function getHelpText(activeBackend: BackendRoute): string {
  return [
    '可用命令',
    `当前后端: ${getBackendDisplayName(activeBackend)}`,
    '',
    ...HELP_COMMAND_LINES,
    '',
    '审批回复',
    ...HELP_APPROVAL_LINES,
    '',
    '其他',
    ...HELP_MISC_LINES,
  ].join('\n');
}
