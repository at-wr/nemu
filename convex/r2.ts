/**
 * R2 Storage
 *
 * Uses @convex-dev/r2 component for Cloudflare R2 file storage.
 * Uploads require auth, per-user rate limits, and server-side WebP/size checks
 * (see r2_upload_guard.completeCoverUpload, awaited from the client after sync).
 */

import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAuth } from "./_lib";
import { r2 } from "./r2_instance";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.object({
    key: v.string(),
    url: v.string(),
  }),
  handler: async (ctx) => {
    await requireAuth(ctx);
    await ctx.runMutation(internal.r2_upload_guard.consumeR2UploadStep, {});
    const upload = await r2.generateUploadUrl();
    await ctx.runMutation(internal.r2_upload_guard.registerPendingCoverKey, {
      key: upload.key,
    });
    return upload;
  },
});

export const { syncMetadata } = r2.clientApi({
  checkUpload: async (ctx, bucket) => {
    void bucket;
    // @convex-dev/r2 types this as a generic query ctx; handlers run as mutations.
    const mctx = ctx as unknown as MutationCtx;
    await requireAuth(mctx);
    await mctx.runMutation(internal.r2_upload_guard.consumeR2UploadStep, {});
  },
});

// Re-export for use in other Convex functions
export { r2 as r2Client };
