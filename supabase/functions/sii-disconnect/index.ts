// POST /functions/v1/sii-disconnect
// Body: { connection_id }
// Destruye el certificado en Vault y deja la conexión desconectada. Requiere owner o admin.
import { handle, HttpError, json, readJson } from "../_shared/http.ts";
import { requireOrgRole, requireUser } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/clients.ts";
import { reqUuid } from "../_shared/validate.ts";

Deno.serve(handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson<Record<string, unknown>>(req);
  const connectionId = reqUuid(body.connection_id, "connection_id");

  const svc = serviceClient();
  const { data: conn, error: connErr } = await svc
    .from("sii_connections")
    .select("id, org_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (connErr) {
    console.error("conn_lookup", connErr.code);
    throw new HttpError(500, "DB", "Error de base de datos");
  }
  // Misma respuesta que "sin permisos": no se revela si la conexión existe.
  if (!conn) throw new HttpError(403, "FORBIDDEN", "Permisos insuficientes");

  await requireOrgRole(svc, user.id, conn.org_id, ["owner", "admin"]);

  const { error } = await svc.rpc("sii_disconnect", { p_connection_id: connectionId });
  if (error) {
    console.error("sii_disconnect", error.code);
    throw new HttpError(500, "DISCONNECT_FAILED", "No se pudo desconectar");
  }
  return json({ connection_id: connectionId, status: "disconnected" });
}));
