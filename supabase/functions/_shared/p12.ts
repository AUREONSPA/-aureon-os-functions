import forge from "npm:node-forge@1.3.1";
import { HttpError } from "./http.ts";
import { isValidRut, normalizeRut } from "./rut.ts";

export interface P12Info {
  fingerprintSha256: string;  // SHA-256 (hex) del certificado
  validFrom: Date;
  validTo: Date;
  subjectRut: string | null;  // RUT detectado en el certificado (mejor esfuerzo)
}

const RUT_RE = /\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/;

// Abre el .p12 con su clave y extrae solo metadatos. No devuelve ni registra la clave privada.
// NOTA: node-forge soporta los cifrados PKCS#12 clásicos (3DES / RC2 con MAC SHA-1), que son los
// habituales en certificados de CAs chilenas. Archivos generados con algoritmos más nuevos
// (AES / MAC SHA-256) pueden fallar: pruébalo con un certificado real antes de usarlo con clientes.
export function inspectP12(certB64: string, password: string): P12Info {
  // deno-lint-ignore no-explicit-any
  let p12: any;
  try {
    const der = forge.util.decode64(certB64);
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new HttpError(
      422,
      "INVALID_CERTIFICATE",
      "No se pudo abrir el certificado: archivo dañado, formato no soportado o clave incorrecta",
    );
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const plainKeys = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  if (certBags.length === 0 || shrouded.length + plainKeys.length === 0) {
    throw new HttpError(422, "INVALID_CERTIFICATE", "El archivo no contiene certificado y llave privada");
  }

  // Certificado de la persona/empresa: el primero que no sea una CA.
  // deno-lint-ignore no-explicit-any
  const leaf = certBags.map((b: any) => b.cert).filter(Boolean).find((c: any) => {
    const bc = c.getExtension("basicConstraints");
    return !(bc && bc.cA === true);
  }) ?? certBags[0].cert;
  if (!leaf) throw new HttpError(422, "INVALID_CERTIFICATE", "Certificado ilegible");

  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const md = forge.md.sha256.create();
  md.update(derBytes);

  return {
    fingerprintSha256: md.digest().toHex(),
    validFrom: leaf.validity.notBefore as Date,
    validTo: leaf.validity.notAfter as Date,
    subjectRut: detectRut(leaf, derBytes),
  };
}

// Mejor esfuerzo: serialNumber del sujeto, luego el CN, luego cualquier RUT dentro del DER
// (cubre el RUT en extensiones SubjectAltName). Se valida el dígito verificador.
// deno-lint-ignore no-explicit-any
function detectRut(cert: any, derBytes: string): string | null {
  const candidates: string[] = [];
  const serial = cert.subject.getField({ name: "serialNumber" })?.value;
  const cn = cert.subject.getField({ name: "commonName" })?.value;
  for (const v of [serial, cn, derBytes]) {
    if (typeof v !== "string") continue;
    const m = v.match(RUT_RE);
    if (m) candidates.push(m[1]);
  }
  for (const c of candidates) {
    const rut = normalizeRut(c);
    if (isValidRut(rut)) return rut;
  }
  return null;
}
