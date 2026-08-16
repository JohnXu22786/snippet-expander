/**
 * hooks.ts — 事件钩子
 *
 * 目前实现一个事件：message.beforeSend
 *   在用户消息发送给模型之前被宿主调用，把消息中的 #标签 展开为正文。
 *
 * 输入上下文：
 *   { message: string; variables?: Record<string, string>; ... }
 * 输出：
 *   { message: string; meta?: { steno: {...} } }
 */

import type { ExpansionEngine } from '../core/engine.ts';

export interface MessageContext {
  message: unknown;
  variables?: Record<string, string>;
  [key: string]: unknown;
}

export interface HookOutput {
  message: unknown;
  meta?: Record<string, unknown>;
}

export type EventHandler = (ctx: MessageContext) => Promise<HookOutput>;

export function createMessageHook(
  engine: ExpansionEngine,
): (ctx: MessageContext) => Promise<HookOutput> {
  return async (ctx: MessageContext): Promise<HookOutput> => {
    if (typeof ctx.message !== 'string') {
      return {
        message: ctx.message,
        meta: { steno: { applied: false, reason: 'message is not a string' } },
      };
    }
    const result = engine.expand(ctx.message, { variables: ctx.variables });
    return {
      message: result.text,
      meta: {
        steno: {
          applied: result.expansions > 0,
          touched: result.touched,
          expansions: result.expansions,
          unresolved: result.unresolved,
          warnings: result.warnings,
        },
      },
    };
  };
}
