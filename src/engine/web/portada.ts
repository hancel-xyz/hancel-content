import { supabaseAdmin } from "../supabase-admin"
import { conexionWeb } from "./webhook"

/**
 * La portada del carrusel para la pagina de enlaces del portal (la del link de
 * la bio): una cuadricula de portadas que lleva cada una a su nota.
 *
 * Al publicarse el carrusel en Instagram se toma la portada (la misma lamina
 * que va a Facebook, sin numeracion), se comprime y se deja en R2 fuera de la
 * carpeta del carrusel, porque esa se borra en cuanto el carrusel salio. La
 * redaccion queda con la portada 'pendiente' y `procesarWeb` la envia al
 * portal (`noticia.portada`) con los mismos reintentos que las notas.
 */

/** En la cuadricula cada portada mide unos 200 px de ancho; esto es el doble para pantallas densas. */
export const PORTADA_ANCHO = 480
export const PORTADA_ALTO = 600
const CALIDAD = 74

export async function prepararPortadaWeb(pieceId: string): Promise<void> {
  const supabase = supabaseAdmin()
  const { data: pieza } = await supabase
    .from("content_pieces")
    .select("account_id, raw_news_id, network, payload")
    .eq("id", pieceId)
    .maybeSingle()
  const p = pieza as { account_id: string; raw_news_id: string | null; network: string; payload: Record<string, unknown> | null } | null
  if (!p?.raw_news_id || p.network !== "instagram") return
  if (!(await conexionWeb(p.account_id))) return

  const { data: red } = await supabase
    .from("news_redacciones")
    .select("id, portada_status")
    .eq("account_id", p.account_id)
    .eq("raw_news_id", p.raw_news_id)
    .eq("status", "redactada")
    .gt("web_version", 0)
    .maybeSingle()
  const redaccion = red as { id: string; portada_status: string | null } | null
  if (!redaccion || redaccion.portada_status) return

  const imagenes = Array.isArray(p.payload?.images) ? (p.payload.images as string[]) : []
  const origen = (typeof p.payload?.portadaFacebook === "string" ? p.payload.portadaFacebook : null) ?? imagenes[0]
  if (!origen) return

  const res = await fetch(origen, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`No se pudo bajar la portada: HTTP ${res.status}`)
  const sharp = (await import("sharp")).default
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(PORTADA_ANCHO, PORTADA_ALTO, { fit: "cover", position: "top" })
    .webp({ quality: CALIDAD, effort: 6, smartSubsample: true })
    .toBuffer()

  const ruta = `portal/${p.raw_news_id}.webp`
  const { error } = await supabase.storage
    .from("carousels")
    .upload(ruta, webp, { contentType: "image/webp", upsert: true })
  if (error) throw new Error(`No se pudo subir la portada: ${error.message}`)

  await supabase
    .from("news_redacciones")
    .update({
      portada_url: supabase.storage.from("carousels").getPublicUrl(ruta).data.publicUrl,
      portada_publicada_at: new Date().toISOString(),
      portada_status: "pendiente",
      portada_intentos: 0,
      portada_error: null,
      portada_proximo_at: null,
    })
    .eq("id", redaccion.id)
}
