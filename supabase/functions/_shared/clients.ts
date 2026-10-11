import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error("missing_env", name);
    throw new HttpError(500, "CONFIG", "Configuración incompleta");
  }
  return v;
}

// Cliente con privilegios de servicio: SOLO dentro de Edge Functions, nunca hacia el navegador.
export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente que actúa con la identidad (JWT) del usuario que llama: respeta RLS y permisos de RPC.
export function userClient(req: Request): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
