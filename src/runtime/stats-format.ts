import type { GetAccountRateLimitsResponse, PlanType, RateLimitSnapshot } from '../codex/types.js';
import type { LocalUsageCache } from '../state/usage-cache-repository.js';

function formatTimeRemaining(resetAt: string | null | undefined): string {
  if (!resetAt) return '未知';
  const reset = new Date(resetAt);
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) return '即将重置';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}小时${minutes}分钟`;
}

function formatResetTimeFromEpochMs(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs)) {
    return '未知';
  }
  const diffMs = epochMs - Date.now();
  if (diffMs <= 0) {
    return '即将重置';
  }
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}小时${minutes}分钟`;
}

function formatPlanType(planType: PlanType | null | undefined): string {
  switch (planType) {
    case 'free': return 'Free';
    case 'go': return 'Go';
    case 'plus': return 'Plus';
    case 'pro': return 'Pro';
    case 'team': return 'Team';
    case 'business':
    case 'self_serve_business_usage_based': return 'Business';
    case 'enterprise':
    case 'enterprise_cbp_usage_based': return 'Enterprise';
    case 'edu': return 'Edu';
    default: return 'Unknown';
  }
}

function formatCodexWindow(
  label: string,
  snapshot: { usedPercent: number; resetsAt: number | null; windowDurationMins: number | null } | null | undefined,
): string | null {
  if (!snapshot) {
    return null;
  }
  return `${label}: 已用 ${snapshot.usedPercent}% | 剩余 ${100 - snapshot.usedPercent}% | 重置: ${formatResetTimeFromEpochMs(snapshot.resetsAt)}${snapshot.windowDurationMins ? ` | 窗口: ${snapshot.windowDurationMins}m` : ''}`;
}

function pickCodexRateLimitSnapshot(data: GetAccountRateLimitsResponse): RateLimitSnapshot {
  if (data.rateLimitsByLimitId?.codex) {
    return data.rateLimitsByLimitId.codex;
  }
  return data.rateLimits;
}

export function formatClaudeUsageText(cache: LocalUsageCache): string {
  let text = `【Claude Code】\n`;
  text += `━━━━━━━━━━━━━━━━\n`;
  text += `📊 用量配额 (${cache.planName})\n`;
  if (cache.fiveHour !== null) {
    text += `5h 已用: ${cache.fiveHour}% | 剩余: ${100 - cache.fiveHour}% | 重置: ${formatTimeRemaining(cache.fiveHourResetAt)}\n`;
  }
  if (cache.sevenDay !== null) {
    text += `7d 已用: ${cache.sevenDay}% | 剩余: ${100 - cache.sevenDay}% | 重置: ${formatTimeRemaining(cache.sevenDayResetAt)}\n`;
  }
  return text;
}

export function formatCodexRateLimitsText(data: GetAccountRateLimitsResponse, model?: string): string {
  const snapshot = pickCodexRateLimitSnapshot(data);
  const lines = [
    `\n【Codex】`,
    `━━━━━━━━━━━━━━━━`,
    `🤖 Rate Limit (${model ?? 'default'})`,
    `套餐: ${formatPlanType(snapshot.planType)}`,
  ];
  if (snapshot.limitName || snapshot.limitId) {
    lines.push(`限额桶: ${snapshot.limitName ?? snapshot.limitId}`);
  }
  const primary = formatCodexWindow('主窗口', snapshot.primary);
  if (primary) {
    lines.push(primary);
  }
  const secondary = formatCodexWindow('次窗口', snapshot.secondary);
  if (secondary) {
    lines.push(secondary);
  }
  if (snapshot.credits) {
    if (snapshot.credits.unlimited) {
      lines.push('额度: unlimited');
    } else if (snapshot.credits.balance != null) {
      lines.push(`额度余额: ${snapshot.credits.balance}`);
    } else if (!snapshot.credits.hasCredits) {
      lines.push('额度: 无可用 credits');
    }
  }
  return lines.join('\n');
}
