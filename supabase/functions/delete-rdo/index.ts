import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  enforceRateLimit,
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

  let payload: { organizationId?: string; rdoId?: string };
  try {
    payload = await readJson(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    const status = code === "BODY_TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    return json(request, { error: "Solicitação inválida." }, status);
  }

  const organizationId = String(payload.organizationId ?? "").trim();
  const rdoId = String(payload.rdoId ?? "").trim();
  if (!UUID_PATTERN.test(organizationId) || !rdoId || rdoId.length > 160 || /[\u0000-\u001f]/.test(rdoId))
    return json(request, { error: "Organização ou RDO inválido." }, 400);

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
    return json(request, { error: "Somente proprietário ou administrador pode excluir RDO aprovado." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const limit = await enforceRateLimit(
      admin,
      authData.user.id,
      "delete-rdo-minute",
      20,
      60,
    );
    if (!limit.allowed) {
      return json(
        request,
        { error: "Muitas exclusões em sequência. Aguarde antes de tentar novamente." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }
  } catch {
    return json(request, { error: "Proteção de requisições indisponível. Tente novamente." }, 503);
  }

  const { data: deletion, error: deletionError } = await caller.rpc("clique_obras_delete_rdo", {
    target_organization_id: organizationId,
    target_rdo_id: rdoId,
  });
  if (deletionError)
    return json(request, { error: deletionError.message || "Não foi possível excluir o RDO." }, 409);

  const objectPaths = Array.isArray(deletion?.object_paths)
    ? deletion.object_paths.filter((path: unknown): path is string => typeof path === "string" && path.length > 0)
    : [];
  if (objectPaths.length > 0) {
    const { error: storageError } = await admin.storage.from("rdo-evidencias").remove(objectPaths);
    if (storageError) {
      console.error("Falha ao limpar evidências de RDO", {
        rdoId,
        objectCount: objectPaths.length,
        message: storageError.message,
      });
      return json(request, {
        ...deletion,
        deleted: true,
        storageDeleted: 0,
        warning: "O RDO foi excluído, mas algumas fotos não puderam ser removidas do armazenamento.",
      }, 200);
    }
  }

  return json(request, { ...deletion, deleted: true, storageDeleted: objectPaths.length });
});
