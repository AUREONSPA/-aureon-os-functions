// POST /functions/v1/sii-worker   (verify_jwt = false; se protege con x-worker-secret)
// Procesa trabajos de la cola sii_sync_jobs: credenciales -> proveedor SII -> rcv_documents.
// Lo invocan pg_cron (cada minuto) y sii-sync (al encolar).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handle, HttpError, json } from "../_shared/http.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { serviceClient } from "../_shared/clients.ts";
import { backoffSeconds } from "../_shared/retry.ts";
import { getProvider } from "../_shared/sii/index.ts";
import { SiiProviderError } from "../_shared/sii/types.ts";
import type { RcvKind, SiiCredentials } from "../_shared/sii/types.ts";

const TIME_BUDGET_MS = 25_000;
const MAX_JOBS_PER_RUN = 5;
const CHUNK_SIZE = 1000;

interface JobRow {
  id: string;
  org_id: string;
  connection_id: string;
  kind: string;
  period: string | null;
  attempts: number;
  max_attempts: number;
}

interface JobResult {
  job_id: string;
  status: "succeeded" | "requeued" | "failed";
  code?: string;
  rows?: number;
}

async function finish(
  svc: SupabaseClient,
  jobId: string,
  success: boolean,
  errorCode: string | null,
  retryInSeconds: number | null,
): Promise<void> {
  const { error } = await svc.rpc("sii_finish_job", {
    p_job_id: jobId,
    p_success: success,
    p_error_code: errorCode,
    p_retry_in_seconds: retryInSeconds,
  });
  if (error) console.error("sii_finish_job", error.code);
}

async function processJob(svc: SupabaseClient, job: JobRow): Promise<JobResult> {
  try {
    if (job.kind !== "rcv" || !job.period) {
      throw new SiiProviderError("NOT_IMPLEMENTED", "Tipo de trabajo no soportado", false);
    }

    await svc.from("sii_connections").update({ status: "syncing" }).eq("id", job.connection_id)
      .eq("status", "connected");

    const { data: org, error: orgErr } = await svc
      .from("organizations")
      .select("is_internal, status")
      .eq("id", job.org_id)
      .single();
    if (orgErr || !org || org.status !== "active") {
      throw new SiiProviderError("ORG_INACTIVE", "La organización no está activa", false);
    }

    const provider = getProvider(org.is_internal === true);

    // Cada lectura de credenciales queda en audit_log (lo hace la RPC).
    const { data: credRows, error: credErr } = await svc.rpc("sii_get_credentials", {
      p_connection_id: job.connection_id,
    });
    const cred = Array.isArray(credRows) ? credRows[0] : credRows;
    if (credErr || !cred) {
      throw new SiiProviderError("CREDENTIALS_UNAVAILABLE", "Credenciales no disponibles", false);
    }
    const creds: SiiCredentials = {
      rut: cred.out_rut,
      certB64: cred.out_cert_b64,
      certPassword: cred.out_cert_password,
    };

    await provider.authenticate(creds);

    let total = 0;
    for (const kind of ["purchase", "sale"] as RcvKind[]) {
      const rows = await provider.fetchRcv(creds, kind, job.period);
      total += rows.length;
      // Siempre al menos un lote: con p_replace = true limpia el período aunque llegue vacío.
      for (let i = 0; i === 0 || i < rows.length; i += CHUNK_SIZE) {
        const { error } = await svc.rpc("rcv_upsert_batch", {
          p_connection_id: job.connection_id,
          p_kind: kind,
          p_period: job.period,
          p_rows: rows.slice(i, i + CHUNK_SIZE),
          p_replace: i === 0,
        });
        if (error) {
          console.error("rcv_upsert_batch", error.code);
          throw new SiiProviderError("STORE_FAILED", "No se pudieron guardar los documentos", true, 60);
        }
      }
    }

    await finish(svc, job.id, true, null, null);
    return { job_id: job.id, status: "succeeded", rows: total };
  } catch (e) {
    const known = e instanceof SiiProviderError;
    const code = known ? e.code : "INTERNAL";
    const retryable = known ? e.retryable : true;
    const delay = retryable
      ? (known && e.retryAfterSeconds ? e.retryAfterSeconds : backoffSeconds(job.attempts))
      : null;
    console.error("job_failed", job.id, code);
    await finish(svc, job.id, false, code, delay);
    const willRetry = retryable && job.attempts < job.max_attempts;
    return { job_id: job.id, status: willRetry ? "requeued" : "failed", code };
  }
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");

  const secret = Deno.env.get("SII_WORKER_SECRET");
  const given = req.headers.get("x-worker-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) {
    throw new HttpError(401, "UNAUTHORIZED", "No autorizado");
  }

  const svc = serviceClient();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const results: JobResult[] = [];

  while (results.length < MAX_JOBS_PER_RUN && Date.now() < deadline) {
    const { data, error } = await svc.rpc("sii_claim_job");
    if (error) {
      console.error("sii_claim_job", error.code);
      break;
    }
    const job = (Array.isArray(data) ? data[0] : data) as JobRow | undefined;
    if (!job) break;
    results.push(await processJob(svc, job));
  }

  return json({ processed: results.length, results });
}));
