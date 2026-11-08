import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { AwsClient } from "aws4fetch"

/**
 * El cliente del motor: Supabase para la base y la autenticacion, y Cloudflare
 * R2 para los archivos (laminas, logos, fotos del portal, videos).
 *
 * Los archivos no van al storage de Supabase porque su salida de datos se paga
 * y se agota en el plan gratis: R2 no cobra la descarga. El codigo sigue
 * hablando el dialecto de supabase-js (`.storage.from(bucket).upload()`,
 * `getPublicUrl`, `list`, `remove`) y aqui se traduce a R2. El nombre del bucket
 * que pide el codigo se ignora: todo vive en un solo bucket de R2, con las
 * mismas rutas de antes.
 *
 * Usa la secret key (service role): solo en el servidor. No importa
 * "server-only" porque el motor tambien corre fuera de Next (`npm run ingest`).
 *
 * NUNCA importar este modulo desde un Client Component.
 */
let cached: SupabaseClient | null = null

function credenciales() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SECRET_KEY. Copia .env.example a .env.local.")
  }
  return { url, key }
}

type R2 = { aws: AwsClient; endpoint: string; publica: string }
let r2Cache: R2 | null = null

function r2(): R2 {
  if (r2Cache) return r2Cache
  const cuenta = process.env.R2_ACCOUNT_ID
  const id = process.env.R2_ACCESS_KEY_ID
  const secreto = process.env.R2_SECRET_ACCESS_KEY
  const publica = process.env.R2_PUBLIC_URL
  const bucket = process.env.R2_BUCKET ?? "hancel-media"
  if (!cuenta || !id || !secreto || !publica) {
    throw new Error("Faltan R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y/o R2_PUBLIC_URL.")
  }
  r2Cache = {
    aws: new AwsClient({ accessKeyId: id, secretAccessKey: secreto, service: "s3", region: "auto" }),
    endpoint: `https://${cuenta}.r2.cloudflarestorage.com/${bucket}`,
    publica: publica.replace(/\/$/, ""),
  }
  return r2Cache
}

/** La ruta de un objeto con cada tramo codificado, pero con sus "/". */
const rutaObjeto = (ruta: string) => ruta.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")

type Err = { message: string } | null
const fallo = (e: unknown): Err => ({ message: e instanceof Error ? e.message : String(e) })

/** La URL publica de un objeto de R2 (la que leen Meta, Canva y el portal). */
export function urlPublicaR2(ruta: string): string {
  return `${r2().publica}/${rutaObjeto(ruta)}`
}

function storageR2() {
  const de = {
    async upload(ruta: string, cuerpo: Buffer | Uint8Array | ArrayBuffer | Blob, opciones?: { contentType?: string; upsert?: boolean }): Promise<{ data: { path: string } | null; error: Err }> {
      try {
        const { aws, endpoint } = r2()
        const tipo = opciones?.contentType ?? "application/octet-stream"
        // Bytes planos y la longitud explicita. Pasarle a fetch el Request que
        // arma aws4fetch hacia que, dentro de Vercel, el cuerpo saliera como
        // flujo sin Content-Length y R2 lo rechazaba (411 MissingContentLength).
        const bytes: Uint8Array<ArrayBuffer> =
          cuerpo instanceof Blob
            ? new Uint8Array(await cuerpo.arrayBuffer())
            : cuerpo instanceof ArrayBuffer
              ? new Uint8Array(cuerpo)
              : Uint8Array.from(cuerpo)
        const firmado = await aws.sign(`${endpoint}/${rutaObjeto(ruta)}`, {
          method: "PUT",
          body: bytes,
          headers: {
            "Content-Type": tipo,
            "Cache-Control": "public, max-age=31536000",
            "Content-Length": String(bytes.byteLength),
          },
        })
        const r = await fetch(firmado.url, { method: "PUT", headers: firmado.headers, body: bytes, cache: "no-store" })
        if (!r.ok) return { data: null, error: { message: `R2 ${r.status}: ${(await r.text()).slice(0, 200)}` } }
        return { data: { path: ruta }, error: null }
      } catch (e) {
        return { data: null, error: fallo(e) }
      }
    },
    getPublicUrl(ruta: string) {
      return { data: { publicUrl: urlPublicaR2(ruta) } }
    },
    /** Los archivos que cuelgan directo de `prefijo` (no las subcarpetas). */
    async list(prefijo = "", opciones?: { limit?: number }): Promise<{ data: { name: string }[] | null; error: Err }> {
      try {
        const { aws, endpoint } = r2()
        const p = prefijo ? `${prefijo.replace(/^\/+|\/+$/g, "")}/` : ""
        const nombres: string[] = []
        let token: string | null = null
        do {
          const q = new URLSearchParams({ "list-type": "2", prefix: p, delimiter: "/", "max-keys": String(Math.min(opciones?.limit ?? 1000, 1000)) })
          if (token) q.set("continuation-token", token)
          const r = await aws.fetch(`${endpoint}?${q}`)
          const xml = await r.text()
          if (!r.ok) return { data: null, error: { message: `R2 ${r.status}: ${xml.slice(0, 200)}` } }
          for (const m of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g)) {
            nombres.push(desescapar(m[1]).slice(p.length))
          }
          token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null
        } while (token && nombres.length < (opciones?.limit ?? Infinity))
        return { data: nombres.filter(Boolean).map((name) => ({ name })), error: null }
      } catch (e) {
        return { data: null, error: fallo(e) }
      }
    },
    async remove(rutas: string[]): Promise<{ data: null; error: Err }> {
      try {
        const { aws, endpoint } = r2()
        const errores: string[] = []
        // DeleteObjects acepta hasta 1000 claves por pedido.
        for (let i = 0; i < rutas.length; i += 1000) {
          const tanda = rutas.slice(i, i + 1000)
          const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${tanda
            .map((k) => `<Object><Key>${escapar(k.replace(/^\/+/, ""))}</Key></Object>`)
            .join("")}</Delete>`
          const r = await aws.fetch(`${endpoint}?delete`, { method: "POST", body: xml, headers: { "Content-Type": "application/xml" } })
          if (!r.ok) errores.push(`R2 ${r.status}: ${(await r.text()).slice(0, 200)}`)
        }
        return { data: null, error: errores.length ? { message: errores.join("; ") } : null }
      } catch (e) {
        return { data: null, error: fallo(e) }
      }
    },
  }
  return { from: () => de }
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const { url, key } = credenciales()
  const cliente = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const storage = storageR2()
  // La base y auth.admin son los de Supabase; el storage, el de R2.
  cached = new Proxy(cliente, {
    get: (t, prop, recv) => (prop === "storage" ? storage : Reflect.get(t, prop, recv)),
  }) as SupabaseClient
  return cached
}
