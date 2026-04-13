import { CodexThreadRepository, type ThreadStateFile } from '../state/codex-thread-repository.js';
import type { ApprovalPolicy, SandboxMode, ThreadResumeParams, ThreadStartParams, ThreadStartResponse } from './types.js';

export interface CodexThreadManagerOptions {
  stateDir: string;
  cwd: string;
  model?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
  developerInstructions: string;
  debug: (msg: string) => void;
  request: <T>(method: string, params: unknown) => Promise<T>;
}

export class CodexThreadManager {
  private readonly cwd: string;
  private readonly model?: string;
  private readonly approvalPolicy?: ApprovalPolicy;
  private readonly sandbox?: SandboxMode;
  private readonly developerInstructions: string;
  private readonly debug: (msg: string) => void;
  private readonly request: <T>(method: string, params: unknown) => Promise<T>;
  private readonly threadRepository: CodexThreadRepository;
  private readonly resumedThreads = new Set<string>();
  private threadState: ThreadStateFile;

  constructor(options: CodexThreadManagerOptions) {
    this.cwd = options.cwd;
    this.model = options.model;
    this.approvalPolicy = options.approvalPolicy;
    this.sandbox = options.sandbox;
    this.developerInstructions = options.developerInstructions;
    this.debug = options.debug;
    this.request = options.request;
    this.threadRepository = new CodexThreadRepository(options.stateDir);
    this.threadState = this.threadRepository.load();
  }

  async ensureThread(chatId: string): Promise<string> {
    const existing = this.threadState.threads[chatId];
    if (existing) {
      if (!this.resumedThreads.has(existing)) {
        try {
          await this.request('thread/resume', this.buildResumeParams(existing));
          this.resumedThreads.add(existing);
        } catch (err) {
          this.debug(`thread resume failed for ${existing}: ${err}`);
          delete this.threadState.threads[chatId];
          this.save();
        }
      }
      if (this.threadState.threads[chatId]) {
        return existing;
      }
    }

    const resp = await this.request<ThreadStartResponse>('thread/start', this.buildStartParams());
    this.threadState.threads[chatId] = resp.thread.id;
    this.resumedThreads.add(resp.thread.id);
    this.save();
    return resp.thread.id;
  }

  findChatIdByThreadId(threadId: string): string | null {
    for (const [chatId, storedThreadId] of Object.entries(this.threadState.threads)) {
      if (storedThreadId === threadId) {
        return chatId;
      }
    }
    return null;
  }

  private buildResumeParams(threadId: string): ThreadResumeParams {
    return {
      threadId,
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: this.sandbox,
      ...(this.model ? { model: this.model } : {}),
      developerInstructions: this.developerInstructions,
      persistExtendedHistory: true,
    };
  }

  private buildStartParams(): ThreadStartParams {
    return {
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: this.sandbox,
      ...(this.model ? { model: this.model } : {}),
      serviceName: 'weixin-codex',
      developerInstructions: this.developerInstructions,
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    };
  }

  private save(): void {
    this.threadRepository.save(this.threadState);
  }
}
