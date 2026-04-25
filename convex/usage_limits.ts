/**
 * Pure helpers for the usage-limits subsystem. Kept in their own file so they
 * can be imported from unit tests without pulling in Convex server types.
 */

export type UsageCategory = "chat" | "tts" | "llm";
export type UsageTier = "free" | "donor" | "admin";

export interface CategoryLimits {
  user: number;
  global: number;
}

export const USAGE_CATEGORY_DEFAULTS: Record<
  UsageCategory,
  { free: number; donor: number; global: number }
> = {
  chat: { free: 30, donor: 200, global: 5_000 },
  tts: { free: 50, donor: 400, global: 5_000 },
  llm: { free: 100, donor: 500, global: 10_000 },
};

export function dayBucket(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function msUntilNextUtcMidnight(ts = Date.now()): number {
  const next = new Date(ts);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - ts;
}

export function readIntEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function getCategoryLimits(
  env: Record<string, string | undefined>,
  category: UsageCategory,
  tier: UsageTier,
): CategoryLimits {
  if (tier === "admin") {
    return { user: Number.POSITIVE_INFINITY, global: Number.POSITIVE_INFINITY };
  }
  const defaults = USAGE_CATEGORY_DEFAULTS[category];
  const tierSuffix = tier === "donor" ? "DONOR" : "FREE";
  const baseName = category.toUpperCase();
  const user = readIntEnv(
    env,
    `USAGE_LIMIT_${baseName}_${tierSuffix}`,
    tier === "donor" ? defaults.donor : defaults.free,
  );
  const global = readIntEnv(env, `USAGE_LIMIT_${baseName}_GLOBAL`, defaults.global);
  return { user, global };
}

export function isAdminUser(
  env: Record<string, string | undefined>,
  userId: string,
): boolean {
  return (env.USAGE_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

export function limitsDisabled(env: Record<string, string | undefined>): boolean {
  return env.USAGE_LIMITS_DISABLED === "true";
}
