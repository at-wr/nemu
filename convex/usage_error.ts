/**
 * Shared error + action-ctx helper for enforcing usage limits from regular
 * (non-HTTP) Convex actions.
 *
 * Throws `UsageLimitError` when a user is over their per-tier limit. The
 * error message intentionally starts with `usage_limit_exceeded` so clients
 * that inspect `Error.message` via `useAction` can detect it.
 */

import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { UsageCategory, UsageConsumeResult } from "./usage";

export class UsageLimitError extends Error {
  code = "usage_limit_exceeded" as const;
  category: UsageCategory;
  scope: "user" | "global";
  used: number;
  limit: number;
  resetAt: number;
  tier: string;

  constructor(details: {
    category: UsageCategory;
    scope: "user" | "global";
    used: number;
    limit: number;
    resetAt: number;
    tier: string;
  }) {
    super(
      `usage_limit_exceeded:${details.category}:${details.scope} used=${details.used} limit=${details.limit}`,
    );
    this.name = "UsageLimitError";
    this.category = details.category;
    this.scope = details.scope;
    this.used = details.used;
    this.limit = details.limit;
    this.resetAt = details.resetAt;
    this.tier = details.tier;
  }
}

/**
 * Enforce a usage-limit consume for an authenticated action caller. Throws
 * when the user is not signed in or when the limit has been reached.
 */
export async function consumeActionUsage(
  ctx: ActionCtx,
  category: UsageCategory,
): Promise<UsageConsumeResult> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  const result = (await ctx.runMutation(internal.usage.consume, {
    userId: identity.subject,
    category,
  })) as UsageConsumeResult;
  if (!result.ok) {
    throw new UsageLimitError({
      category,
      scope: result.scope,
      used: result.used,
      limit: result.limit,
      resetAt: result.resetAt,
      tier: result.tier,
    });
  }
  return result;
}
