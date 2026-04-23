/**
 * CORS proxy via Convex HTTP actions (e.g. MangaUpdates blocks Cloudflare).
 * Locked down: host allowlist, SSRF blocks, no arbitrary x-proxy-* injection,
 * browser CORS matches SITE_URL / DEV_URL only.
 */

import { httpAction } from "./_generated/server";
import { corsHeadersForBrowserRequest } from "./cors_utils";
import { isHostAllowedByPolicy } from "./proxy_utils";

const SAFE_REQUEST_HEADER_ALLOWLIST = new Set([
  "content-type",
  "accept",
  "accept-language",
  "accept-encoding",
]);

function buildUpstreamHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  let customUa: string | null = null;
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "x-proxy-user-agent") {
      customUa = value;
      return;
    }
    if (SAFE_REQUEST_HEADER_ALLOWLIST.has(lower)) {
      headers[key] = value;
    }
  });
  const ua = customUa || headers["User-Agent"] || headers["user-agent"];
  if (ua) {
    headers["User-Agent"] = ua;
    delete headers["user-agent"];
  } else {
    headers["User-Agent"] = "Mozilla/5.0 (compatible; Nemu/1.0)";
  }
  return headers;
}

export const proxy = httpAction(async (_, request) => {
  const cors = corsHeadersForBrowserRequest(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing 'url' parameter", { status: 400, headers: cors });
  }

  let target: URL;
  try {
    target = new URL(targetUrl);
    if (!["http:", "https:"].includes(target.protocol)) {
      return new Response("Invalid protocol", { status: 400, headers: cors });
    }
  } catch {
    return new Response("Invalid URL", { status: 400, headers: cors });
  }

  const hostname = target.hostname.toLowerCase();
  if (!isHostAllowedByPolicy(hostname)) {
    return new Response("Host not allowed", { status: 403, headers: cors });
  }

  const headers = buildUpstreamHeaders(request);

  try {
    let body: ArrayBuffer | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.arrayBuffer();
    }

    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body,
    });

    const responseHeaders = new Headers(cors);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }

    const data = await response.arrayBuffer();
    return new Response(data, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[ConvexProxy] Error:", error);
    return new Response("Proxy error", { status: 502, headers: cors });
  }
});

export const proxyOptions = httpAction(async (_, request) => {
  return new Response(null, {
    status: 204,
    headers: corsHeadersForBrowserRequest(request),
  });
});
