// v4.5.17 - arquivamento de obra concluida.
//
// Modo "archive": chama clique_obras_archive_project COM A SESSAO DE QUEM
// PEDIU (a funcao confere proprietario/admin, a impressao digital do arquivo
// e grava a ficha resumida) e depois apaga as fotos da obra no Storage com a
// chave de servico. A regra do bucket so deixa apagar foto de RDO editavel, e
// os RDOs da obra arquivada estao aprovados - por isso a chave de servico,
// usada SO para os caminhos devolvidos pela funcao do banco.
// Modo "photos": repete a limpeza das fotos que ficaram para tras (queda de
// rede, erro do Storage). Pode ser chamado quantas vezes for preciso.
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  enforceRateLimit,
  json,
  preflight,
  readJson,
  rejectUntrustedOrigin,
} from "../_shared/security.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "rdo-evidencias";

type Payload = {
  mode?: string;
  organizationId?: string;
  projectId?: string;
  fingerprint?: string;
  file?: { name?: string; sha256?: string; bytes?: number };
};

function cleanPaths(value: unknown, organizationId: string, projectId: string): string[] {
  if (!Array.isArray(value)) return [];
  const prefix = `${organizationId}/${projectId}/`;
  return value.filter((path): path is string =>
    typeof path === "string" && path.startsWith(prefix) && !path.includes("..") && path.length < 600
  );
}

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

  let payload: Payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_JSON";
    const status = code === "BODY_TOO_LARGE" ? 413 : code === "CONTENT_TYPE" ? 415 : 400;
    return json(request, { error: "Solicitação inválida." }, status);
  }

  const mode = String(payload.mode ?? "archive");
  const organizationId = String(payload.organizationId ?? "").trim();
  const projectId = String(payload.projectId ?? "").trim();
  if (!["archive", "photos"].includes(mode))
    return json(request, { error: "Operação inválida." }, 400);
  if (!UUID_PATTERN.test(organizationId) || !projectId || projectId.length > 160 || /[\u0000-\u001f/]/.test(projectId))
    return json(request, { error: "Organização ou obra inválida." }, 400);

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
    return json(request, { error: "Somente proprietário ou administrador pode arquivar obras." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const limit = await enforceRateLimit(admin, authData.user.id, "arquivar-obra-minute", 12, 60);
    if (!limit.allowed) {
      return json(
        request,
        { error: "Muitas solicitações em sequência. Aguarde um minuto e tente novamente." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }
  } catch {
    return json(request, { error: "Proteção de requisições indisponível. Tente novamente." }, 503);
  }

  let archive: Record<string, unknown> | null = null;
  let paths: string[] = [];

  if (mode === "archive") {
    const fingerprint = String(payload.fingerprint ?? "");
    const file = payload.file ?? {};
    const { data, error } = await caller.rpc("clique_obras_archive_project", {
      target_organization_id: organizationId,
      target_project_id: projectId,
      expected_fingerprint: fingerprint,
      archive_file: {
        name: String(file.name ?? "").slice(0, 200),
        sha256: String(file.sha256 ?? ""),
        bytes: Number(file.bytes) || 0,
      },
    });
    if (error) return json(request, { error: error.message || "Não foi possível arquivar a obra." }, 409);
    archive = (data?.archive as Record<string, unknown>) ?? null;
    paths = cleanPaths(data?.object_paths, organizationId, projectId);
  } else {
    const { data, error } = await caller.rpc("clique_obras_archive_finish_photos", {
      target_organization_id: organizationId,
      target_project_id: projectId,
    });
    if (error) return json(request, { error: error.message || "Não foi possível concluir a limpeza das fotos." }, 409);
    paths = cleanPaths(data?.object_paths, organizationId, projectId);
  }

  let removed = 0;
  const failures: string[] = [];
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    const { data, error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) {
      failures.push(error.message || "erro do Storage");
      continue;
    }
    removed += Array.isArray(data) ? data.length : 0;
  }

  const { data: finish, error: finishError } = await caller.rpc("clique_obras_archive_finish_photos", {
    target_organization_id: organizationId,
    target_project_id: projectId,
  });
  if (finishError) {
    console.error("Falha ao fechar a limpeza das fotos", { projectId, message: finishError.message });
  }
  if (failures.length) {
    console.error("Falha ao apagar fotos de obra arquivada", { projectId, failures: failures.slice(0, 3) });
  }
  const remaining = finishError ? paths.length - removed : Number(finish?.remaining) || 0;

  return json(request, {
    archived: true,
    mode,
    archive,
    photos: { requested: paths.length, removed, remaining },
    warning: remaining > 0
      ? "A obra foi arquivada, mas algumas fotos ainda não saíram do armazenamento. Use \"Concluir limpeza das fotos\" na ficha da obra."
      : null,
  });
});
