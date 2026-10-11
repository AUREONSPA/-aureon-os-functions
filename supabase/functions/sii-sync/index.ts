// POST /functions/v1/sii-sync
// Body: { connection_id, period }   (period = YYYYMM)
// Encola una sincronización de RCV con la identidad del usuario (la RPC valida membresía)
// y despierta al worker. Devuelve 202 con el id del trabajo.
import { handle, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { env, userClient } from "../_shared/clients.ts";
import { reqPeriod, reqUuid } from "../_shared/validate.ts";

function mapRpcError(code: string | undefined): HttpError {
  switch (code) {
    case "42501":
      return new HttpError(403, "FORBIDDEN", "Conexión SII no encontrada o sin permisos");
    case "55000":
      return new HttpError(409, "CONNECTION_INACTIVE", "La conexión SII no está activa");
    case "22023":
      return new HttpError(400, "INVALID_FIELD", "Parámetros inválidos");
    case "28000":
      return new HttpError(401, "UNAUTHENTICATED", "Sesión inválida");
    default:
      return new HttpError(500, "ENQUEUE_FAILED", "No se pudo encolar la sincronización");
  }
}

// Mejor esfuerzo: si falla, el cron del worker igual procesará el trabajo.
function kickWorker(): void {
  const secret = Deno.env.get("SII_WORKER_SECRET");
  const baseUrl = Deno.env.get("SUPABASE_URL");
  if (!secret || !baseUrl) return;
  const p = fetch(`${baseUrl}/functions/v1/sii-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-worker-secret": secret },
    body: "{}",
  }).catch(() => undefined);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(p);
}

Deno.serve(handle(async (req) => {
  await requireUser(req);
  const body = await readJson<Record<string, unknown>>(req);
  const connectionId = reqUuid(body.connection_id, "connection_id");
  const period = reqPeriod(body.period);

  env("SUPABASE_URL"); // falla temprano si falta configuración
  const { data: jobId, error } = await userClient(req).rpc("request_sii_sync", {
    p_connection_id: connectionId,
    p_kind: "rcv",
    p_period: period,
  });
  if (error) {
    console.error("request_sii_sync", error.code);
    throw mapRpcError(error.code);
  }

  kickWorker();
  return json({ job_id: jobId, status: "queued" }, 202);
}));
