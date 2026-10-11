import type { RcvKind, RcvRow, SiiCredentials, SiiProvider } from "./types.ts";
import { SiiProviderError } from "./types.ts";

function notImplemented(): SiiProviderError {
  return new SiiProviderError(
    "NOT_IMPLEMENTED",
    "Integración oficial con el SII pendiente de implementar y certificar",
    false,
  );
}

// Punto de entrada para la integración REAL. No se implementa a ciegas: primero hay
// que confirmar contra la documentación oficial del SII qué servicios y formatos
// existen para RCV, y el esquema de autenticación con certificado digital.
export class OfficialSiiProvider implements SiiProvider {
  readonly name = "official";
  readonly isMock = false;

  authenticate(_creds: SiiCredentials): Promise<void> {
    return Promise.reject(notImplemented());
  }

  fetchRcv(_creds: SiiCredentials, _kind: RcvKind, _period: string): Promise<RcvRow[]> {
    return Promise.reject(notImplemented());
  }
}
