/**
 * Per-user and global API usage limits.
 *
 * Categories:
 *   - "chat": nemu_chat httpAction
 *   - "tts":  tts  httpAction
 *   - "llm":  all other LLM calls (ai_metadata search / normalize)
 *
 * Counters are bucketed by UTC day. Each call to `consume` increments BOTH a
 * per-user counter and a global counter. If either would exceed the per-tier
 * limit the mutation returns `{ok: false}` without mutating the exceeding
 * scope's counter.
 *
 * Limits are configured via env vars so they can be tuned without redeploys;
 * see `USAGE_CATEGORY_DEFAULTS` in `./usage_limits.ts` for default values.
 *
 * Tiers:
 *   - "free":  default for all authenticated users
 *   - "donor": supporters (set via `setUserTier` internal mutation)
 *   - "admin": bypasses all limits (via USAGE_ADMIN_USER_IDS env or tier row)
 */

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAuth } from "./_lib";
import {
  dayBucket,
  getCategoryLimits,
  isAdminUser,
  limitsDisabled,
  msUntilNextUtcMidnight,
  type UsageCategory,
  type UsageTier,
} from "./usage_limits";

export type UsageScope = "user" | "global";
export type { UsageCategory, UsageTier };

const CATEGORY_VALIDATOR = v.union(
  v.literal("chat"),
  v.literal("tts"),
  v.literal("llm"),
);

const TIER_VALIDATOR = v.union(
  v.literal("free"),
  v.literal("donor"),
  v.literal("admin"),
);

const GLOBAL_KEY = "global";

async function resolveTier(ctx: MutationCtx, userId: string): Promise<UsageTier> {
  const env = process.env;
  if (isAdminUser(env, userId)) return "admin";
  const row = await ctx.db
    .query("user_usage_tier")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return row?.tier ?? "free";
}

async function bumpCounter(
  ctx: MutationCtx,
  scope: UsageScope,
  key: string,
  category: UsageCategory,
  bucket: string,
  limit: number,
): Promise<{ used: number; limit: number; blocked: boolean }> {
  const row = await ctx.db
    .query("api_usage")
    .withIndex("by_scope_key_category_bucket", (q) =>
      q.eq("scope", scope).eq("key", key).eq("category", category).eq("bucket", bucket),
    )
    .first();
  const current = row?.count ?? 0;
  if (Number.isFinite(limit) && current >= limit) {
    return { used: current, limit, blocked: true };
  }
  const next = current + 1;
  const now = Date.now();
  if (row) {
    await ctx.db.patch(row._id, { count: next, updatedAt: now });
  } else {
    await ctx.db.insert("api_usage", {
      scope,
      key,
      category,
      bucket,
      count: next,
      updatedAt: now,
    });
  }
  return { used: next, limit, blocked: false };
}

export interface UsageConsumeSuccess {
  ok: true;
  tier: UsageTier;
  category: UsageCategory;
  userUsed: number;
  userLimit: number;
  globalUsed: number;
  globalLimit: number;
  resetAt: number;
}

export interface UsageConsumeBlocked {
  ok: false;
  tier: UsageTier;
  category: UsageCategory;
  scope: UsageScope;
  used: number;
  limit: number;
  resetAt: number;
}

export type UsageConsumeResult = UsageConsumeSuccess | UsageConsumeBlocked;

export const consume = internalMutation({
  args: {
    userId: v.string(),
    category: CATEGORY_VALIDATOR,
  },
  handler: async (ctx, { userId, category }): Promise<UsageConsumeResult> => {
    const env = process.env;
    const tier = await resolveTier(ctx, userId);
    const bucket = dayBucket();
    const resetAt = Date.now() + msUntilNextUtcMidnight();

    if (tier === "admin" || limitsDisabled(env)) {
      return {
        ok: true,
        tier,
        category,
        userUsed: 0,
        userLimit: Number.POSITIVE_INFINITY,
        globalUsed: 0,
        globalLimit: Number.POSITIVE_INFINITY,
        resetAt,
      };
    }

    const limits = getCategoryLimits(env, category, tier);

    const userResult = await bumpCounter(ctx, "user", userId, category, bucket, limits.user);
    if (userResult.blocked) {
      return {
        ok: false,
        tier,
        category,
        scope: "user",
        used: userResult.used,
        limit: userResult.limit,
        resetAt,
      };
    }

    const globalResult = await bumpCounter(
      ctx,
      "global",
      GLOBAL_KEY,
      category,
      bucket,
      limits.global,
    );
    if (globalResult.blocked) {
      // Roll back the user bump so a user isn't charged when the global cap
      // is the actual blocker.
      const userRow = await ctx.db
        .query("api_usage")
        .withIndex("by_scope_key_category_bucket", (q) =>
          q.eq("scope", "user").eq("key", userId).eq("category", category).eq("bucket", bucket),
        )
        .first();
      if (userRow) {
        await ctx.db.patch(userRow._id, {
          count: Math.max(0, userRow.count - 1),
          updatedAt: Date.now(),
        });
      }
      return {
        ok: false,
        tier,
        category,
        scope: "global",
        used: globalResult.used,
        limit: globalResult.limit,
        resetAt,
      };
    }

    return {
      ok: true,
      tier,
      category,
      userUsed: userResult.used,
      userLimit: userResult.limit,
      globalUsed: globalResult.used,
      globalLimit: globalResult.limit,
      resetAt,
    };
  },
});

export const myUsage = query({
  args: {},
  handler: async (ctx) => {
    const env = process.env;
    const userId = await requireAuth(ctx);
    const tierRow = await ctx.db
      .query("user_usage_tier")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const tier: UsageTier = isAdminUser(env, userId)
      ? "admin"
      : tierRow?.tier ?? "free";
    const bucket = dayBucket();
    const resetAt = Date.now() + msUntilNextUtcMidnight();

    const categories: UsageCategory[] = ["chat", "tts", "llm"];
    const results: Array<{ category: UsageCategory; used: number; limit: number }> = [];
    for (const category of categories) {
      const row = await ctx.db
        .query("api_usage")
        .withIndex("by_scope_key_category_bucket", (q) =>
          q.eq("scope", "user").eq("key", userId).eq("category", category).eq("bucket", bucket),
        )
        .first();
      const limits = getCategoryLimits(env, category, tier);
      results.push({ category, used: row?.count ?? 0, limit: limits.user });
    }

    return { tier, resetAt, categories: results };
  },
});

/**
 * Admin-only: set a user's usage tier. Intended for CLI / dashboard use via
 *   npx convex run usage:setUserTier '{"userId":"...","tier":"donor"}'
 * Intentionally an internal mutation so it's never exposed to the client API.
 */
export const setUserTier = internalMutation({
  args: {
    userId: v.string(),
    tier: TIER_VALIDATOR,
  },
  handler: async (ctx, { userId, tier }) => {
    const existing = await ctx.db
      .query("user_usage_tier")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { tier, updatedAt: now });
    } else {
      await ctx.db.insert("user_usage_tier", { userId, tier, updatedAt: now });
    }
    return { userId, tier };
  },
});
