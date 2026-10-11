import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { serviceClient } from "./clients.ts";

export interface AuthUser {
  id: string;
  email?: string;
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "UNAUTHENTICATED", "Falta autenticación");
  }
  const token = header.slice(7).trim();
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "UNAUTHENTICATED", "Sesión inválida");
  return { id: data.user.id, email: data.user.email };
}

// Misma respuesta (403) si no es miembro o si su rol no alcanza: no revela si la organización existe.
export async function requireOrgRole(
  svc: SupabaseClient,
  userId: string,
  orgId: string,
  roles: string[],
): Promise<string> {
  const { data, error } = await svc
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("org_role_lookup", error.code);
    throw new HttpError(500, "DB", "Error de base de datos");
  }
  if (!data || !roles.includes(data.role)) {
    throw new HttpError(403, "FORBIDDEN", "Permisos insuficientes");
  }
  return data.role as string;
}
