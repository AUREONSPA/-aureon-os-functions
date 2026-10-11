// Pruebas unitarias de la lógica pura (sin Deno ni Supabase).
// Uso:  tsc -p tests/tsconfig.build.json && node tests/unit.test.mjs
import assert from "node:assert/strict";

// Shim mínimo de Deno para los módulos que leen variables de entorno.
globalThis.Deno = { env: { get: (k) => process.env[k] } };

const base = new URL("./build/", import.meta.url);
const rut = await import(new URL("_shared/rut.js", base));
const crypto = await import(new URL("_shared/crypto.js", base));
const retry = await import(new URL("_shared/retry.js", base));
const http = await import(new URL("_shared/http.js", base));
const validate = await import(new URL("_shared/validate.js", base));
const types = await import(new URL("_shared/sii/types.js", base));
const mock = await import(new URL("_shared/sii/mock.js", base));
const official = await import(new URL("_shared/sii/official.js", base));

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok  ", name);
  } catch (e) {
    console.error("  FAIL", name, "\n      ", e.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- RUT
await test("RUT: dígito verificador conocido", () => {
  assert.equal(rut.computeDv("12345678"), "5");
  assert.equal(rut.computeDv("11111111"), "1");
  assert.equal(rut.computeDv("66666666"), "6");
  assert.equal(rut.computeDv("78511531"), "7");
});
await test("RUT: normaliza puntos, guion y minúsculas", () => {
  assert.equal(rut.normalizeRut("12.345.678-5"), "12345678-5");
  assert.equal(rut.normalizeRut(" 123456785 "), "12345678-5");
  assert.equal(rut.normalizeRut("7.654.321-k"), "7654321-K");
});
await test("RUT: validación", () => {
  assert.equal(rut.isValidRut("12345678-5"), true);
  assert.equal(rut.isValidRut("12345678-9"), false);
  assert.equal(rut.isValidRut("1234-5"), false);
  assert.equal(rut.isValidRut("12.345.678-5"), false); // debe venir normalizado
});

// ---------------------------------------------------------------- crypto / retry
await test("timingSafeEqual", () => {
  assert.equal(crypto.timingSafeEqual("abc", "abc"), true);
  assert.equal(crypto.timingSafeEqual("abc", "abd"), false);
  assert.equal(crypto.timingSafeEqual("abc", "abcd"), false);
  assert.equal(crypto.timingSafeEqual("", ""), true);
});
await test("backoff exponencial con tope", () => {
  assert.equal(retry.backoffSeconds(1), 30);
  assert.equal(retry.backoffSeconds(2), 60);
  assert.equal(retry.backoffSeconds(3), 120);
  assert.equal(retry.backoffSeconds(0), 30);
  assert.equal(retry.backoffSeconds(20), 3600);
});

// ---------------------------------------------------------------- validate
await test("validadores: uuid / string / rut / period", () => {
  assert.equal(validate.reqUuid("123E4567-E89B-42D3-A456-426614174000", "x"), "123e4567-e89b-42d3-a456-426614174000");
  assert.throws(() => validate.reqUuid("no-es-uuid", "x"), (e) => e.code === "INVALID_FIELD");
  assert.throws(() => validate.reqString("", "x", 1, 5), (e) => e.status === 400);
  assert.throws(() => validate.reqString("123456", "x", 1, 5), (e) => e.status === 400);
  assert.equal(validate.reqRut("12.345.678-5"), "12345678-5");
  assert.throws(() => validate.reqRut("12.345.678-9"), (e) => e.code === "INVALID_RUT");
  const now = new Date(Date.UTC(2026, 9, 10));
  assert.equal(validate.reqPeriod("202609", now), "202609");
  assert.equal(validate.reqPeriod("202610", now), "202610");
  assert.throws(() => validate.reqPeriod("202611", now), (e) => e.code === "INVALID_PERIOD");
  assert.throws(() => validate.reqPeriod("202613", now), (e) => e.code === "INVALID_FIELD");
  assert.throws(() => validate.reqPeriod(202609, now), (e) => e.code === "INVALID_FIELD");
});

// ---------------------------------------------------------------- http
await test("handle: OPTIONS responde 200 con CORS", async () => {
  const h = http.handle(async () => new Response("no debería llamarse"));
  const res = await h(new Request("https://x.test/f", { method: "OPTIONS" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});
await test("handle: HttpError se serializa sin filtrar nada más", async () => {
  const h = http.handle(async () => { throw new http.HttpError(403, "FORBIDDEN", "Permisos insuficientes"); });
  const res = await h(new Request("https://x.test/f", { method: "POST" }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: { code: "FORBIDDEN", message: "Permisos insuficientes" } });
});
await test("handle: error inesperado -> 500 genérico, sin el mensaje original", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const h = http.handle(async () => { throw new Error("clave=SECRETO123"); });
    const res = await h(new Request("https://x.test/f", { method: "POST" }));
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!text.includes("SECRETO123"));
    assert.ok(text.includes("INTERNAL"));
  } finally {
    console.error = origError;
  }
});
await test("handle: añade CORS a respuestas normales", async () => {
  const h = http.handle(async () => http.json({ ok: true }));
  const res = await h(new Request("https://x.test/f", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
await test("CORS: con ALLOWED_ORIGINS solo refleja orígenes permitidos", async () => {
  process.env.ALLOWED_ORIGINS = "https://app.aureon.cl, https://admin.aureon.cl";
  try {
    const ok = http.corsFor(new Request("https://x.test", { headers: { Origin: "https://app.aureon.cl" } }));
    assert.equal(ok["Access-Control-Allow-Origin"], "https://app.aureon.cl");
    const bad = http.corsFor(new Request("https://x.test", { headers: { Origin: "https://evil.test" } }));
    assert.equal(bad["Access-Control-Allow-Origin"], undefined);
  } finally {
    delete process.env.ALLOWED_ORIGINS;
  }
});
await test("readJson: valida método, tamaño y forma", async () => {
  await assert.rejects(http.readJson(new Request("https://x.test", { method: "GET" })), (e) => e.status === 405);
  await assert.rejects(
    http.readJson(new Request("https://x.test", { method: "POST", body: "no json" })),
    (e) => e.code === "INVALID_JSON",
  );
  await assert.rejects(
    http.readJson(new Request("https://x.test", { method: "POST", body: "[1,2]" })),
    (e) => e.code === "INVALID_JSON",
  );
  await assert.rejects(
    http.readJson(new Request("https://x.test", { method: "POST", body: JSON.stringify({ a: "x".repeat(200) }) }), 100),
    (e) => e.status === 413,
  );
  assert.deepEqual(
    await http.readJson(new Request("https://x.test", { method: "POST", body: '{"a":1}' })),
    { a: 1 },
  );
});

// ---------------------------------------------------------------- proveedor mock
const creds = { rut: "12345678-5", certB64: "Q0VSVA==", certPassword: "x" };

await test("mock: es determinista", async () => {
  const p = new mock.MockSiiProvider();
  const a = await p.fetchRcv(creds, "purchase", "202609");
  const b = await p.fetchRcv(creds, "purchase", "202609");
  assert.deepEqual(a, b);
  const c = await p.fetchRcv(creds, "purchase", "202608");
  assert.notDeepEqual(a, c);
  const d = await p.fetchRcv(creds, "sale", "202609");
  assert.notDeepEqual(a, d);
});
await test("mock: invariantes de cada fila", async () => {
  const p = new mock.MockSiiProvider();
  for (const kind of ["purchase", "sale"]) {
    for (const period of ["202601", "202602", "202609", "202612"]) {
      const rows = await p.fetchRcv(creds, kind, period);
      assert.ok(rows.length >= 1 && rows.length <= 26);
      const seen = new Set();
      for (const r of rows) {
        assert.ok(rut.isValidRut(r.counterparty_rut), `RUT inválido ${r.counterparty_rut}`);
        assert.equal(r.total_amount, r.net_amount + r.exempt_amount + r.vat_amount + r.other_taxes);
        assert.ok(Number.isInteger(r.net_amount) && Number.isInteger(r.vat_amount) && Number.isInteger(r.total_amount));
        assert.ok(r.folio > 0 && Number.isInteger(r.folio));
        assert.equal(r.doc_date.slice(0, 7), `${period.slice(0, 4)}-${period.slice(4, 6)}`);
        assert.equal(r.raw.mock, true);
        assert.ok(r.counterparty_name.endsWith("(MOCK)"));
        if (r.dte_type === 34) assert.equal(r.vat_amount, 0);
        const key = `${r.dte_type}|${r.folio}|${r.counterparty_rut}`;
        assert.ok(!seen.has(key), "fila duplicada");
        seen.add(key);
      }
    }
  }
});
await test("mock: febrero bisiesto y no bisiesto producen fechas válidas", async () => {
  const p = new mock.MockSiiProvider();
  for (const [period, last] of [["202402", 29], ["202502", 28]]) {
    const rows = await p.fetchRcv(creds, "purchase", period);
    for (const r of rows) assert.ok(Number(r.doc_date.slice(8, 10)) <= last, `${period} ${r.doc_date}`);
  }
});
await test("mock: credenciales incompletas -> INVALID_CREDENTIALS no reintentable", async () => {
  const p = new mock.MockSiiProvider();
  await assert.rejects(
    p.authenticate({ rut: "12345678-5", certB64: "", certPassword: "x" }),
    (e) => e instanceof types.SiiProviderError && e.code === "INVALID_CREDENTIALS" && e.retryable === false,
  );
});
await test("mock: fallo simulado configurable (para probar reintentos)", async () => {
  const p = new mock.MockSiiProvider({ failCode: "RATE_LIMIT" });
  await assert.rejects(p.authenticate(creds), (e) => e.code === "RATE_LIMIT" && e.retryable === true);
  const q = new mock.MockSiiProvider({ failCode: "FATAL", failRetryable: false });
  await assert.rejects(q.authenticate(creds), (e) => e.code === "FATAL" && e.retryable === false);
});
await test("proveedor oficial: no implementado y no reintentable", async () => {
  const p = new official.OfficialSiiProvider();
  assert.equal(p.isMock, false);
  await assert.rejects(p.authenticate(creds), (e) => e.code === "NOT_IMPLEMENTED" && e.retryable === false);
  await assert.rejects(p.fetchRcv(creds, "purchase", "202609"), (e) => e.code === "NOT_IMPLEMENTED");
});

console.log(`\n${passed} pruebas pasaron${process.exitCode ? " (HAY FALLAS)" : ""}`);
