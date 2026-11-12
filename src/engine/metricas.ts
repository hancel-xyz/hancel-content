import { ejecutar } from "./composio/conexiones"
import { cuentaInstagram } from "./publish/meta"
import { getSettings } from "./schedule"
import { secretosDe } from "./secretos"
import { supabaseAdmin } from "./supabase-admin"

/**
 * Metricas de lo que Hancel publica en Instagram y Facebook.
 *
 * Se lee la red, no Hancel: se listan los posts de los ultimos `VENTANA_DIAS`
 * con sus metricas en la misma llamada (expansion de campos de la Graph API,
 * unas pocas llamadas por cuenta en vez de una por post) y se quedan los que
 * salieron de Hancel. Un post es de Hancel si su id es el que guardo la pieza
 * al publicarse o, para los que salieron por Buffer y no tienen el id de Meta,
 * si su texto empieza igual que el de una pieza publicada.
 *
 * Meta da totales de por vida: cada pasada sobrescribe la fila del post.
 * Recorrer los 60 dias tarda unos cuatro minutos (la Graph API calcula las
 * metricas de cada post al vuelo), asi que cada hora se refrescan solo los
 * ultimos `VENTANA_CORTA` dias, que es cuando las cifras se mueven, y una vez al
 * dia los 60. Pasados los 60 dias el post conserva sus ultimas cifras.
 *
 * Facebook ya no da clics ni alcance por post (Meta los retiro en noviembre de
 * 2025): de un post de Facebook hay vistas, espectadores unicos (que se guarda
 * como alcance), reacciones, comentarios y compartidos. El comentario con el
 * link que pone la propia pagina no cuenta como comentario.
 *
 * No lanza: los fallos viajan en el resumen.
 */

const VENTANA_DIAS = 60
export const VENTANA_CORTA = 10
/** Los dias de metricas de cuenta que se vuelven a pedir: Meta los consolida con retraso. */
const DIAS_CUENTA = 28
const LARGO_HUELLA = 50

export type ResumenMetricas = { instagram: number; facebook: number; dias: number; errores: string[] }

type Fila = {
  account_id: string
  red: "instagram" | "facebook"
  post_id: string
  origen: "noticia" | "estudio" | "precios"
  pieza_id: string | null
  texto: string | null
  enlace: string | null
  imagen: string | null
  tipo: string | null
  publicado_at: string
  vistas: number | null
  alcance: number | null
  me_gusta: number | null
  comentarios: number | null
  guardados: number | null
  compartidos: number | null
  interacciones: number | null
  actualizado_at: string
}

type Origen = { origen: "noticia" | "estudio" | "precios"; pieza_id: string }

function huella(texto: string | null | undefined): string | null {
  const h = (texto ?? "").toLowerCase().replace(/\s+/g, " ").trim()
  return h.length >= 20 ? h.slice(0, LARGO_HUELLA) : null
}

/** Lo publicado desde Hancel: por id de Meta y por el comienzo de su texto. */
async function publicadoDesdeHancel(accountId: string) {
  const supabase = supabaseAdmin()
  const desde = new Date(Date.now() - (VENTANA_DIAS + 7) * 86_400_000).toISOString()
  const [piezas, estudio, pubs, precios] = await Promise.all([
    supabase.from("content_pieces").select("id, network, linkedin_urn, payload").eq("account_id", accountId).eq("status", "published").gte("published_at", desde),
    supabase.from("studio_pieces").select("id, payload").eq("account_id", accountId).eq("status", "published").gte("published_at", desde),
    supabase.from("studio_publications").select("piece_id, buffer_post_id").eq("account_id", accountId).eq("status", "published").gte("created_at", desde),
    supabase.from("precios_carruseles").select("id, instagram_id, facebook_id").eq("account_id", accountId).gte("created_at", desde),
  ])
  const porId = new Map<string, Origen>()
  const porTexto = new Map<string, Origen>()
  for (const p of (piezas.data ?? []) as { id: string; network: string; linkedin_urn: string | null; payload: Record<string, unknown> | null }[]) {
    const o: Origen = { origen: "noticia", pieza_id: p.id }
    if (p.linkedin_urn) porId.set(p.linkedin_urn, o)
    const h = huella(String((p.network === "facebook" ? p.payload?.hook : p.payload?.caption) ?? ""))
    if (h) porTexto.set(h, o)
  }
  for (const p of (estudio.data ?? []) as { id: string; payload: Record<string, unknown> | null }[]) {
    const h = huella(String(p.payload?.caption ?? ""))
    if (h) porTexto.set(h, { origen: "estudio", pieza_id: p.id })
  }
  for (const p of (pubs.data ?? []) as { piece_id: string; buffer_post_id: string | null }[]) {
    if (p.buffer_post_id) porId.set(p.buffer_post_id, { origen: "estudio", pieza_id: p.piece_id })
  }
  for (const p of (precios.data ?? []) as { id: string; instagram_id: string | null; facebook_id: string | null }[]) {
    if (p.instagram_id) porId.set(p.instagram_id, { origen: "precios", pieza_id: p.id })
    if (p.facebook_id) porId.set(p.facebook_id, { origen: "precios", pieza_id: p.id })
  }
  return (id: string, texto: string | null | undefined): Origen | null => {
    const h = huella(texto)
    return porId.get(id) ?? (h ? porTexto.get(h) ?? null : null)
  }
}

