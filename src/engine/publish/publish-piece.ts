import type { ContentPiece } from "../content/types"
import { supabaseAdmin } from "../supabase-admin"
import { nichosConocidos } from "../render/carousel"
import { terminosDeBusqueda } from "../render/keywords"
import { BancoDeFotos, descargarFotoPexels, pexelsConfigurado } from "../render/pexels"
import { descargarFoto, renderTarjetaLinkedin } from "../render/render"
import { estiloDesdeConfig } from "../render/theme"
import type { RawNews } from "@/lib/types"
import { linkDeLaNota } from "../content/desde-portal"
import { publicarFacebook, publicarInstagram } from "./meta"
import { buildCommentary, publishText, subirImagen, type PublishResult } from "./linkedin"

/**
 * Publica una pieza y anota el resultado en su fila.
 *
 * La guarda contra publicar dos veces es `published_at`: se comprueba antes de
 * llamar a LinkedIn y se escribe justo despues. No es una transaccion, asi que
 * dos publicaciones simultaneas de la misma pieza podrian colarse; en la
 * practica solo hay dos disparadores (el boton y el tick) y el boton se
 * deshabilita al publicar.
 */
export async function publishPiece(pieceId: string): Promise<PublishResult> {
  const supabase = supabaseAdmin()

  // Reclamo atomico ANTES de publicar. El error anterior era un check-then-act:
  // se leia published_at, se veia null, se publicaba y despues se marcaba. Los
  // triggers disparan varios ticks casi a la vez, y todos veian null antes de
  // que ninguno escribiera, asi que la misma pieza salia a Buffer cuatro o
  // cinco veces. Aqui `published_at` se pone en el mismo UPDATE que comprueba
  // que estaba vacio: la base garantiza que solo una pasada gana la fila.
  const marca = new Date().toISOString()
  const { data: reclamada, error: errorReclamo } = await supabase
    .from("content_pieces")
    .update({ status: "publishing", published_at: marca })
    .eq("id", pieceId)
    .is("published_at", null)
    .neq("status", "rejected")
    .select("*")
    .maybeSingle()

  // El error del UPDATE no se puede tragar: si la base rechaza el reclamo (un
  // CHECK que no admite 'publishing', un trigger que falla) y se ignora, cada
  // pasada lo confunde con "otra se adelanto" y la pieza no sale nunca, sin
  // dejar rastro del motivo. Justo eso paro la publicacion entera una vez.
  if (errorReclamo) {
    return { ok: false, error: `No se pudo reclamar la pieza para publicar: ${errorReclamo.message}` }
  }

  if (!reclamada) {
    // O ya se publico, o esta rechazada, o otra pasada la tomo en esta misma
    // rafaga. En los tres casos no hay nada que hacer aqui.
    return { ok: false, error: "La pieza ya se publico o la tomo otra pasada." }
  }

  const piece = reclamada as ContentPiece & { published_at: string | null; linkedin_urn: string | null }

  // Cada red se publica por su via: LinkedIn contra su propia API; Instagram y
  // Facebook con las conexiones de Composio de la empresa.
  const result =
    piece.network === "instagram"
      ? await publicarCarrusel(piece)
      : piece.network === "facebook"
        ? await publicarEnFacebook(piece)
        : await publicarEnLinkedin(piece)

  if (result.ok) {
    await supabase
      .from("content_pieces")
      .update({
        status: "published",
        published_at: marca,
        // La columna guarda el identificador del post publicado, sea de la red
        // que sea: el URN de LinkedIn o el id que devuelve Buffer.
        linkedin_urn: result.urn,
        // Queda anotado que el post salio ilustrado, que es la unica forma de
        // comprobarlo despues sin abrir el feed.
        ...(result.imageUrn ? { image_urn: result.imageUrn } : {}),
        publish_error: null,
      })
      .eq("id", pieceId)
  } else {
    // La publicacion fallo, asi que se suelta el reclamo: published_at vuelve a
    // null para que un reintento pueda tomarla, y el error queda a la vista.
    await supabase
      .from("content_pieces")
      .update({
        status: "generated",
        published_at: null,
        publish_error: result.error.slice(0, 1000),
      })
      .eq("id", pieceId)
  }

  return result
}

