/**
 * Shared CORS helpers for Convex HTTP actions that must not use wildcard origins
 * when the browser sends credentials (cookies / Better-Auth headers).
 */

export function getConfiguredSiteOrigins(): string[] {
  return [process.env.SITE_URL, process.env.DEV_URL].filter(Boolean) as string[];
}

export function corsHeadersForBrowserRequest(
  request: Request
): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = getConfiguredSiteOrigins();
  const allowedOrigin =
    origin && allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Authorization, Cookie, Better-Auth-Cookie",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
