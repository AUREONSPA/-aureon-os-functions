import type { SiiProvider } from "./types.ts";
import { SiiProviderError } from "./types.ts";
import { MockSiiProvider } from "./mock.ts";
import { OfficialSiiProvider } from "./official.ts";

// SII_PROVIDER = "mock" (por defecto) | "official"
//
// SEGURIDAD PRODUCTION: el proveedor simulado inventa datos tributarios.
// Solo se permite para organizaciones internas (organizations.is_internal = true).
// Una organización real nunca debe recibir datos ficticios ni verlos como si
// vinieran del SII. Doble blindaje: index.ts + mock.ts ambos validan.

export function getProvider(orgIsInternal: boolean): SiiProvider {
  const mode = (Deno.env.get("SII_PROVIDER") ?? "mock").toLowerCase();
  const env = Deno.env.get("ENV") ?? "development";

  if (mode === "mock") {
    // REGLA DE ORO - BLOQUEO PARA ORGS REALES
    if (!orgIsInternal) {
      throw new SiiProviderError(
        "MOCK_NOT_ALLOWED",
        "El proveedor simulado solo se permite en organizaciones internas (is_internal=true)",
        false,
      );
    }

    if (env === "production") {
      console.warn("[SII] WARN: Using MockSiiProvider in production - allowed only for internal orgs");
    }

    // Defensa en profundidad: pasa flag a mock + failCode para testing
    return new MockSiiProvider({
      failCode: Deno.env.get("SII_MOCK_FAIL_CODE") || undefined,
      isInternalOrg: orgIsInternal,
    });
  }

  if (mode === "official") {
    return new OfficialSiiProvider();
  }

  throw new SiiProviderError(
    "CONFIG",
    `SII_PROVIDER inválido: ${mode}. Valores permitidos: mock | official`,
    false,
  );
}

// Alias para compatibilidad si algún worker usa getSiiProvider(org)
export function getSiiProvider(org: { is_internal: boolean }): SiiProvider {
  return getProvider(org.is_internal);
}