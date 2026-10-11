// RUT chileno: misma lógica que private.normalize_rut / private.is_valid_rut en SQL.

export function normalizeRut(input: string): string {
  const v = input.replace(/[.\s-]/g, "").toUpperCase();
  if (v.length < 2) return v;
  return `${v.slice(0, -1)}-${v.slice(-1)}`;
}

export function computeDv(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const rem = 11 - (sum % 11);
  return rem === 11 ? "0" : rem === 10 ? "K" : String(rem);
}

export function isValidRut(rut: string): boolean {
  if (!/^[0-9]{7,8}-[0-9K]$/.test(rut)) return false;
  const [body, dv] = rut.split("-");
  return computeDv(body) === dv;
}
