// Declaraciones mínimas SOLO para poder comprobar tipos fuera de Deno.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare module "npm:@supabase/supabase-js@2" {
  // deno-lint-ignore no-explicit-any
  export type SupabaseClient = any;
  export function createClient(url: string, key: string, options?: unknown): SupabaseClient;
}

declare module "npm:node-forge@1.3.1" {
  // deno-lint-ignore no-explicit-any
  const forge: any;
  export default forge;
}
