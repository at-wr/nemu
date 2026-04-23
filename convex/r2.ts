/**
 * R2 Storage
 *
 * Uses @convex-dev/r2 component for Cloudflare R2 file storage.
 */

import { R2 } from "@convex-dev/r2";
import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";

export const r2 = new R2(components.r2);

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Global daily throttle for anonymous cover uploads (each generateUploadUrl + syncMetadata uses two checks).
 * Set R2_ANONYMOUS_GLOBAL_DAILY_LIMIT=0 to require sign-in for uploads only.
 */
async function enforceAnonymousUploadLimit(ctx: MutationCtx): Promise<void> {
  const raw = process.env.R2_ANONYMOUS_GLOBAL_DAILY_LIMIT ?? "200";
  const max = Math.max(0, parseInt(raw, 10));
  if (max === 0) {
    throw new Error("Anonymous uploads are disabled; sign in to upload covers");
  }
  const dayKey = utcDayKey(Date.now());
  const existing = await ctx.db
    .query("r2_anonymous_daily_usage")
    .withIndex("by_day", (q) => q.eq("dayKey", dayKey))
    .first();

  const count = existing?.checks ?? 0;
  if (count >= max) {
    throw new Error(
      "Anonymous upload limit reached for today; sign in to continue uploading covers"
    );
  }

  if (existing) {
    await ctx.db.patch(existing._id, { checks: count + 1 });
  } else {
    await ctx.db.insert("r2_anonymous_daily_usage", { dayKey, checks: 1 });
  }
}

// Client API for uploads - exposed to frontend
export const { generateUploadUrl, syncMetadata } = r2.clientApi({
  checkUpload: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      return;
    }
    // r2.clientApi invokes checkUpload inside a mutation; cast for db writes.
    await enforceAnonymousUploadLimit(ctx as unknown as MutationCtx);
  },
  onUpload: async (_ctx, _bucket, key) => {
    console.log("File uploaded:", key);
  },
});

// Re-export for use in other Convex functions
export { r2 as r2Client };