/**
 * Un carrusel es una sola publicacion que sale a dos redes.
 *
 * Instagram y Facebook guardan cada uno su pieza, pero las dos salen del mismo
 * guion (mismo `job_instagram_id`). Antes cada red tenia su cola y avanzaba por
 * su cuenta: bastaba con que una pieza faltara o fallara en una red para que la
 * otra se corriera un puesto, y a la misma hora salia un carrusel en Instagram
 * y otro distinto en Facebook. Ahora se publica la pieza y, en cuanto sale, sus
 * hermanas de las otras redes del carrusel, en la misma pasada.
 *
 * Si la primera falla no sale ninguna: se reintentan juntas en la siguiente.
 */
export async function publicarConHermanas(
  pieceId: string
): Promise<{ pieceId: string; network: string; result: PublishResult }[]> {
  const supabase = supabaseAdmin()
  const { data: fila } = await supabase
    .from("content_pieces")
    .select("network, job_instagram_id")
    .eq("id", pieceId)
    .maybeSingle()

  const salida = [{ pieceId, network: String(fila?.network ?? ""), result: await publishPiece(pieceId) }]
  if (!salida[0].result.ok || !fila?.job_instagram_id || !REDES_CARRUSEL.includes(fila.network)) {
    return salida
  }

  for (const hermana of await hermanasPendientes(fila.job_instagram_id, fila.network)) {
    salida.push({ pieceId: hermana.id, network: hermana.network, result: await publishPiece(hermana.id) })
  }
  return salida
}

export const REDES_CARRUSEL = ["instagram", "facebook"]

async function hermanasPendientes(job: string, salvo: string): Promise<{ id: string; network: string }[]> {
  const { data } = await supabaseAdmin()
    .from("content_pieces")
    .select("id, network")
    .eq("job_instagram_id", job)
    .in("network", REDES_CARRUSEL.filter((r) => r !== salvo))
    .in("status", ["generated", "approved"])
    .is("published_at", null)
  return (data ?? []) as { id: string; network: string }[]
}

/**
 * Piezas de carrusel que se quedaron atras: su hermana ya salio pero ella no
 * (fallo Facebook en el momento, por ejemplo). Se publican en la siguiente
 * tanda, antes que nada, para que el desfase dure minutos y no se acumule.
 */
export async function hermanasAtrasadas(accountId: string): Promise<string[]> {
  const supabase = supabaseAdmin()
  const { data: pendientes } = await supabase
    .from("content_pieces")
    .select("id, job_instagram_id")
    .eq("account_id", accountId)
    .in("network", REDES_CARRUSEL)
    .in("status", ["generated", "approved"])
    .is("published_at", null)
    .not("job_instagram_id", "is", null)
  const lista = (pendientes ?? []) as { id: string; job_instagram_id: string }[]
  if (lista.length === 0) return []

  const { data: salidas } = await supabase
    .from("content_pieces")
    .select("job_instagram_id")
    .in("job_instagram_id", [...new Set(lista.map((p) => p.job_instagram_id))])
    .eq("status", "published")
  const publicados = new Set(((salidas ?? []) as { job_instagram_id: string }[]).map((s) => s.job_instagram_id))
  return lista.filter((p) => publicados.has(p.job_instagram_id)).map((p) => p.id)
}

/**
 * LinkedIn: texto mas la tarjeta con el titular.
 *
 * La imagen no es opcional. Antes, si algo fallaba al dibujarla o subirla, el
 * post salia igual solo con texto; el problema es que eso no tiene arreglo
 * despues —habria que borrar el post y volver a publicarlo— y encima no dejaba
 * rastro de por que. Ahora, si no hay imagen, no hay post: la pieza se queda sin
 * publicar con el motivo escrito, y la siguiente tanda lo reintenta. Un fallo
 * pasajero se cura solo y uno de verdad se ve en la interfaz.
 */
