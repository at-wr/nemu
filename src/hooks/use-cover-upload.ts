/**
 * Hook for uploading cover images to R2.
 *
 * Features:
 * - Client-side image resizing before upload
 * - Uses @convex-dev/r2 mutations for presigned PUT + metadata sync
 * - Server-side validation after sync (WebP + size) before returning the key
 */

import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

const MAX_COVER_WIDTH = 400;
const MAX_COVER_HEIGHT = 600;
const WEBP_QUALITY = 0.85;

/**
 * Resize an image file to fit within max dimensions.
 * Converts to WebP for smaller file size.
 */
async function resizeImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > MAX_COVER_WIDTH) {
        height = (height * MAX_COVER_WIDTH) / width;
        width = MAX_COVER_WIDTH;
      }

      if (height > MAX_COVER_HEIGHT) {
        width = (width * MAX_COVER_HEIGHT) / height;
        height = MAX_COVER_HEIGHT;
      }

      // Create canvas and resize
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to WebP blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create blob"));
            return;
          }
          // Convert Blob to File to preserve filename for R2
          const resizedFile = new File([blob], "cover.webp", {
            type: "image/webp",
          });
          resolve(resizedFile);
        },
        "image/webp",
        WEBP_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Hook for cover image uploads with automatic resizing.
 *
 * @returns Object with upload function and upload state
 */
export function useCoverUpload() {
  const generateUploadUrl = useMutation(api.r2.generateUploadUrl);
  const syncMetadata = useMutation(api.r2.syncMetadata);
  const completeCoverUpload = useAction(api.r2_upload_guard.completeCoverUpload);

  /**
   * Upload a cover image after resizing.
   * @param file The image file to upload
   * @returns The R2 object key
   */
  async function uploadCover(file: File): Promise<string> {
    const resizedFile = await resizeImage(file);

    const { url, key } = await generateUploadUrl();
    try {
      const result = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": resizedFile.type },
        body: resizedFile,
      });
      if (!result.ok) {
        throw new Error(`Failed to upload image: ${result.statusText}`);
      }
    } catch (error) {
      throw new Error(`Failed to upload image: ${String(error)}`);
    }

    await syncMetadata({ key });
    await completeCoverUpload({ key });
    return key;
  }

  return { uploadCover };
}

/**
 * Get the public URL for an R2 object.
 */
export function getR2PublicUrl(key: string): string {
  // R2_PUBLIC_URL is set to https://r2.nemu.pm
  return `https://r2.nemu.pm/${key}`;
}
