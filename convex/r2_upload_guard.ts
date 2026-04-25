import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { requireAuth } from "./_lib";
import { r2 } from "./r2_instance";

/** Rolling window for R2 upload steps (generate URL + sync metadata each cost 1). */
const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Max steps per window (20 full cover uploads per hour). */
const MAX_UPLOAD_STEPS_PER_WINDOW = 40;

const MAX_COVER_BYTES = 512 * 1024;
const ALLOWED_CONTENT_TYPE = "image/webp";

const METADATA_POLL_MS = 200;
const METADATA_WAIT_MS = 15_000;

function normalizeContentType(raw: string | undefined): string {
  return (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Internal: one R2 client step (URL generation or metadata sync).
 * Called from R2 checkUpload so both mutations share one budget.
 */
export const consumeR2UploadStep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const now = Date.now();

    const row = await ctx.db
      .query("r2_upload_counters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!row || now - row.windowStartMs >= RATE_WINDOW_MS) {
      if (row) {
        await ctx.db.patch(row._id, {
          windowStartMs: now,
          stepsUsed: 1,
        });
      } else {
        await ctx.db.insert("r2_upload_counters", {
          userId,
          windowStartMs: now,
          stepsUsed: 1,
        });
      }
      return;
    }

    if (row.stepsUsed >= MAX_UPLOAD_STEPS_PER_WINDOW) {
      throw new Error(
        "Cover upload limit reached. Please try again in up to an hour."
      );
    }

    await ctx.db.patch(row._id, { stepsUsed: row.stepsUsed + 1 });
  },
});

const PENDING_KEY_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Binds a freshly generated upload key to the authenticated user until
 * completeCoverUpload runs. This must happen before the key leaves the server;
 * syncMetadata accepts arbitrary keys and cannot establish ownership.
 */
export const registerPendingCoverKey = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const userId = await requireAuth(ctx);
    const now = Date.now();

    const stale = await ctx.db
      .query("r2_pending_cover_keys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of stale) {
      if (now - row.createdAt > PENDING_KEY_TTL_MS) {
        await ctx.db.delete(row._id);
      }
    }

    await ctx.db.insert("r2_pending_cover_keys", {
      userId,
      key,
      createdAt: now,
    });
  },
});

export const peekCoverMetadata = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    return await r2.getMetadata(ctx, key);
  },
});

export const removePendingCoverKey = internalMutation({
  args: { userId: v.string(), key: v.string() },
  handler: async (ctx, { userId, key }) => {
    const row = await ctx.db
      .query("r2_pending_cover_keys")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", key)
      )
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

export const deleteRejectedCover = internalMutation({
  args: { userId: v.string(), key: v.string() },
  handler: async (ctx, { userId, key }) => {
    const row = await ctx.db
      .query("r2_pending_cover_keys")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", key)
      )
      .first();
    if (!row || row.userId !== userId) {
      return;
    }
    await ctx.db.delete(row._id);
    await r2.deleteObject(ctx, key);
  },
});

/**
 * After PUT + syncMetadata, waits for R2 metadata then validates WebP + size.
 * Clears the pending row only after success so clients never commit a bad key.
 */
export const completeCoverUpload = action({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const pending = await ctx.runQuery(
      internal.r2_upload_guard.getPendingRow,
      { userId, key }
    );
    if (!pending) {
      throw new Error("Upload session expired or invalid. Please try again.");
    }

    const deadline = Date.now() + METADATA_WAIT_MS;
    while (Date.now() < deadline) {
      const meta = await ctx.runQuery(internal.r2_upload_guard.peekCoverMetadata, {
        key,
      });
      if (meta && meta.size != null) {
        const ct = normalizeContentType(meta.contentType);
        const size = meta.size ?? 0;
        const okType = ct === ALLOWED_CONTENT_TYPE;
        const okSize = size > 0 && size <= MAX_COVER_BYTES;

        if (!okType || !okSize) {
          await ctx.runMutation(
            internal.r2_upload_guard.deleteRejectedCover,
            { userId, key }
          );
          throw new Error(
            "Cover must be a WebP image under 512 KB after processing."
          );
        }

        await ctx.runMutation(
          internal.r2_upload_guard.removePendingCoverKey,
          { userId, key }
        );
        return;
      }
      await new Promise((r) => setTimeout(r, METADATA_POLL_MS));
    }

    throw new Error("Upload processing timed out. Please try again.");
  },
});

export const getPendingRow = internalQuery({
  args: { userId: v.string(), key: v.string() },
  handler: async (ctx, { userId, key }) => {
    return await ctx.db
      .query("r2_pending_cover_keys")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", key)
      )
      .first();
  },
});
