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

  let payload: { organizationId?: string; rdoId?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }

  const organizationId = String(payload.organizationId ?? "").trim();
  const rdoId = String(payload.rdoId ?? "").trim();
  if (!organizationId || !rdoId) return json({ error: "Organização ou RDO inválido." }, 400);

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
    return json({ error: "Somente proprietário ou administrador pode excluir RDO aprovado." }, 403);

  const { data: deletion, error: deletionError } = await caller.rpc("clique_obras_delete_rdo", {
    target_organization_id: organizationId,
    target_rdo_id: rdoId,
  });
  if (deletionError) return json({ error: deletionError.message || "Não foi possível excluir o RDO." }, 409);

  const objectPaths = Array.isArray(deletion?.object_paths)
    ? deletion.object_paths.filter((path: unknown): path is string => typeof path === "string" && path.length > 0)
    : [];
  if (objectPaths.length > 0) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: storageError } = await admin.storage.from("rdo-evidencias").remove(objectPaths);
    if (storageError) {
      console.error("Falha ao limpar evidências de RDO", {
        rdoId,
        objectCount: objectPaths.length,
        message: storageError.message,
      });
      return json({
        ...deletion,
        deleted: true,
        storageDeleted: 0,
        warning: "O RDO foi excluído, mas algumas fotos não puderam ser removidas do armazenamento.",
      }, 200);
    }
  }

  return json({ ...deletion, deleted: true, storageDeleted: objectPaths.length });
});
