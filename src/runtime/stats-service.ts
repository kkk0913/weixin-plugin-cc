import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexBridge } from '../codex/bridge.js';
import type { GetAccountRateLimitsResponse, PlanType, RateLimitSnapshot } from '../codex/types.js';
import { UsageCacheRepository, type LocalUsageCache } from '../state/usage-cache-repository.js';
import { USAGE_CACHE_FILE } from './paths.js';

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface StatsCache {
  dailyActivity: DailyActivity[];
  totalMessages: number;
  totalSessions: number;
  lastComputedDate: string;
}

const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const usageCacheRepository = new UsageCacheRepository(USAGE_CACHE_FILE);

function formatTimeRemaining(resetAt: string | null | undefined): string {
  if (!resetAt) return '未知';
  const reset = new Date(resetAt);
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) return '即将重置';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}小时${minutes}分钟`;
}

function readKeychainToken(): { accessToken: string; subscriptionType: string } | null {
  try {
    const raw = execFileSync('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ], { timeout: 3000 }).toString().trim();
    const data = JSON.parse(raw);
    const oauth = data?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    const expiresAt = oauth.expiresAt;
    if (expiresAt != null && expiresAt <= Date.now()) return null;
    return { accessToken: oauth.accessToken, subscriptionType: oauth.subscriptionType ?? '' };
  } catch {
    return null;
  }
}

function fetchOAuthUsage(accessToken: string): Promise<{
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
} | null> {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1',
      },
      timeout: 10000,
    }, res => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function clampPercent(v: number | undefined | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(100, v)));
}

function getPlanName(subscriptionType: string): string {
  const t = subscriptionType.toLowerCase();
  if (t.includes('pro')) return 'Pro';
  if (t.includes('max')) return 'Max';
  if (t.includes('team')) return 'Team';
  if (t.includes('enterprise')) return 'Enterprise';
  return subscriptionType || 'Pro';
}

function formatUsageText(cache: LocalUsageCache): string {
  let text = `📊 用量配额 (${cache.planName})\n`;
  if (cache.fiveHour !== null) {
    text += `5h 已用: ${cache.fiveHour}% | 剩余: ${100 - cache.fiveHour}% | 重置: ${formatTimeRemaining(cache.fiveHourResetAt)}\n`;
  }
  if (cache.sevenDay !== null) {
    text += `7d 已用: ${cache.sevenDay}% | 剩余: ${100 - cache.sevenDay}% | 重置: ${formatTimeRemaining(cache.sevenDayResetAt)}\n`;
  }
  return text;
}

async function getClaudeUsageText(): Promise<string> {
  const cached = usageCacheRepository.load();
  let staleCache: LocalUsageCache | null = null;
  if (cached) {
    if (Date.now() - cached.timestamp < USAGE_CACHE_TTL_MS) {
      return formatUsageText(cached);
    }
    staleCache = cached;
  }

  const creds = readKeychainToken();
  if (!creds) {
    return staleCache
      ? `${formatUsageText(staleCache)}⚠️ 数据来自缓存 (凭据读取失败)\n`
      : '❌ 用量信息: 无法读取凭据';
  }

  const apiData = await fetchOAuthUsage(creds.accessToken);
  if (!apiData) {
    return staleCache
      ? `${formatUsageText(staleCache)}⚠️ 数据来自旧缓存 (API 暂时不可用)\n`
      : '❌ 用量信息: API 暂时不可用';
  }

  const result: LocalUsageCache = {
    planName: getPlanName(creds.subscriptionType),
    fiveHour: clampPercent(apiData.five_hour?.utilization),
    sevenDay: clampPercent(apiData.seven_day?.utilization),
    fiveHourResetAt: apiData.five_hour?.resets_at ?? null,
    sevenDayResetAt: apiData.seven_day?.resets_at ?? null,
    timestamp: Date.now(),
  };

  usageCacheRepository.save(result);

  return formatUsageText(result);
}

function getClaudeActivityText(): string {
  try {
    const statsPath = join(homedir(), '.claude', 'stats-cache.json');
    const raw = readFileSync(statsPath, 'utf-8');
    const stats: StatsCache = JSON.parse(raw);
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyActivity.find(day => day.date === today);
    const recentDays = stats.dailyActivity.slice(-7);
    const avgMessages = recentDays.length > 0
      ? Math.round(recentDays.reduce((acc, day) => acc + day.messageCount, 0) / recentDays.length)
      : 0;

    let text = '\n📈 使用统计\n';
    if (todayStats) {
      text += `今日: ${todayStats.messageCount} 消息 | ${todayStats.sessionCount} 会话 | ${todayStats.toolCallCount} 工具调用\n`;
    } else {
      text += '今日: 暂无数据\n';
    }
    text += `近7天平均: ${avgMessages} 消息/天\n`;
    text += `总计: ${stats.totalMessages} 消息 | ${stats.totalSessions} 会话`;
    return text;
  } catch {
    return '\n📈 使用统计: 暂无数据';
  }
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

function formatCodexWindow(label: string, snapshot: { usedPercent: number; resetsAt: number | null; windowDurationMins: number | null } | null | undefined): string | null {
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

function formatCodexRateLimitsText(data: GetAccountRateLimitsResponse, model?: string): string {
  const snapshot = pickCodexRateLimitSnapshot(data);
  const lines = [
    `\n🤖 Codex Rate Limit (${model ?? 'default'})`,
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

export interface StatsServiceOptions {
  debug: (msg: string) => void;
  getCodexBridge: () => Promise<CodexBridge | null>;
  model?: string;
}

export class StatsService {
  private readonly debug: (msg: string) => void;
  private readonly getCodexBridge: () => Promise<CodexBridge | null>;
  private readonly model?: string;

  constructor(options: StatsServiceOptions) {
    this.debug = options.debug;
    this.getCodexBridge = options.getCodexBridge;
    this.model = options.model;
  }

  async getCombinedStatsText(): Promise<string> {
    const [claudeStats, codexRateLimits] = await Promise.all([
      this.getClaudeStatsCombined(),
      this.getCodexRateLimitText(),
    ]);
    return `${claudeStats}${codexRateLimits}`;
  }

  private async getClaudeStatsCombined(): Promise<string> {
    return (await getClaudeUsageText()) + getClaudeActivityText();
  }

  private async getCodexRateLimitText(): Promise<string> {
    const bridge = await this.getCodexBridge();
    if (!bridge) {
      return '\n🤖 Codex Rate Limit: Codex 未启动';
    }
    const rateLimits = await bridge.getRateLimits();
    if (!rateLimits) {
      return '\n🤖 Codex Rate Limit: 暂时不可用';
    }
    return formatCodexRateLimitsText(rateLimits, this.model);
  }
}
