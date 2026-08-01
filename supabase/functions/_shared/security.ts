const DEFAULT_ALLOWED_ORIGINS = [
  "https://cliqueobras.com",
  "https://www.cliqueobras.com",
];

type RpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function allowedOrigins() {
  const configured = String(Deno.env.get("CLIQUE_OBRAS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

export function isAllowedOrigin(origin: string) {
  if (!origin) return true;
  if (allowedOrigins().has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

export function corsHeaders(request: Request) {
  const origin = String(request.headers.get("Origin") ?? "").trim();
  return {
    ...(origin && isAllowedOrigin(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

export function json(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function preflight(request: Request) {
  const origin = String(request.headers.get("Origin") ?? "").trim();
  if (origin && !isAllowedOrigin(origin)) {
    return json(request, { error: "Origem não autorizada." }, 403);
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function rejectUntrustedOrigin(request: Request) {
  const origin = String(request.headers.get("Origin") ?? "").trim();
  return origin && !isAllowedOrigin(origin)
    ? json(request, { error: "Origem não autorizada." }, 403)
    : null;
}

export async function readJson<T>(request: Request, maxBytes = 8192): Promise<T> {
  const contentType = String(request.headers.get("Content-Type") ?? "")
    .toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new Error("CONTENT_TYPE");
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function enforceRateLimit(
  admin: RpcClient,
  userId: string,
  action: string,
  maxRequests: number,
  windowSeconds: number,
) {
  const { data, error } = await admin.rpc("clique_obras_check_request_limit", {
    target_user_id: userId,
    target_action: action,
    max_requests: maxRequests,
    window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message || "RATE_LIMIT_UNAVAILABLE");
  const result = (data && typeof data === "object" ? data : {}) as {
    allowed?: boolean;
    retry_after_seconds?: number;
  };
  return {
    allowed: result.allowed === true,
    retryAfter: Math.max(1, Number(result.retry_after_seconds) || windowSeconds),
  };
}
