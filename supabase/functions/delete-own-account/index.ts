// CliqueObras v4.5.12 — "Excluir minha conta".
// Função NOVA e isolada. Nenhum dado da organização é apagado: desde a
// supabase/ATUALIZACAO-v4.5.12-CONTA-PROPRIEDADE.sql as tabelas de dado não
// têm mais chave estrangeira em cascata para auth.users. Sai só o login, o
// perfil e o vínculo com as organizações.
//
// Passos: sessão válida -> senha conferida no servidor -> confirmação "EXCLUIR"
// -> pré-checagem (único proprietário com outros membros = recusa) ->
// auth.admin.deleteUser. O gatilho do banco repete a checagem (vale também
// para exclusão pelo painel do Supabase).
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  enforceRateLimit,
  json,
  preflight,
  readJson,
  rejectUntrustedOrigin,
} from "../_shared/security.ts";

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

  let payload: { password?: string; confirm?: string; check?: boolean };
  try {
    payload = await readJson(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    const status = code === "BODY_TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    return json(request, { error: "Solicitação inválida." }, status);
  }

  const caller = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json(request, { error: "Sessão inválida." }, 401);
  const user = authData.user;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const limit = await enforceRateLimit(admin, user.id, "delete-own-account", 10, 600);
    if (!limit.allowed) {
      return json(
        request,
        { error: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }
  } catch {
    return json(request, { error: "Proteção de requisições indisponível. Tente novamente." }, 503);
  }

  // Pré-checagem (também usada sozinha pela tela, com check:true).
  const { data: check, error: checkError } = await caller.rpc("clique_obras_account_deletion_check_v4512");
  if (checkError) return json(request, { error: checkError.message || "Não foi possível verificar a conta." }, 409);
  if (payload.check === true) return json(request, { ...check, deleted: false });
  if (check?.blocked) {
    const names = Array.isArray(check.organizations)
      ? check.organizations.map((item: { name?: string }) => String(item?.name || "")).filter(Boolean).join(", ")
      : "";
    return json(request, {
      ...check,
      deleted: false,
      error: `Você é o único proprietário de ${names || "uma organização com outros membros"}. Transfira a propriedade antes de excluir a conta.`,
    }, 409);
  }

  if (String(payload.confirm ?? "").trim().toUpperCase() !== "EXCLUIR")
    return json(request, { error: "Digite EXCLUIR para confirmar." }, 400);
  const password = String(payload.password ?? "");
  if (!password || password.length > 200 || !user.email)
    return json(request, { error: "Informe sua senha para confirmar." }, 400);

  // Senha conferida no servidor, com um cliente descartável (não cria sessão no app).
  const verifier = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (signInError || !signIn.user || signIn.user.id !== user.id)
    return json(request, { error: "Senha incorreta." }, 403);
  await verifier.auth.signOut().catch(() => {});

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("Falha ao excluir conta", { userId: user.id, message: deleteError.message });
    return json(request, {
      error: "Não foi possível excluir a conta. Se você é o único proprietário de alguma organização, transfira a propriedade antes.",
    }, 409);
  }
  return json(request, { deleted: true, records: check?.records ?? 0 });
});