type Insight = { name: string; values?: { value: number }[] }

function valores(insights: { data?: Insight[] } | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of insights?.data ?? []) {
    const v = i.values?.[0]?.value
    if (typeof v === "number" && !(i.name in out)) out[i.name] = v
  }
  return out
}

function primeraLinea(texto: string | null | undefined): string | null {
  const t = (texto ?? "").split("\n").find((l) => l.trim())?.trim()
  return t ? t.slice(0, 200) : null
}

// ------------------------------------------------------------- instagram

type MediaIG = {
  id: string
  caption?: string
  timestamp?: string
  permalink?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  insights?: { data?: Insight[] }
}

async function postsInstagram(accountId: string, origenDe: Awaited<ReturnType<typeof publicadoDesdeHancel>>, dias: number): Promise<Fila[]> {
  const cuenta = await cuentaInstagram(accountId)
  if (!cuenta.ok) throw new Error(`Instagram: ${cuenta.error}`)
  const desde = Math.floor((Date.now() - dias * 86_400_000) / 1000)
  const campos =
    "id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,insights.metric(views,reach,likes,comments,saved,shares,total_interactions)"
  const filas: Fila[] = []
  let after: string | undefined
  for (let pagina = 0; pagina < 20; pagina++) {
    const r = await ejecutar<{ data?: MediaIG[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      accountId,
      "instagram",
      "INSTAGRAM_GET_IG_USER_MEDIA",
      { ig_user_id: cuenta.id, limit: 50, since: desde, fields: campos, ...(after ? { after } : {}) },
      90_000
    )
    if (!r.ok) throw new Error(`Instagram: ${r.error}`)
    const lista = r.data.data ?? []
    for (const m of lista) {
      const origen = origenDe(m.id, m.caption)
      if (!origen || !m.timestamp) continue
      const v = valores(m.insights)
      filas.push({
        account_id: accountId,
        red: "instagram",
        post_id: m.id,
        ...origen,
        texto: primeraLinea(m.caption),
        enlace: m.permalink ?? null,
        imagen: m.thumbnail_url ?? m.media_url ?? null,
        tipo: m.media_type ?? null,
        publicado_at: new Date(m.timestamp).toISOString(),
        vistas: v.views ?? null,
        alcance: v.reach ?? null,
        me_gusta: v.likes ?? null,
        comentarios: v.comments ?? null,
        guardados: v.saved ?? null,
        compartidos: v.shares ?? null,
        interacciones: v.total_interactions ?? null,
        actualizado_at: new Date().toISOString(),
      })
    }
    after = r.data.paging?.cursors?.after
    if (!after || !r.data.paging?.next || lista.length === 0) break
  }
  return filas
}

// -------------------------------------------------------------- facebook

type PostFB = {
  id: string
  message?: string
  created_time?: string
  permalink_url?: string
  full_picture?: string
  shares?: { count?: number }
  reactions?: { summary?: { total_count?: number } }
  comments?: { data?: { from?: { id?: string } }[]; summary?: { total_count?: number } }
  insights?: { data?: Insight[] }
}

async function postsFacebook(accountId: string, origenDe: Awaited<ReturnType<typeof publicadoDesdeHancel>>, dias: number): Promise<Fila[]> {
  const pagina = (await secretosDe(accountId)).facebook_page_id
  if (!pagina) throw new Error("Facebook: la empresa no eligió página.")
  const desde = Math.floor((Date.now() - dias * 86_400_000) / 1000)
  const campos =
    "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(25){from{id}},insights.metric(post_media_view,post_total_media_view_unique)"
  const filas: Fila[] = []
  const vistos = new Set<string>()
  // Sin cursor en Composio: se pagina hacia atras moviendo `until` al post mas viejo.
  let hasta: number | undefined
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    const r = await ejecutar<{ data?: PostFB[] }>(
      accountId,
      "facebook",
      "FACEBOOK_GET_PAGE_POSTS",
      { page_id: pagina, limit: 50, since: String(desde), fields: campos, ...(hasta ? { until: String(hasta) } : {}) },
      90_000
    )
    if (!r.ok) throw new Error(`Facebook: ${r.error}`)
    const lista = (r.data.data ?? []).filter((p) => !vistos.has(p.id))
    for (const p of lista) {
      vistos.add(p.id)
      const origen = origenDe(p.id, p.message)
      if (!origen || !p.created_time) continue
      const v = valores(p.insights)
      // El comentario con el link lo pone la pagina: no es una interaccion.
      const propios = (p.comments?.data ?? []).filter((c) => c.from?.id === pagina).length
      const comentarios = Math.max(0, (p.comments?.summary?.total_count ?? 0) - propios)
      const reacciones = p.reactions?.summary?.total_count ?? 0
      const compartidos = p.shares?.count ?? 0
      filas.push({
        account_id: accountId,
        red: "facebook",
        post_id: p.id,
        ...origen,
        texto: primeraLinea(p.message),
        enlace: p.permalink_url ?? null,
        imagen: p.full_picture ?? null,
        tipo: null,
        publicado_at: new Date(p.created_time).toISOString(),
        vistas: v.post_media_view ?? null,
        alcance: v.post_total_media_view_unique ?? null,
        me_gusta: reacciones,
        comentarios,
        guardados: null,
        compartidos,
        interacciones: reacciones + comentarios + compartidos,
        actualizado_at: new Date().toISOString(),
      })
    }
    const masViejo = Math.min(...lista.map((p) => Date.parse(p.created_time ?? "")).filter(Number.isFinite))
    if (lista.length < 40 || !Number.isFinite(masViejo)) break
    hasta = Math.floor(masViejo / 1000)
  }
  return filas
}

