import { ConvexError } from "convex/values";
import { R2_COVER_UPLOAD_RATE_LIMIT } from "../../convex/r2_upload_constants";

export function isR2CoverUploadRateLimitedError(error: unknown): boolean {
  return (
    error instanceof ConvexError && error.data === R2_COVER_UPLOAD_RATE_LIMIT
  );
}
