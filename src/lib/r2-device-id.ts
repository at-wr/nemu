const LS_KEY = "nemu:r2-guest-device-id";
const SS_KEY = "nemu:r2-guest-device-id-session";

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }
}

/**
 * Stable anonymous id for R2 guest quotas (not auth; local only).
 * Prefers localStorage, then sessionStorage if storage is restricted.
 */
export function getOrCreateR2GuestDeviceId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    let id = localStorage.getItem(LS_KEY)?.trim();
    if (!id) {
      id = randomId();
      localStorage.setItem(LS_KEY, id);
    }
    return id;
  } catch {
    try {
      let id = sessionStorage.getItem(SS_KEY)?.trim();
      if (!id) {
        id = randomId();
        sessionStorage.setItem(SS_KEY, id);
      }
      return id;
    } catch {
      return "";
    }
  }
}