// ----------------------------------------------------- metricas de cuenta

/** Desfase de la zona horaria respecto a UTC en ese instante, en ms. */
function desfase(timezone: string, fecha: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value])
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - fecha.getTime()
}

/** Toques al link de la bio, visitas al perfil y alcance de Instagram, dia por dia (hora local). */
async function diasInstagram(accountId: string): Promise<number> {
  const supabase = supabaseAdmin()
  const { timezone } = await getSettings(accountId)
  const { data: guardados } = await supabase
    .from("cuenta_metricas_dia")
    .select("dia")
    .eq("account_id", accountId)
    .eq("red", "instagram")
  const tengo = new Set(((guardados ?? []) as { dia: string }[]).map((d) => d.dia))

  const ahora = new Date()
  const hoyLocal = new Date(ahora.getTime() + desfase(timezone, ahora))
  let hechos = 0
  for (let atras = 0; atras < DIAS_CUENTA; atras++) {
    const d = new Date(Date.UTC(hoyLocal.getUTCFullYear(), hoyLocal.getUTCMonth(), hoyLocal.getUTCDate() - atras))
    const dia = d.toISOString().slice(0, 10)
    // Hoy y los dos dias anteriores siempre: Meta los sigue ajustando.
    if (atras > 2 && tengo.has(dia)) continue
    const inicio = d.getTime() - desfase(timezone, d)
    const fin = Math.min(inicio + 86_400_000, ahora.getTime())
    const r = await ejecutar<{ data?: { name: string; total_value?: { value?: number } }[] }>(
      accountId,
      "instagram",
      "INSTAGRAM_GET_USER_INSIGHTS",
      {
        ig_user_id: "me",
        metric: ["website_clicks", "profile_views", "reach"],
        period: "day",
        metric_type: "total_value",
        since: Math.floor(inicio / 1000),
        until: Math.floor(fin / 1000),
      },
      60_000
    )
    if (!r.ok) throw new Error(`Instagram (cuenta): ${r.error}`)
    const v: Record<string, number> = {}
    for (const m of r.data.data ?? []) if (typeof m.total_value?.value === "number") v[m.name] = m.total_value.value
    await supabase.from("cuenta_metricas_dia").upsert(
      {
        account_id: accountId,
        red: "instagram",
        dia,
        toques_link: v.website_clicks ?? null,
        visitas_perfil: v.profile_views ?? null,
        alcance: v.reach ?? null,
        actualizado_at: new Date().toISOString(),
      },
      { onConflict: "account_id,red,dia" }
    )
    hechos++
  }
  return hechos
}

