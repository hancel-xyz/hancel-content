<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- INSFORGE:START -->
## Backend: Supabase + Cloudflare R2

- **Base de datos y autenticacion:** Supabase (proyecto `fmwnorumatylixgmoqzu`, plan gratis). El motor usa `supabaseAdmin()` (`src/engine/supabase-admin.ts`) con la secret key; la sesion del panel usa `@supabase/ssr` con la publishable key.
- **Archivos:** Cloudflare R2, bucket `hancel-media` (publico). El codigo sigue usando `supabaseAdmin().storage.from(...)`, que `supabase-admin.ts` traduce a R2. No usar el storage de Supabase: su salida de datos se agota en el plan gratis.
- **Tareas programadas:** pg_cron + pg_net en Supabase llaman a las rutas `/api/*/tick` con `INGEST_SECRET` (URL y secreto en Vault: `configure_content_tick`, `configure_ingest`).
- **Respaldo:** `.github/workflows/respaldo-diario.yml` guarda cada dia un `pg_dump` en el bucket privado `hancel-respaldos` (14 dias).
- **Credenciales:** en `.env.local` (nunca en git). Nunca escribirlas en el codigo.
