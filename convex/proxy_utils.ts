/**
 * SSRF mitigation and host allowlisting for the Convex HTTP proxy.
 */

const DEFAULT_ALLOWED_HOSTS = ["api.mangaupdates.com"];

function parseAllowedHosts(): string[] {
  const raw = process.env.PROXY_ALLOWED_HOSTS?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return raw?.length ? raw : DEFAULT_ALLOWED_HOSTS;
}

function isIpV4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Block obvious SSRF targets when the hostname is already an IP literal.
 * (Hostname-based filtering cannot prevent DNS rebinding; allowlisting known API hosts does.)
 */
export function isBlockedSsrIpHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;

  if (isIpV4(h)) {
    const n = ipv4ToInt(h);
    if (n == null) return true;
    // 127.0.0.0/8
    if ((n & 0xff000000) === 0x7f000000) return true;
    // 10.0.0.0/8
    if ((n & 0xff000000) === 0x0a000000) return true;
    // 172.16.0.0/12
    if ((n & 0xfff00000) === 0xac100000) return true;
    // 192.168.0.0/16
    if ((n & 0xffff0000) === 0xc0a80000) return true;
    // 169.254.0.0/16 (link-local / cloud metadata)
    if ((n & 0xffff0000) === 0xa9fe0000) return true;
    // 100.64.0.0/10 (CGNAT)
    if (n >= 0x64400000 && n <= 0x647fffff) return true;
    // 0.0.0.0/8
    if ((n & 0xff000000) === 0) return true;
  }

  // Non-IP hostnames that are commonly sensitive
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return true;

  return false;
}

export function isHostAllowedByPolicy(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (isBlockedSsrIpHostname(host)) return false;

  const allowed = parseAllowedHosts();
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

export function getProxyAllowedHostsForDiagnostics(): string[] {
  return parseAllowedHosts();
}
