import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !publicKey || !serviceRoleKey) return json({ error: "Função não configurada." }, 500);
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sessão obrigatória." }, 401);

  let payload: { organizationId?: string; email?: string; redirectTo?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }

  const organizationId = String(payload.organizationId ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const redirectTo = String(payload.redirectTo ?? "").trim();
  const requestOrigin = String(request.headers.get("Origin") ?? "").trim();
  if (!organizationId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: "Organização ou e-mail inválido." }, 400);
  if (redirectTo && !/^https:\/\//i.test(redirectTo) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/i.test(redirectTo))
    return json({ error: "URL de retorno inválida." }, 400);
  if (redirectTo && requestOrigin && new URL(redirectTo).origin !== requestOrigin)
    return json({ error: "A URL de retorno não pertence ao sistema solicitante." }, 400);

  const caller = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);

  const { data: membership, error: membershipError } = await caller
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (membershipError || !membership || !["owner", "admin"].includes(membership.role))
    return json({ error: "Somente proprietário ou administrador pode enviar convites." }, 403);

  const { data: pendingInvitation, error: invitationError } = await caller
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();
  if (invitationError || !pendingInvitation)
    return json({ error: "O convite pendente não foi encontrado." }, 409);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const options = redirectTo
    ? { redirectTo, data: { clique_obras_organization_id: organizationId } }
    : { data: { clique_obras_organization_id: organizationId } };
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, options);

  if (inviteError) {
    const message = String(inviteError.message ?? "");
    if (/already (been )?registered|already exists|user.*registered/i.test(message))
      return json({ delivery: "existing", invitationId: pendingInvitation.id });
    return json({ error: "O vínculo foi criado, mas o Supabase não conseguiu enviar o e-mail." }, 502);
  }

  return json({ delivery: "sent", invitationId: pendingInvitation.id });
});
