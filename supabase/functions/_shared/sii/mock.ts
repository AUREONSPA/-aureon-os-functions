import type { RcvKind, RcvRow, SiiCredentials, SiiProvider } from "./types.ts";
import { SiiProviderError } from "./types.ts";
import { computeDv } from "../rut.ts";

// Generador pseudoaleatorio determinista: mismos (rut, tipo, período) -> mismos datos.
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [
  "Comercial Andes", "Distribuidora Pacífico", "Servicios Cordillera", "Ferretería Maipo",
  "Logística Austral", "Tecnologías del Sur", "Importadora Los Lagos", "Papelera Biobío",
  "Alimentos Valle Central", "Transportes Araucanía",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export interface MockOptions {
  failCode?: string;
  failRetryable?: boolean;
  isInternalOrg?: boolean; // <-- NUEVO: para blindaje PRODUCTION
}

// Proveedor SIMULADO. Datos ficticios marcados con raw.mock = true.
// BLINDADO: falla con MOCK_NOT_ALLOWED si org no es interna.
export class MockSiiProvider implements SiiProvider {
  readonly name = "mock";
  readonly isMock = true;

  constructor(private opts: MockOptions = {}) {}

  private assertInternal() {
    if (this.opts.isInternalOrg === false) {
      throw new SiiProviderError(
        "MOCK_NOT_ALLOWED",
        "Mock provider bloqueado para orgs reales. Use SII oficial.",
        false
      );
    }
  }

  authenticate(creds: SiiCredentials): Promise<void> {
    this.assertInternal();

    if (!creds.rut || !creds.certB64 || !creds.certPassword) {
      return Promise.reject(
        new SiiProviderError("INVALID_CREDENTIALS", "Credenciales incompletas", false)
      );
    }
    if (this.opts.failCode) {
      return Promise.reject(
        new SiiProviderError(this.opts.failCode, "Fallo simulado", this.opts.failRetryable ?? true)
      );
    }
    return Promise.resolve();
  }

  fetchRcv(creds: SiiCredentials, kind: RcvKind, period: string): Promise<RcvRow[]> {
    this.assertInternal();

    const rand = mulberry32(hashSeed(`${creds.rut}|${kind}|${period}`));
    const count = 8 + Math.floor(rand() * 18);
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const types = kind === "purchase" ? [33, 33, 33, 34, 61] : [33, 33, 34, 61];

    const rows: RcvRow[] = [];
    const seen = new Set<string>();
    let folio = 1000 + Math.floor(rand() * 5000);

    for (let i = 0; i < count; i++) {
      const dteType = types[Math.floor(rand() * types.length)];
      folio += 1 + Math.floor(rand() * 40);
      const body = String(76_000_000 + Math.floor(rand() * 23_000_000));
      const rut = `${body}-${computeDv(body)}`;
      const key = `${dteType}|${folio}|${rut}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const base = (100 + Math.floor(rand() * 19_900)) * 100;
      const exempt = dteType === 34 ? base : 0;
      const net = dteType === 34 ? 0 : base;
      const vat = Math.round(net * 0.19);
      const day = 1 + Math.floor(rand() * daysInMonth);

      rows.push({
        dte_type: dteType,
        folio,
        counterparty_rut: rut,
        counterparty_name: `${NAMES[Math.floor(rand() * NAMES.length)]} (MOCK)`,
        doc_date: `${year}-${pad(month)}-${pad(day)}`,
        net_amount: net,
        exempt_amount: exempt,
        vat_amount: vat,
        other_taxes: 0,
        total_amount: net + exempt + vat,
        raw: { mock: true, source: "MockSiiProvider", is_internal_only: true },
      });
    }
    return Promise.resolve(rows);
  }
}