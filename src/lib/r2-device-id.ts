const STORAGE_KEY = "nemu:r2-guest-device-id";

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }
}

/**
 * Stable anonymous id for R2 guest quotas (not auth; local only).
 */
export function getOrCreateR2GuestDeviceId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    let id = localStorage.getItem(STORAGE_KEY)?.trim();
    if (!id) {
      id = randomId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
