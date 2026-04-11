import type { PollLeaseControl } from '../config/poll-owner.js';
import type { WeixinClient } from '../weixin/api.js';
import type { WeixinMessage } from '../weixin/types.js';
import { sleep } from '../util/helpers.js';

export interface PollLoopOptions {
  client: WeixinClient;
  pollLease: PollLeaseControl;
  loadCursor: () => string;
  saveCursor: (cursor: string) => void;
  handleInbound: (msg: WeixinMessage) => Promise<void>;
  debug: (msg: string) => void;
  checkLoginTrigger: () => boolean;
  onLoginTriggered: () => void;
  onSessionExpired: () => void;
  isPolling: () => boolean;
  pollLeaseRetryMs: number;
}

export async function pollLoop(options: PollLoopOptions): Promise<void> {
  let cursor = options.loadCursor();
  let checkCount = 0;
  let leaseHeld = false;
  let consecutiveErrors = 0;

  process.stderr.write(`weixin channel: starting poll with cursor: ${cursor ? 'loaded' : 'empty'}\n`);
  while (options.isPolling()) {
    const hasLease = options.pollLease.refresh();
    if (!hasLease) {
      if (leaseHeld) {
        const owner = options.pollLease.getOwner();
        options.debug(`poll lease lost${owner ? ` to kind=${owner.kind} pid=${owner.pid}` : ''}`);
        leaseHeld = false;
      }
      await sleep(options.pollLeaseRetryMs);
      continue;
    }
    if (!leaseHeld) {
      options.debug(`poll lease acquired kind=weixin-daemon pid=${process.pid}`);
      leaseHeld = true;
    }

    if (++checkCount % 5 === 0 && options.checkLoginTrigger()) {
      process.stderr.write('weixin channel: login triggered by user\n');
      options.pollLease.release();
      options.onLoginTriggered();
      return;
    }

    try {
      const resp = await options.client.getUpdates(cursor);
      if (resp.ret != null && resp.ret !== 0) {
        switch (resp.errcode) {
          case -14:
            process.stderr.write(`weixin channel: session expired (errcode=${resp.errcode}). Re-authenticating...\n`);
            options.onSessionExpired();
            options.pollLease.release();
            return;
          case -1:
            process.stderr.write(`weixin channel: rate limited or server busy (errcode=${resp.errcode}). Backing off...\n`);
            await sleep(5000);
            continue;
          case -2:
            process.stderr.write(`weixin channel: invalid request parameter (errcode=${resp.errcode}): ${resp.errmsg}\n`);
            consecutiveErrors++;
            continue;
          case -3:
            process.stderr.write(`weixin channel: network error (errcode=${resp.errcode}). Retrying...\n`);
            consecutiveErrors++;
            continue;
          case -5:
            process.stderr.write(`weixin channel: service unavailable (errcode=${resp.errcode}). Backing off...\n`);
            await sleep(10000);
            continue;
          default:
            throw new Error(`getUpdates error: ${resp.errmsg} (ret=${resp.ret}, errcode=${resp.errcode})`);
        }
      }

      consecutiveErrors = 0;
      if (resp.get_updates_buf) {
        cursor = resp.get_updates_buf;
        options.saveCursor(cursor);
      }

      const msgs = resp.msgs ?? [];
      options.debug(`poll: got ${msgs.length} msg(s), ret=${resp.ret}, errcode=${resp.errcode}`);
      for (const msg of msgs) {
        if (msg.message_type === 2) {
          options.debug(`skip bot msg type=${msg.message_type}`);
          continue;
        }
        options.debug(`processing msg from ${msg.from_user_id}, text=${msg.item_list?.[0]?.text_item?.text}`);
        await options.handleInbound(msg);
      }
    } catch (err) {
      consecutiveErrors++;
      const delay = Math.min(1000 * Math.pow(2, consecutiveErrors), 30_000);
      process.stderr.write(`weixin channel: poll error (${consecutiveErrors}): ${err}. Retrying in ${delay}ms\n`);
      await sleep(delay);
    }
  }

  options.pollLease.release();
}
