import { urlPublicaR2 } from "@/engine/supabase-admin"

/**
 * Los archivos publicos, servidos desde la app.
 *
 * Hoy viven en Cloudflare R2 y se enlazan directo con su URL publica. Esta ruta
 * queda para los enlaces viejos con /api/archivo/... (los de la epoca de
 * InsForge): responde directo (200) con el tipo correcto, que es lo que Canva
 * necesita para importar el HTML de una pieza.
 */
const TIPOS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  html: "text/html; charset=utf-8",
}

export async function GET(_req: Request, { params }: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await params
  const clave = ruta.map((t) => decodeURIComponent(t)).join("/")
  if (!clave || clave.includes("..")) return new Response("No encontrado", { status: 404 })
  const r = await fetch(urlPublicaR2(clave), { cache: "no-store" })
  if (!r.ok || !r.body) return new Response("No encontrado", { status: 404 })

  const ext = /\.([a-z0-9]+)$/i.exec(clave)?.[1]?.toLowerCase() ?? ""
  // El HTML solo como pagina dentro de studio/ (lo importa Canva); en otro lado, como descarga.
  const tipoExt = ext === "html" && !clave.startsWith("studio/") ? undefined : TIPOS[ext]
  const tipoOrigen = r.headers.get("content-type")
  const tipo = tipoExt ?? (tipoOrigen && !tipoOrigen.startsWith("application/octet-stream") ? tipoOrigen : "application/octet-stream")

  return new Response(r.body, {
    headers: {
      "Content-Type": tipo,
      ...(r.headers.get("content-length") ? { "Content-Length": r.headers.get("content-length")! } : {}),
      // Las URLs llevan ?v=<version>: un archivo nuevo es otra URL.
      "Cache-Control": "public, max-age=86400, s-maxage=31536000",
    },
  })
}
