// Utilidades HTTP comunes: CORS, errores tipados y manejo seguro de excepciones.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

// ALLOWED_ORIGINS="https://app.tudominio.cl,https://admin.tudominio.cl"
// Si no está definida se permite cualquier origen (solo aceptable en desarrollo).
export function corsFor(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allowed.length === 0) return { ...base, "Access-Control-Allow-Origin": "*" };
  if (allowed.includes(origin)) return { ...base, "Access-Control-Allow-Origin": origin };
  return base;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function readJson<T = Record<string, unknown>>(
  req: Request,
  maxBytes = 262_144,
): Promise<T> {
  if (req.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Cuerpo demasiado grande");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Cuerpo demasiado grande");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Cuerpo JSON inválido");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_JSON", "Se esperaba un objeto JSON");
  }
  return value as T;
}

// Envuelve un handler: CORS, preflight y errores sin filtrar detalles internos.
export function handle(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsFor(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const res = await handler(req);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: { code: e.code, message: e.message } }, e.status, cors);
      }
      // Solo el nombre del error: el mensaje podría contener datos sensibles.
      console.error("unhandled_error", e instanceof Error ? e.name : "unknown");
      return json({ error: { code: "INTERNAL", message: "Error interno" } }, 500, cors);
    }
  };
}
