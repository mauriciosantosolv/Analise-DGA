import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  enforceRateLimit,
  isAllowedOrigin,
  json,
  preflight,
  readJson,
  rejectUntrustedOrigin,
} from "../_shared/security.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflight(request);
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !publicKey || !serviceRoleKey)
    return json(request, { error: "Função não configurada." }, 500);
  if (!authorization.startsWith("Bearer "))
    return json(request, { error: "Sessão obrigatória." }, 401);

  let payload: { organizationId?: string; email?: string; redirectTo?: string };
  try {
    payload = await readJson(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    const status = code === "BODY_TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    return json(request, { error: "Solicitação inválida." }, status);
  }

  const organizationId = String(payload.organizationId ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const redirectTo = String(payload.redirectTo ?? "").trim();
  const requestOrigin = String(request.headers.get("Origin") ?? "").trim();
  if (!UUID_PATTERN.test(organizationId) || email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json(request, { error: "Organização ou e-mail inválido." }, 400);
  if (redirectTo.length > 2048)
    return json(request, { error: "URL de retorno inválida." }, 400);
  if (redirectTo) {
    try {
      const redirectOrigin = new URL(redirectTo).origin;
      if (!isAllowedOrigin(redirectOrigin) || (requestOrigin && redirectOrigin !== requestOrigin))
        return json(request, { error: "A URL de retorno não pertence ao sistema solicitante." }, 400);
    } catch {
      return json(request, { error: "URL de retorno inválida." }, 400);
    }
  }

  const caller = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json(request, { error: "Sessão inválida." }, 401);

  const { data: membership, error: membershipError } = await caller
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError || !membership || !["owner", "admin"].includes(membership.role))
    return json(request, { error: "Somente proprietário ou administrador pode enviar convites." }, 403);

  const { data: pendingInvitation, error: invitationError } = await caller
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();
  if (invitationError || !pendingInvitation)
    return json(request, { error: "O convite pendente não foi encontrado." }, 409);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const globalLimit = await enforceRateLimit(
      admin,
      authData.user.id,
      "organization-invite-hour",
      20,
      3600,
    );
    const invitationLimit = await enforceRateLimit(
      admin,
      authData.user.id,
      `organization-invite:${pendingInvitation.id}`,
      3,
      900,
    );
    if (!globalLimit.allowed || !invitationLimit.allowed) {
      const retryAfter = Math.max(globalLimit.retryAfter, invitationLimit.retryAfter);
      return json(
        request,
        { error: "Muitas tentativas de envio. Aguarde antes de tentar novamente." },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }
  } catch {
    return json(request, { error: "Proteção de requisições indisponível. Tente novamente." }, 503);
  }
  const options = redirectTo
    ? { redirectTo, data: { clique_obras_organization_id: organizationId } }
    : { data: { clique_obras_organization_id: organizationId } };
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, options);

  if (inviteError) {
    const message = String(inviteError.message ?? "");
    if (/already (been )?registered|already exists|user.*registered/i.test(message))
      return json(request, { delivery: "existing", invitationId: pendingInvitation.id });
    return json(request, { error: "O vínculo foi criado, mas o Supabase não conseguiu enviar o e-mail." }, 502);
  }

  return json(request, { delivery: "sent", invitationId: pendingInvitation.id });
});
