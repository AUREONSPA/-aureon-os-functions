# AUREON OS · Bloque 3A — SII Connect (RCV) con proveedor mock

Conecta el certificado digital de una organización, encola sincronizaciones del RCV y las
procesa con un worker. El proveedor SII es una **interfaz**: hoy responde un **mock**; la
integración oficial se enchufa después sin tocar el resto.

## Qué incluye

| Pieza | Para qué |
|---|---|
| `aureon-os-db/06_rcv.sql` | Tabla `rcv_documents`, `rcv_upsert_batch`, `sii_finish_job`, recuperación de trabajos atascados |
| `aureon-os-db/96_smoke_test_rcv.sql` | Prueba funcional del SQL (se revierte sola) · esperado `TOTAL OK: 21` |
| `sii-connect` | Valida el .p12 y lo guarda en Vault (owner/admin) |
| `sii-disconnect` | Destruye el certificado en Vault (owner/admin) |
| `sii-sync` | Encola una sincronización con la identidad del usuario y despierta al worker |
| `sii-worker` | Procesa la cola: credenciales → proveedor → `rcv_documents` |
| `_shared/sii/` | Contrato `SiiProvider`, `MockSiiProvider`, `OfficialSiiProvider` (pendiente) |

## Regla de seguridad del mock

El mock **inventa datos tributarios**. Solo se permite para organizaciones con
`organizations.is_internal = true`. Para una organización real, el worker falla con
`MOCK_NOT_ALLOWED`: jamás verá datos ficticios como si vinieran del SII. Las filas
simuladas llevan `raw.mock = true` y el nombre termina en `(MOCK)`.

## Despliegue

1. **SQL** (en un branch o con respaldo): ejecuta `06_rcv.sql` y luego `96_smoke_test_rcv.sql`.
   Debe terminar con el error “PRUEBAS RCV” y `TOTAL OK: 21`, sin líneas `FALLA`.
2. **Funciones**: copia `supabase/functions/*` a tu repo y agrega `config.snippet.toml` a
   `supabase/config.toml`.
3. **Secretos** (`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen inyectados):
   ```bash
   supabase secrets set SII_PROVIDER=mock \
     SII_WORKER_SECRET="$(openssl rand -hex 32)" \
     ALLOWED_ORIGINS="https://tu-dominio.cl"
   ```
   Anota el valor de `SII_WORKER_SECRET`: lo necesitas en el paso 5.
4. **Deploy**:
   ```bash
   supabase functions deploy sii-connect sii-disconnect sii-sync sii-worker
   ```
5. **Worker programado** (Database > Extensions: habilita `pg_cron` y `pg_net`). Ejecútalo desde el
   SQL Editor y **no lo guardes como snippet** (contiene el secreto):
   ```sql
   select vault.create_secret('<VALOR_DE_SII_WORKER_SECRET>', 'sii_worker_secret');

   select cron.schedule('aureon_sii_worker', '* * * * *', $$
     select net.http_post(
       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sii-worker',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                                        where name = 'sii_worker_secret')),
       body    := '{}'::jsonb
     );
   $$);
   ```

## Prueba de punta a punta (con datos simulados)

1. Marca una organización de prueba como interna:
   `update public.organizations set is_internal = true where id = '<ORG_ID>';`
2. Genera un certificado de prueba (algoritmos compatibles con node-forge) y pásalo a base64:
   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 365 \
     -subj "/CN=PRUEBA AUREON/serialNumber=12345678-5"
   openssl pkcs12 -export -inkey k.pem -in c.pem -out prueba.p12 -passout pass:clave123 \
     -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
   base64 -w0 prueba.p12
   ```
3. Conecta (usa el JWT de un usuario owner/admin de esa organización):
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sii-connect" \
     -H "Authorization: Bearer <JWT_USUARIO>" -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
     -d '{"org_id":"<ORG_ID>","rut":"12345678-5","cert_b64":"<BASE64>","password":"clave123"}'
   ```
   Respuesta esperada: `connection_id`, `rut_detected_in_certificate: true`, `rut_verified: true`.
4. Sincroniza un período:
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sii-sync" \
     -H "Authorization: Bearer <JWT_USUARIO>" -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
     -d '{"connection_id":"<CONNECTION_ID>","period":"202609"}'
   ```
   Respuesta: `202` con `job_id`. En segundos: `select status, error_code from sii_sync_jobs order by created_at desc limit 3;`
   y `select kind, count(*) from rcv_documents group by 1;`
5. Reintentos: `supabase secrets set SII_MOCK_FAIL_CODE=RATE_LIMIT`, sincroniza de nuevo y observa
   `queued` con `run_after` creciente hasta agotar `max_attempts`. Quita el secreto al terminar:
   `supabase secrets unset SII_MOCK_FAIL_CODE`.
6. Control de seguridad: con una organización **no** interna, el trabajo debe terminar `failed`
   con `error_code = 'MOCK_NOT_ALLOWED'`.

## Pruebas locales (sin Deno ni Supabase)

```bash
tsc -p tests/tsconfig.typecheck.json          # tipos de todo el código (modo estricto)
tsc -p tests/tsconfig.build.json && node tests/unit.test.mjs   # 18 pruebas de lógica pura
```

## Qué NO está probado todavía

- Las Edge Functions no se han ejecutado en Deno/Supabase real: solo comprobación de tipos y
  pruebas unitarias de la lógica pura.
- `inspectP12` (node-forge) no se ha ejecutado. Soporta los cifrados PKCS#12 clásicos (3DES/RC2,
  MAC SHA-1); un .p12 con AES/MAC SHA-256 podría rechazarse. Pruébalo con un certificado real de tu
  CA antes de usarlo con clientes. La detección del RUT dentro del certificado es de mejor esfuerzo.
- La programación con `pg_cron` + `pg_net` y `EdgeRuntime.waitUntil` dependen del entorno.
- El proveedor oficial del SII **no existe aún**: antes hay que confirmar contra la documentación
  oficial qué servicios y formatos hay para RCV. No se han inventado endpoints.

## Seguridad

- Ningún secreto llega al navegador ni a los logs (solo códigos de error). El .p12 y su clave viven en Vault;
  cada lectura queda en `audit_log`.
- Solo `service_role` ejecuta las RPC de credenciales, RCV y cola; los clientes solo leen `rcv_documents`.
- `sii-worker` exige `x-worker-secret` (comparación en tiempo constante) y no acepta JWT de usuario.
- Define `ALLOWED_ORIGINS` en producción (sin él, CORS acepta cualquier origen).

## Pendiente (siguientes bloques)

- Componente React `<SiiConnect />` conectado a estas funciones (estados Desconectado / Conectado / Sincronizando).
- Proveedor oficial del SII, tras revisar su documentación y el proceso de certificación.
- Bloque 4: emisión de DTE (borrador → folio → firma → envío) con estas mismas piezas.
