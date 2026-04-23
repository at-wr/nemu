/**
 * R2 Storage — cover uploads with guest-friendly quotas.
 *
 * - Signed-in users: unlimited (subject to R2/Convex).
 * - Anonymous: per-device daily cap on **completed** uploads only; failed PUTs do not count.
 * - `PROXY_ALLOWED_HOSTS` (optional): see proxy_utils for proxy behavior.
 */

import { R2 } from "@convex-dev/r2";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

export const r2 = new R2(components.r2);

const MAX_PENDING_KEYS = 5;
const PENDING_TTL_MS = 15 * 60 * 1000;

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function parseDeviceDailyLimit(): number {
  const raw = process.env.R2_ANONYMOUS_DEVICE_DAILY_LIMIT ?? "50";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 50;
}

function prunePendingKeys(
  pending: string[] | undefined,
  pendingAt: number | undefined,
  now: number
): string[] {
  const keys = pending ?? [];
  if (keys.length === 0) return [];
  if (pendingAt != null && now - pendingAt > PENDING_TTL_MS) {
    return [];
  }
  return keys;
}

async function getOrCreateDeviceRow(
  ctx: MutationCtx,
  deviceId: string,
  dayKey: string,
  now: number
) {
  let row = await ctx.db
    .query("r2_anonymous_device_usage")
    .withIndex("by_device_day", (q) => q.eq("deviceId", deviceId).eq("dayKey", dayKey))
    .first();

  if (!row) {
    const id = await ctx.db.insert("r2_anonymous_device_usage", {
      deviceId,
      dayKey,
      uploads: 0,
      pendingKeys: [],
      pendingAt: now,
    });
    row = (await ctx.db.get(id))!;
  }
  return row;
}

function scheduleR2Sync(ctx: MutationCtx, key: string) {
  return ctx.scheduler.runAfter(0, components.r2.lib.syncMetadata, {
    key,
    ...r2.config,
  });
}

/** Issued signed PUT URL; anonymous callers must pass the same deviceId on sync. */
export const generateCoverUploadUrl = mutation({
  args: { deviceId: v.optional(v.string()) },
  returns: v.object({ key: v.string(), url: v.string() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      return await r2.generateUploadUrl();
    }

    const deviceId = (args.deviceId ?? "").trim();
    if (!deviceId || deviceId.length > 128) {
      throw new Error("Missing or invalid device id");
    }

    const max = parseDeviceDailyLimit();
    if (max === 0) {
      throw new Error("Anonymous uploads are disabled; sign in to upload covers");
    }

    const now = Date.now();
    const dayKey = utcDayKey(now);
    const row = await getOrCreateDeviceRow(ctx, deviceId, dayKey, now);
    let pending = prunePendingKeys(row.pendingKeys, row.pendingAt, now);

    if (pending.length >= MAX_PENDING_KEYS) {
      throw new Error("Too many cover uploads in progress; wait or sign in.");
    }
    if (row.uploads >= max) {
      throw new Error(
        "Daily guest cover upload limit reached; sign in for unlimited uploads"
      );
    }

    const { key, url } = await r2.generateUploadUrl();
    pending = [...pending, key];
    await ctx.db.patch(row._id, { pendingKeys: pending, pendingAt: now });
    return { key, url };
  },
});

/** Call after successful PUT to R2. Anonymous callers must pass deviceId. */
export const syncCoverMetadata = mutation({
  args: { key: v.string(), deviceId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      await scheduleR2Sync(ctx, args.key);
      console.log("File uploaded:", args.key);
      return null;
    }

    const deviceId = (args.deviceId ?? "").trim();
    if (!deviceId || deviceId.length > 128) {
      throw new Error("Missing or invalid device id");
    }

    const max = parseDeviceDailyLimit();
    if (max === 0) {
      throw new Error("Anonymous uploads are disabled; sign in to upload covers");
    }

    const now = Date.now();
    const dayKey = utcDayKey(now);
    const row = await getOrCreateDeviceRow(ctx, deviceId, dayKey, now);
    let pending = prunePendingKeys(row.pendingKeys, row.pendingAt, now);
    const idx = pending.indexOf(args.key);
    if (idx === -1) {
      throw new Error("Invalid or expired cover upload session; try again.");
    }
    if (row.uploads >= max) {
      throw new Error(
        "Daily guest cover upload limit reached; sign in for unlimited uploads"
      );
    }

    pending = pending.filter((k) => k !== args.key);
    await ctx.db.patch(row._id, {
      pendingKeys: pending,
      pendingAt: pending.length > 0 ? row.pendingAt : undefined,
      uploads: row.uploads + 1,
    });

    await scheduleR2Sync(ctx, args.key);
    console.log("File uploaded:", args.key);
    return null;
  },
});

// Re-export for server-side use
export { r2 as r2Client };