async function publicarEnLinkedin(piece: ContentPiece): Promise<PublishResult> {
  const commentary = buildCommentary(piece.payload)
  if (!commentary.trim()) {
    return { ok: false, error: "La pieza no tiene texto que publicar." }
  }

  const tarjeta = await tarjetaDelPost(piece, commentary)
  if (!tarjeta.ok) {
    return { ok: false, error: `No se pudo preparar la imagen del post: ${tarjeta.error}` }
  }

  const resultado = await publishText(piece.account_id, commentary, tarjeta.imagen)
  return resultado.ok ? { ...resultado, imageUrn: tarjeta.imagen.urn } : resultado
}

/**
 * Instagram: el carrusel entero, con la conexion de Instagram de la empresa.
 * Las imagenes ya viven en URLs publicas del storage.
 */
async function publicarCarrusel(piece: ContentPiece): Promise<PublishResult> {
  const payload = piece.payload as unknown as {
    caption?: string
    hashtags?: string[]
    images?: string[]
  }

  const imagenes = payload?.images ?? []
  if (imagenes.length === 0) {
    return { ok: false, error: "El carrusel no tiene imagenes." }
  }

  // Instagram no deja links que se puedan tocar en el texto: se manda a la bio,
  // que apunta al portal. Solo si la noticia tiene nota publicada.
  const nota = await linkDeLaNota(piece.raw_news_id)
  const texto = [payload.caption, nota ? "Lee la nota completa en el link de la bio." : null, (payload.hashtags ?? []).join(" ")]
    .filter((parte): parte is string => !!parte && parte.trim().length > 0)
    .join("\n\n")

  const resultado = await publicarInstagram(piece.account_id, { texto, imagenes })
  return resultado.ok ? { ok: true, urn: resultado.postId } : { ok: false, error: resultado.error }
}

/**
 * Facebook: la portada del carrusel y el texto largo, en la pagina de la
 * empresa. La pieza ya nacio con la forma de Facebook (ver
 * `render/facebook.ts`): aqui solo se junta el texto como lo haria LinkedIn.
 */
async function publicarEnFacebook(piece: ContentPiece): Promise<PublishResult> {
  const imagen = piece.payload?.image
  if (!imagen) {
    return { ok: false, error: "La pieza de Facebook no tiene imagen." }
  }

  const cuerpo = buildCommentary(piece.payload)
  if (!cuerpo.trim()) {
    return { ok: false, error: "La pieza no tiene texto que publicar." }
  }
  // El link directo a la nota del portal: en Facebook si se puede tocar.
  const nota = await linkDeLaNota(piece.raw_news_id)
  const texto = nota ? `${cuerpo}\n\nLee la nota completa: ${nota}` : cuerpo

  const resultado = await publicarFacebook(piece.account_id, { texto, imagenes: [imagen] })
  return resultado.ok ? { ok: true, urn: resultado.postId } : { ok: false, error: resultado.error }
}

/**
 * Las piezas que una tanda publicaria: generadas o aprobadas, sin publicar.
 *
 * Por orden de creacion, que es el orden en que se generaron: si una tanda no da
 * para todas, las mas viejas salen primero.
 */
export async function pendingToPublish(
  accountId: string,
  network: string,
  limite = 5
): Promise<ContentPiece[]> {
  const supabase = supabaseAdmin()

  // Suelta las que se quedaron en 'publishing': una pieza se reclama antes de
  // publicar, y si el proceso muere en esa ventana de segundos quedaria colgada
  // sin salir y sin que nadie la reintente. Cinco minutos es mucho mas de lo
  // que tarda publicar, asi que a esas alturas es un reclamo huerfano.
  await supabase
    .from("content_pieces")
    .update({ status: "generated", published_at: null })
    .eq("account_id", accountId)
    .eq("network", network)
    .eq("status", "publishing")
    .lt("published_at", new Date(Date.now() - 5 * 60_000).toISOString())

  const { data, error } = await supabase
    .from("content_pieces")
    .select("*")
    .eq("account_id", accountId)
    .eq("network", network)
    .in("status", ["generated", "approved"])
    .is("published_at", null)
    .order("created_at")
    .limit(limite)

  if (error) throw new Error(`No se pudieron leer las piezas por publicar: ${error.message}`)
  return (data ?? []) as ContentPiece[]
}

