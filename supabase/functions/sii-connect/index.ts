// POST /functions/v1/sii-connect
// Body: { org_id, rut, cert_b64, password }
// Guarda el certificado digital (.p12) de una organización en Vault.
// Requiere rol owner o admin de la organización. Nunca devuelve ni registra secretos.
import { handle, HttpError, json, readJson } from "../_shared/http.ts";
import { requireOrgRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/clients.ts";
import { reqRut, reqString, reqUuid } from "../_shared/validate.ts";
import { inspectP12 } from "../_shared/p12.ts";

Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<Record<string, unknown>>(req, 300_000);

  const orgId = reqUuid(body.org_id, "org_id");
  const rut = reqRut(body.rut);
  const certB64 = reqString(body.cert_b64, "cert_b64", 100, 250_000);
  const password = reqString(body.password, "password", 1, 256);

  const svc = serviceClient();
  await requireOrgRole(svc, user.id, orgId, ["owner", "admin"]);

  // Valida clave, vigencia y extrae metadatos (fuera de Vault, sin secretos)
  const info = inspectP12(certB64, password);
  const now = new Date();
  if (info.validTo <= now) throw new HttpError(422, "CERT_EXPIRED", "El certificado está vencido");
  if (info.validFrom > now) throw new HttpError(422, "CERT_NOT_YET_VALID", "El certificado aún no es válido");
  if (info.subjectRut && info.subjectRut !== rut) {
    throw new HttpError(422, "RUT_MISMATCH", "El RUT del certificado no coincide con el RUT informado");
  }

  const { data: connectionId, error } = await svc.rpc("sii_store_credentials", {
    p_org_id: orgId,
    p_rut: rut,
    p_cert_b64: certB64,
    p_cert_password: password,
    p_fingerprint_sha256: info.fingerprintSha256,
    p_valid_from: info.validFrom.toISOString(),
    p_valid_to: info.validTo.toISOString(),
    p_actor: user.id,
  });
  if (error) {
    console.error("sii_store_credentials", error.code);
    throw new HttpError(500, "STORE_FAILED", "No se pudo guardar el certificado");
  }

  // Verificación del RUT de la organización: solo si el RUT salió del propio certificado.
  let rutVerified = false;
  let warning: string | undefined;
  if (info.subjectRut === rut) {
    const { data: org, error: orgErr } = await svc
      .from("organizations")
      .select("rut, rut_verified_at")
      .eq("id", orgId)
      .single();
    if (!orgErr && org && (org.rut === null || org.rut === rut)) {
      if (org.rut_verified_at) {
        rutVerified = true;
      } else {
        const patch = org.rut === null
          ? { rut, rut_verified_at: now.toISOString() }
          : { rut_verified_at: now.toISOString() };
        const { error: updErr } = await svc.from("organizations").update(patch).eq("id", orgId);
        if (!updErr) rutVerified = true;
        else if (updErr.code === "23505") warning = "RUT_ALREADY_VERIFIED_ELSEWHERE";
        else console.error("org_verify", updErr.code);
      }
    }
  }

  return json({
    connection_id: connectionId,
    rut,
    valid_to: info.validTo.toISOString(),
    fingerprint_prefix: info.fingerprintSha256.slice(0, 12),
    rut_detected_in_certificate: info.subjectRut !== null,
    rut_verified: rutVerified,
    ...(warning ? { warning } : {}),
  });
}));
