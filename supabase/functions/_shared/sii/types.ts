export type RcvKind = "purchase" | "sale";

export interface SiiCredentials {
  rut: string;          // RUT normalizado del titular del certificado
  certB64: string;      // .p12 en base64
  certPassword: string; // clave del .p12
}

// Fila normalizada del RCV. Los montos son enteros en CLP.
export interface RcvRow {
  dte_type: number;
  folio: number;
  counterparty_rut: string;          // proveedor (compras) o cliente (ventas)
  counterparty_name: string | null;
  doc_date: string | null;           // YYYY-MM-DD
  net_amount: number;
  exempt_amount: number;
  vat_amount: number;
  other_taxes: number;
  total_amount: number;
  raw: Record<string, unknown>;      // campos originales que no tienen columna propia
}

export class SiiProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SiiProviderError";
  }
}

// Contrato único: el worker no sabe si habla con el mock o con el SII oficial.
export interface SiiProvider {
  readonly name: string;
  readonly isMock: boolean;
  authenticate(creds: SiiCredentials): Promise<void>;
  fetchRcv(creds: SiiCredentials, kind: RcvKind, period: string): Promise<RcvRow[]>;
}
