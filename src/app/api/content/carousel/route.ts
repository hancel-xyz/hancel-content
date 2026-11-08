import JSZip from "jszip"
import { NextResponse } from "next/server"

import type { ContentPiece } from "@/engine/content/types"
import type { CarouselPayload } from "@/engine/render/carousel"
import { supabaseAdmin } from "@/engine/supabase-admin"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Descarga el carrusel entero como ZIP.
 *
 * Las imagenes ya estan en el storage y son publicas, pero bajarlas de una en
 * una y renombrarlas a mano para subirlas a Instagram es justo el trabajo que se
 * queria evitar. El ZIP las entrega numeradas y en orden.
 *
 * Se sirve desde la app y no como enlace al storage porque hay que empaquetar y,
 * de paso, poner un nombre util al archivo.
 *
 *   /api/content/carousel?piece=<uuid>
 */
export async function GET(request: Request) {
  const pieceId = new URL(request.url).searchParams.get("piece")
  if (!pieceId) {
    return NextResponse.json({ error: "Falta el id de la pieza." }, { status: 400 })
  }

  // Acotado a la cuenta abierta. La sesion ya la exige el proxy, pero el id de
  // una pieza es adivinable y sin este filtro cualquiera con sesion podria
  // descargar el carrusel de otra cuenta pasando su id a mano.
  const { idDeCuentaActual } = await import("@/lib/accounts")

  const { data, error } = await supabaseAdmin()
    .from("content_pieces")
    .select("*")
    .eq("id", pieceId)
    .eq("account_id", await idDeCuentaActual())
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "No existe esa pieza." }, { status: 404 })

  const piece = data as ContentPiece
  if (piece.network !== "instagram") {
    return NextResponse.json({ error: "Esa pieza no es un carrusel." }, { status: 400 })
  }

  const payload = piece.payload as unknown as CarouselPayload
  const imagenes = payload?.images ?? []
  if (imagenes.length === 0) {
    return NextResponse.json({ error: "El carrusel no tiene imagenes." }, { status: 404 })
  }

  const zip = new JSZip()

  // En paralelo: son diez descargas de un storage que ya las tiene servidas.
  const descargas = await Promise.all(
    imagenes.map(async (url, indice) => {
      const response = await fetch(url)
      if (!response.ok) return null
      return { indice, bytes: await response.arrayBuffer(), ext: /\.jpe?g(\?|$)/i.test(url) ? "jpg" : "png" }
    })
  )

  for (const descarga of descargas) {
    if (!descarga) continue
    // Numerado con cero delante para que el orden del carrusel sobreviva al
    // ordenar por nombre en cualquier explorador de archivos.
    zip.file(`${String(descarga.indice + 1).padStart(2, "0")}.${descarga.ext}`, descarga.bytes)
  }

  // El texto viaja con las imagenes: al publicar hace falta el pie, no solo las
  // fotos.
  const pie = [payload.caption, (payload.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n")
  if (pie) zip.file("caption.txt", pie)

  if ((payload.creditos ?? []).length > 0) {
    const creditos = payload.creditos
      .map((c) => `${c.autor}${c.url ? ` — ${c.url}` : ""}`)
      .join("\n")
    zip.file("creditos-fotos.txt", `Fotos de banco via Pexels\n\n${creditos}\n`)
  }

  const contenido = await zip.generateAsync({ type: "nodebuffer" })
  const nombre = `carrusel-${pieceId.slice(0, 8)}.zip`

  return new Response(new Uint8Array(contenido), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Content-Length": String(contenido.byteLength),
      "Cache-Control": "no-store",
    },
  })
}
