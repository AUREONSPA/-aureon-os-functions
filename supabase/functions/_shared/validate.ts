import { HttpError } from "./http.ts";
import { isValidRut, normalizeRut } from "./rut.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(field: string): HttpError {
  return new HttpError(400, "INVALID_FIELD", `Campo inválido: ${field}`);
}

export function reqUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw invalid(field);
  return v.toLowerCase();
}

export function reqString(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string" || v.length < min || v.length > max) throw invalid(field);
  return v;
}

export function reqRut(v: unknown, field = "rut"): string {
  if (typeof v !== "string") throw invalid(field);
  const rut = normalizeRut(v);
  if (!isValidRut(rut)) throw new HttpError(400, "INVALID_RUT", "RUT inválido");
  return rut;
}

// Período YYYYMM, no futuro.
export function reqPeriod(v: unknown, now: Date = new Date(), field = "period"): string {
  if (typeof v !== "string" || !/^[0-9]{4}(0[1-9]|1[0-2])$/.test(v)) throw invalid(field);
  const current = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (v > current) throw new HttpError(400, "INVALID_PERIOD", "El período no puede ser futuro");
  return v;
}