/**
 * Facebook por dia: clics en el boton y los datos de contacto de la pagina
 * (`page_total_actions`, lo unico parecido a "toques al enlace" que da Meta; el
 * link del primer comentario no se puede medir) y las vistas de toda la pagina.
 * Una sola llamada para los 28 dias. Meta corta los dias a medianoche del
 * Pacifico: el valor con `end_time` del dia 9 es el del dia 8.
 */
async function diasFacebook(accountId: string): Promise<number> {
  const pagina = (await secretosDe(accountId)).facebook_page_id
  if (!pagina) return 0
  const r = await ejecutar<{ data?: { name: string; values?: { end_time?: string; value?: number }[] }[] }>(
    accountId,
    "facebook",
    "FACEBOOK_GET_PAGE_INSIGHTS",
    {
      page_id: pagina,
      metrics: "page_total_actions,page_media_view",
      period: "day",
      since: String(Math.floor((Date.now() - DIAS_CUENTA * 86_400_000) / 1000)),
      until: String(Math.floor(Date.now() / 1000)),
    },
    60_000
  )
  if (!r.ok) throw new Error(`Facebook (página): ${r.error}`)
  const porDia = new Map<string, { toques: number | null; vistas: number | null }>()
  for (const m of r.data.data ?? []) {
    for (const v of m.values ?? []) {
      if (!v.end_time || typeof v.value !== "number") continue
      const dia = new Date(Date.parse(v.end_time) - 86_400_000).toISOString().slice(0, 10)
      const fila = porDia.get(dia) ?? { toques: null, vistas: null }
      if (m.name === "page_total_actions") fila.toques = v.value
      if (m.name === "page_media_view") fila.vistas = v.value
      porDia.set(dia, fila)
    }
  }
  const filas = [...porDia].map(([dia, f]) => ({
    account_id: accountId,
    red: "facebook",
    dia,
    toques_link: f.toques,
    visitas_perfil: null,
    alcance: f.vistas,
    actualizado_at: new Date().toISOString(),
  }))
  if (filas.length) {
    const { error } = await supabaseAdmin().from("cuenta_metricas_dia").upsert(filas, { onConflict: "account_id,red,dia" })
    if (error) throw new Error(error.message)
  }
  return filas.length
}

// ----------------------------------------------------------------- pasada

/**
 * Refresca las metricas de una empresa: los posts de los ultimos `dias` (hasta
 * 60) y las metricas diarias de la cuenta. Cada red por su lado: si una falla,
 * la otra sigue.
 */
export async function sincronizarMetricas(
  accountId: string,
  redes: { instagram: boolean; facebook: boolean },
  dias = VENTANA_CORTA
): Promise<ResumenMetricas> {
  dias = Math.min(Math.max(1, dias), VENTANA_DIAS)
  const supabase = supabaseAdmin()
  const resumen: ResumenMetricas = { instagram: 0, facebook: 0, dias: 0, errores: [] }
  const origenDe = await publicadoDesdeHancel(accountId)

  const guardar = async (filas: Fila[]) => {
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await supabase.from("post_metricas").upsert(filas.slice(i, i + 200), { onConflict: "account_id,red,post_id" })
      if (error) throw new Error(error.message)
    }
  }

  if (redes.instagram) {
    try {
      const filas = await postsInstagram(accountId, origenDe, dias)
      await guardar(filas)
      resumen.instagram = filas.length
    } catch (e) {
      resumen.errores.push(e instanceof Error ? e.message : String(e))
    }
    try {
      resumen.dias = await diasInstagram(accountId)
    } catch (e) {
      resumen.errores.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (redes.facebook) {
    try {
      const filas = await postsFacebook(accountId, origenDe, dias)
      await guardar(filas)
      resumen.facebook = filas.length
    } catch (e) {
      resumen.errores.push(e instanceof Error ? e.message : String(e))
    }
    try {
      resumen.dias += await diasFacebook(accountId)
    } catch (e) {
      resumen.errores.push(e instanceof Error ? e.message : String(e))
    }
  }
  return resumen
}
