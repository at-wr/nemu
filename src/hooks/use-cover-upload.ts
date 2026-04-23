/**
 * Hook for uploading cover images to R2.
 *
 * Features:
 * - Client-side image resizing before upload
 * - Uses Convex mutations (guest: per-device daily quota on completed uploads only)
 */

import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "../../convex/_generated/api";
import { getOrCreateR2GuestDeviceId } from "@/lib/r2-device-id";

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
  const generateCoverUploadUrl = useMutation(api.r2.generateCoverUploadUrl);
  const syncCoverMetadata = useMutation(api.r2.syncCoverMetadata);

  const uploadCover = useCallback(
    async (file: File): Promise<string> => {
      const resizedFile = await resizeImage(file);
      const deviceId = getOrCreateR2GuestDeviceId();

      const { url, key } = await generateCoverUploadUrl(
        deviceId ? { deviceId } : {}
      );

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
        throw new Error(`Failed to upload image: ${error}`);
      }

      await syncCoverMetadata(deviceId ? { key, deviceId } : { key });
      return key;
    },
    [generateCoverUploadUrl, syncCoverMetadata]
  );

  return { uploadCover };
}

/**
 * Get the public URL for an R2 object.
 */
export function getR2PublicUrl(key: string): string {
  // R2_PUBLIC_URL is set to https://r2.nemu.pm
  return `https://r2.nemu.pm/${key}`;
}