/**
 * La imagen que acompaña al post.
 *
 * Va siempre, no como adorno: un post con imagen ocupa el doble de alto en el
 * feed que uno de solo texto, y es lo que decide si alguien se para a leerlo. El
 * tratamiento es el mismo que la portada del carrusel —foto a color, degradado y
 * titular abajo— para que las dos redes se reconozcan como la misma cuenta.
 *
 * La foto alterna entre la de la noticia y la del banco: tirar siempre de la
 * misma fuente hace que todos los posts se parezcan, y son dos imaginarios
 * distintos —el documental del medio y el mas abstracto del banco— que conviene
 * ir mezclando. Cada una hace de respaldo de la otra, asi que basta con que
 * responda una de las dos.
 *
 * La foto de fondo si es opcional —sin ella la tarjeta sale sobre el fondo
 * solido de la paleta, que sigue siendo una tarjeta— pero la tarjeta no lo es:
 * cualquier fallo vuelve con su motivo para que quien publica decida, en vez de
 * dejar salir un post pelado sin que nadie se entere.
 */
type TarjetaResult =
  | { ok: true; imagen: { urn: string; altText: string } }
  | { ok: false; error: string }

async function tarjetaDelPost(
  piece: ContentPiece,
  commentary: string
): Promise<TarjetaResult> {
  try {
    const supabase = supabaseAdmin()

    const { data: cfg } = await supabase
      .from("generation_config")
      .select("carousel")
      .eq("account_id", piece.account_id)
      .maybeSingle()

    const estilo = estiloDesdeConfig((cfg as { carousel?: unknown } | null)?.carousel)

    const news = piece.raw_news_id
      ? ((
          await supabase.from("raw_news").select("*").eq("id", piece.raw_news_id).maybeSingle()
        ).data as RawNews | null)
      : null

    // Apaisada: la tarjeta es 1200x627 y una foto vertical recortada ahi pierde
    // justo la cabeza del sujeto.
    const delBanco = async (): Promise<string | null> => {
      if (!estilo.usarFotos || !pexelsConfigurado()) return null
      const banco = new BancoDeFotos(
        terminosDeBusqueda(news, await nichosConocidos(piece.account_id), estilo.fotosLiterales),
        "apaisada"
      )
      const elegida = await banco.siguiente()
      return elegida ? descargarFotoPexels(elegida) : null
    }

    const empezarPorLaNoticia = Math.random() < 0.5
    const foto = empezarPorLaNoticia
      ? ((await descargarFoto(news?.image_url)) ?? (await delBanco()))
      : ((await delBanco()) ?? (await descargarFoto(news?.image_url)))

    // El titular es el hook si lo hay; si no, la primera frase del cuerpo, que
    // es donde la gramatica de LinkedIn pone el gancho.
    const titular =
      piece.payload?.hook?.trim() ||
      commentary
        .split("\n")
        .find((linea) => linea.trim().length > 0)
        ?.trim() ||
      ""

    if (!titular) {
      return { ok: false, error: "La pieza no tiene titular con el que armar la tarjeta." }
    }

    const etiqueta = (news?.tema ?? news?.niche ?? "").trim() || null
    const png = await renderTarjetaLinkedin(titular, foto, estilo, etiqueta)

    const subida = await subirImagen(piece.account_id, png)
    if (!subida.ok) return { ok: false, error: subida.error }

    return { ok: true, imagen: { urn: subida.urn, altText: titular } }
  } catch (error) {
    // Aqui caen sobre todo los fallos de dibujo: una fuente que no esta donde se
    // espera, o un texto que Satori no sabe medir.
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `No se pudo dibujar la tarjeta: ${message}` }
  }
}
