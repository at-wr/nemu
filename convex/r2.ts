/**
 * R2 Storage
 *
 * Uses @convex-dev/r2 component for Cloudflare R2 file storage.
 * Uploads require auth, per-user rate limits, and server-side WebP/size checks
 * (see r2_upload_guard.completeCoverUpload, awaited from the client after sync).
 */

import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { requireAuth } from "./_lib";
import { r2 } from "./r2_instance";

export const { generateUploadUrl, syncMetadata } = r2.clientApi({
  checkUpload: async (ctx, bucket) => {
    void bucket;
    // @convex-dev/r2 types this as a generic query ctx; handlers run as mutations.
    const mctx = ctx as unknown as MutationCtx;
    await requireAuth(mctx);
    await mctx.runMutation(internal.r2_upload_guard.consumeR2UploadStep, {});
  },
  onUpload: async (ctx, _bucket, key) => {
    await ctx.runMutation(internal.r2_upload_guard.registerPendingCoverKey, {
      key,
    });
  },
});

// Re-export for use in other Convex functions
export { r2 as r2Client };
