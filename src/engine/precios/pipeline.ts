import { dayIn, partsIn } from "../schedule"
import { supabaseAdmin } from "../supabase-admin"
import { comentarFacebook, publicarFacebook, publicarInstagram } from "../publish/meta"
import { subirCarrusel, subirImagenSuelta } from "../render/storage"
import { dibujarCarrusel, type DatosLaminas } from "./laminas"
import { sandiaConfigurada, traerLista, type ListaPrecios, type Periodo } from "./sandia"
import { comentarioFacebook, diasEntre, dominioDe, textoDelPost } from "./textos"

/**
 * El pipeline de precios: datos -> carrusel -> publicacion.
 *
 * Sin IA. Cada etapa es un proceso aparte:
 *
 *   1. Datos     la API de precios da todos los productos de la central, con
 *                su precio por kilo y cuanto subio o bajo.
 *   2. Carrusel  se dibujan las laminas (portada con los cuatro que mas
 *                subieron, la lista completa y el cierre), se suben a R2 y se
 *                escribe el texto. Queda "listo", con su hora.
 *   3. Publicar  a su hora sale en Instagram (link al portal en la
 *                descripcion) y en Facebook (link en el primer comentario).
 *
 * Un carrusel por central (Corabastos, CMA...) y por dia. En la tabla la
 * columna `direccion` queda en "todos": viene de cuando habia uno de los que
 * subieron y otro de los que bajaron.
 *
 * Calendario (hora de la cuenta, Bogota):
 *   lunes a viernes  la primera central a su hora (13:00) y cada central
 *                    siguiente, 20 minutos despues.
 *   sabado           el semanal de cada central, de la semana que cerro.
 *   domingo          nada: las centrales no reportan.
 *
 * Se arma desde una hora antes de la primera hora y hasta las 20:00, en
 * cuanto haya datos que no se hayan publicado. Un dia de precios sale una sola
 * vez por central (unico por referencia).
 */

export type AjustesPrecios = {
  activo: boolean
  /** La hora de la primera central; las demas salen cada 20 minutos (columna `hora_bajaron`). */
  hora: string
  /** El portal de precios: la ultima lamina invita a visitarlo. */
  link: string
  redes: ("instagram" | "facebook")[]
  /** Desde que dia local (YYYY-MM-DD) corre lo automatico; antes no arma ni publica. */
  desde: string | null
  /** Slugs de las centrales que salen, en orden. */
  centrales: string[]
}

const POR_DEFECTO: AjustesPrecios = { activo: false, hora: "13:00", link: "https://usesandia.com", redes: ["instagram", "facebook"], desde: null, centrales: ["corabastos"] }
const ZONA = "America/Bogota"
/** En la tabla, de cuando habia un carrusel de los que subieron y otro de los que bajaron. */
const DIRECCION = "todos"
/** Un carrusel que no salio a su hora no se publica despues de esto: los precios ya serian viejos. */
const VENCE_MS = 6 * 3_600_000
const MAX_INTENTOS = 3

export async function ajustesPrecios(accountId: string): Promise<AjustesPrecios> {
  const { data } = await supabaseAdmin().from("precios_ajustes").select("*").eq("account_id", accountId).maybeSingle()
  const d = data as { activo: boolean; hora_bajaron: string; link: string | null; redes: string[]; activo_desde: string | null; centrales: string[] | null } | null
  if (!d) return POR_DEFECTO
  const centrales = (d.centrales ?? []).filter(Boolean)
  return {
    activo: d.activo,
    hora: d.hora_bajaron || POR_DEFECTO.hora,
    link: d.link || POR_DEFECTO.link,
    redes: (d.redes ?? []).filter((r): r is "instagram" | "facebook" => r === "instagram" || r === "facebook"),
    desde: d.activo_desde ?? null,
    centrales: centrales.length ? centrales : POR_DEFECTO.centrales,
  }
}

export async function guardarAjustesPrecios(accountId: string, a: Partial<AjustesPrecios>): Promise<void> {
  const fila: Record<string, unknown> = { account_id: accountId, updated_at: new Date().toISOString() }
  if (a.activo !== undefined) fila.activo = a.activo
  if (a.hora) fila.hora_bajaron = a.hora
  if (a.link) fila.link = a.link
  if (a.redes) fila.redes = a.redes
  if (a.centrales) fila.centrales = a.centrales
  const { error } = await supabaseAdmin().from("precios_ajustes").upsert(fila, { onConflict: "account_id" })
  if (error) throw new Error(`No se pudieron guardar los ajustes de precios: ${error.message}`)
}

// ------------------------------------------------------------------ fechas

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + (m || 0)
}

/** Dia de la semana (0 domingo) de una fecha YYYY-MM-DD. */
const dow = (fecha: string) => {
  const [y, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** El instante de una hora local ("13:10") de un dia local, en la zona de la cuenta. */
function instanteLocal(dia: string, hhmm: string): Date {
  // Bogota no tiene horario de verano: el desfase se mide una vez con el mediodia de ese dia.
  const [y, m, d] = dia.split("-").map(Number)
  const mediodiaUtc = new Date(Date.UTC(y, m - 1, d, 12, 0))
  const local = partsIn(ZONA, mediodiaUtc)
  const desfaseMin = (local.hour * 60 + local.minute) - 12 * 60
  const [hh, mm] = hhmm.split(":").map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - desfaseMin * 60_000)
}

// ------------------------------------------------------------------ armar

/** Baja una imagen y la reduce, para que dibujar no cargue PNG de 2 MB. */
async function reducida(url: string | null, lado: number): Promise<string | null> {
  if (!url) return null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return null
    const sharp = (await import("sharp")).default
    const png = await sharp(Buffer.from(await r.arrayBuffer())).resize(lado, lado, { fit: "inside" }).png().toBuffer()
    return `data:image/png;base64,${png.toString("base64")}`
  } catch {
    return null
  }
}

/** El logo para fondo claro (el oscuro); si la cuenta solo tiene uno, ese. */
async function logoOscuro(accountId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("generation_config").select("carousel").eq("account_id", accountId).maybeSingle()
  const logos = ((data as { carousel?: { logos?: { claro?: string | null; oscuro?: string | null } } } | null)?.carousel?.logos) ?? {}
  return reducida(logos.oscuro ?? logos.claro ?? null, 640)
}

/** Lo que necesitan las laminas: la lista, el logo y la foto de cada producto. */
async function datosLaminas(accountId: string, lista: ListaPrecios, link: string): Promise<DatosLaminas> {
  const [logo, ...fotos] = await Promise.all([logoOscuro(accountId), ...lista.productos.map((p) => reducida(p.imagen, 300))])
  const imagenes = Object.fromEntries(lista.productos.map((p, i) => [p.producto, fotos[i]]))
  return { lista, logo, imagenes, dominio: dominioDe(link) }
}

/** Minutos entre una central y la siguiente. */
const ESCALON_MIN = 20

/** "13:10" + 40 min -> "13:50" */
const sumarMinutos = (hhmm: string, n: number) => {
  const t = minutos(hhmm) + n
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

/** La carpeta de un carrusel en R2. */
const claveDe = (accountId: string, f: { periodo: string; referencia: string; central: string }) => `precios/${accountId}/${f.periodo}-${f.referencia}-${f.central}`

export type CarruselPrecios = {
  id: string
  periodo: Periodo
  referencia: string
  etapa: string
  imagenes: string[]
  programado_para: string
}

/**
 * Dibuja, sube y deja listo un carrusel. Si ya existia (mismo dia o semana y
 * central), lo rehace en su sitio con los datos de ahora y conserva su hora,
 * salvo que ya este publicado.
 */
export async function armarCarrusel(accountId: string, lista: ListaPrecios, programadoPara: Date, ajustes?: AjustesPrecios): Promise<CarruselPrecios> {
  if (lista.productos.length < 4) throw new Error(`Solo hay ${lista.productos.length} precios de ${lista.central.nombre}.`)
  const a = ajustes ?? (await ajustesPrecios(accountId))
  const supabase = supabaseAdmin()

  const { data: previa } = await supabase
    .from("precios_carruseles")
    .select("id, etapa")
    .eq("account_id", accountId)
    .eq("periodo", lista.periodo)
    .eq("direccion", DIRECCION)
    .eq("referencia", lista.referencia)
    .eq("central", lista.central.slug)
    .maybeSingle()
  if ((previa as { etapa: string } | null)?.etapa === "publicado") throw new Error("Ese carrusel ya se publicó.")

  const dibujo = await dibujarCarrusel(await datosLaminas(accountId, lista, a.link))
  const clave = claveDe(accountId, { ...lista, central: lista.central.slug })
  const urls = await subirCarrusel(clave, [...dibujo.comunes, dibujo.cierreInstagram])
  const cierreFb = await subirImagenSuelta(clave, "cierre-facebook", dibujo.cierreFacebook)

  const fila = {
    account_id: accountId,
    periodo: lista.periodo,
    direccion: DIRECCION,
    referencia: lista.referencia,
    central: lista.central.slug,
    etapa: "listo",
    datos: lista,
    imagenes: urls,
    imagenes_facebook: [...urls.slice(0, -1), cierreFb],
    texto_instagram: textoDelPost(lista, "instagram", a.link),
    texto_facebook: textoDelPost(lista, "facebook", a.link),
    videos: [],
    video_facebook: null,
    video_estado: null,
    video_error: null,
    error: null,
    intentos: 0,
    updated_at: new Date().toISOString(),
  }
  const consulta = previa
    ? supabase.from("precios_carruseles").update(fila).eq("id", (previa as { id: string }).id)
    : supabase.from("precios_carruseles").insert({ ...fila, programado_para: programadoPara.toISOString() })
  const { data, error } = await consulta.select("id, periodo, referencia, etapa, imagenes, programado_para").single()
  if (error) throw new Error(`No se pudo guardar el carrusel: ${error.message}`)
  return data as CarruselPrecios
}

/**
 * Arma los carruseles que tocan hoy, si hay datos nuevos. `forzar` se salta la
 * ventana de horas (el boton del tablero) pero no las reglas de no repetir.
 */
export async function armarLosDeHoy(
  accountId: string,
  now: Date,
  opciones: { forzar?: boolean; periodo?: Periodo } = {}
): Promise<{ armados: string[]; motivos: string[] }> {
  const a = await ajustesPrecios(accountId)
  const hoy = dayIn(ZONA, now)
  const { hour, minute } = partsIn(ZONA, now)
  const ahora = hour * 60 + minute
  const diaSemana = dow(hoy)
  const periodo: Periodo | null = opciones.periodo ?? (diaSemana >= 1 && diaSemana <= 5 ? "dia" : diaSemana === 6 ? "semana" : null)
  const motivos: string[] = []
  const armados: string[] = []

  if (!periodo) return { armados, motivos: ["Domingo: no hay carruseles de precios."] }
  if (!opciones.forzar && (ahora < minutos(a.hora) - 60 || ahora >= 20 * 60)) {
    return { armados, motivos: [`Fuera de la ventana de armado (desde una hora antes de las ${a.hora} hasta las 20:00).`] }
  }

  const supabase = supabaseAdmin()
  // Lo que ya se armo hoy: un carrusel por central y dia, como mucho.
  const inicioHoy = instanteLocal(hoy, "00:00").toISOString()
  const { data: deHoy } = await supabase
    .from("precios_carruseles")
    .select("central")
    .eq("account_id", accountId)
    .eq("periodo", periodo)
    .eq("direccion", DIRECCION)
    .gte("programado_para", inicioHoy)
  const yaHoy = new Set(((deHoy ?? []) as { central: string }[]).map((f) => f.central))
  if (a.centrales.every((c) => yaHoy.has(c))) return { armados, motivos: ["Los de hoy ya están armados."] }

  for (const [n, central] of a.centrales.entries()) {
    if (yaHoy.has(central)) continue
    let lista: ListaPrecios
    try {
      // El sabado, "auto" es la semana que acaba de cerrar; un armado a mano entre
      // semana pide la ultima cerrada, no la que va a medias.
      lista = await traerLista(periodo, central, periodo === "semana" ? { semana: diaSemana === 6 || diaSemana === 0 ? "auto" : "cerrada" } : {})
    } catch (e) {
      motivos.push(`${central}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    const referencia = lista.referencia
    // Los precios del dia llegan entre las 11 y las 12: a la 1 ya estan. Lo
    // automatico publica solo los de hoy; si aun no llegan, espera a la
    // siguiente pasada en vez de sacar los de ayer.
    if (periodo === "dia" && !opciones.forzar && referencia !== hoy) {
      motivos.push(`${central}: aún no hay precios de hoy (el último día es ${referencia}).`)
      continue
    }
    if (periodo === "dia" && diasEntre(referencia, hoy) > 4) {
      motivos.push(`${central}: el último día con precios es ${referencia}, demasiado viejo para publicarlo.`)
      continue
    }

    const { data: usada } = await supabase
      .from("precios_carruseles")
      .select("id")
      .eq("account_id", accountId)
      .eq("periodo", periodo)
      .eq("direccion", DIRECCION)
      .eq("referencia", referencia)
      .eq("central", central)
      .maybeSingle()
    if (usada) {
      motivos.push(`${central}: los precios del ${referencia} ya se armaron; se espera un día nuevo.`)
      continue
    }

    const hora = sumarMinutos(a.hora, n * ESCALON_MIN)
    try {
      const c = await armarCarrusel(accountId, lista, instanteLocal(hoy, hora), a)
      armados.push(`${central} ${periodo} ${referencia} (${c.imagenes.length} láminas, ${lista.productos.length} productos, ${hora})`)
    } catch (e) {
      motivos.push(`${central}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { armados, motivos }
}

/**
 * Rehace un carrusel con los datos de ahora. La API da solo los ultimos
 * precios: si ya hay un dia (o semana) mas nuevo, no se puede rehacer.
 */
export async function rehacerCarrusel(accountId: string, id: string): Promise<void> {
  const { data } = await supabaseAdmin().from("precios_carruseles").select("periodo, direccion, referencia, central, programado_para").eq("id", id).eq("account_id", accountId).maybeSingle()
  const f = data as { periodo: Periodo; direccion: string; referencia: string; central: string; programado_para: string } | null
  if (!f) throw new Error("Ese carrusel no es de esta empresa.")
  if (f.direccion !== DIRECCION || !f.central) throw new Error("Ese carrusel es del formato anterior: no se rehace.")
  const lista = await traerLista(f.periodo, f.central, f.periodo === "semana" ? { semana: "cerrada" } : {})
  if (lista.referencia !== f.referencia) throw new Error(`Ya no están los precios del ${f.referencia} (los últimos son del ${lista.referencia}).`)
  await armarCarrusel(accountId, lista, new Date(f.programado_para))
}

// ---------------------------------------------------------------- publicar

type Fila = {
  id: string
  datos: ListaPrecios
  imagenes: string[]
  imagenes_facebook: string[]
  texto_instagram: string | null
  texto_facebook: string | null
  instagram_id: string | null
  facebook_id: string | null
  intentos: number
}

/**
 * Publica un carrusel en las redes de la cuenta. Lo que ya salio en una red no
 * se repite: si Instagram salio y Facebook fallo, el reintento solo hace Facebook.
 */
export async function publicarCarruselPrecios(accountId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = supabaseAdmin()
  const a = await ajustesPrecios(accountId)
  const { data: reclamada } = await supabase
    .from("precios_carruseles")
    .update({ etapa: "publicando", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId)
    .eq("etapa", "listo")
    .select("*")
    .maybeSingle()
  if (!reclamada) return { ok: false, error: "El carrusel no está listo para publicar (o lo tomó otra pasada)." }
  const f = reclamada as Fila

  const cambios: Record<string, unknown> = {}
  const errores: string[] = []

  if (a.redes.includes("instagram") && !f.instagram_id) {
    const r = await publicarInstagram(accountId, { texto: f.texto_instagram ?? "", imagenes: f.imagenes })
    if (r.ok) cambios.instagram_id = r.postId
    else errores.push(`Instagram: ${r.error}`)
  }
  if (a.redes.includes("facebook") && !f.facebook_id) {
    const r = await publicarFacebook(accountId, { texto: f.texto_facebook ?? "", imagenes: f.imagenes_facebook.length ? f.imagenes_facebook : f.imagenes })
    if (r.ok) {
      cambios.facebook_id = r.postId
      if (r.postId && r.postId !== "publicado" && f.datos?.central) {
        const c = await comentarFacebook(accountId, r.postId, comentarioFacebook(a.link, f.datos))
        if (!c.ok) console.error("[precios] no se pudo comentar el link", id, c.error)
      }
    } else errores.push(`Facebook: ${r.error}`)
  }

  const intentos = f.intentos + 1
  const fin = errores.length === 0
  await supabase
    .from("precios_carruseles")
    .update({
      ...cambios,
      etapa: fin ? "publicado" : intentos >= MAX_INTENTOS ? "error" : "listo",
      error: fin ? null : errores.join(" · ").slice(0, 1000),
      intentos: fin ? f.intentos : intentos,
      ...(fin ? { publicado_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  return fin ? { ok: true } : { ok: false, error: errores.join(" · ") }
}

/** Publica, como mucho, un carrusel que ya llego a su hora. */
async function publicarElQueToca(accountId: string, now: Date): Promise<string | null> {
  const supabase = supabaseAdmin()
  // Un reclamo huerfano (la pasada murio publicando) vuelve a la cola.
  await supabase
    .from("precios_carruseles")
    .update({ etapa: "listo" })
    .eq("account_id", accountId)
    .eq("etapa", "publicando")
    .lt("updated_at", new Date(now.getTime() - 10 * 60_000).toISOString())

  const { data } = await supabase
    .from("precios_carruseles")
    .select("id, programado_para, periodo, central, referencia")
    .eq("account_id", accountId)
    .eq("etapa", "listo")
    .lte("programado_para", now.toISOString())
    .order("programado_para")
    .limit(5)
  for (const f of (data ?? []) as { id: string; programado_para: string; periodo: string; central: string; referencia: string }[]) {
    if (now.getTime() - new Date(f.programado_para).getTime() > VENCE_MS) {
      await supabase.from("precios_carruseles").update({ etapa: "error", error: "No salió a su hora y los precios ya serían viejos." }).eq("id", f.id)
      continue
    }
    const r = await publicarCarruselPrecios(accountId, f.id)
    return `${f.central} ${f.periodo} ${f.referencia}: ${r.ok ? "publicado" : r.error}`
  }
  return null
}

/** La pasada del tick para una cuenta: armar lo que toque y publicar lo que llego a su hora. */
export async function pasadaPrecios(accountId: string, now: Date): Promise<Record<string, unknown>> {
  const a = await ajustesPrecios(accountId)
  if (!a.activo) return { activo: false, datos: sandiaConfigurada() }
  if (a.desde && dayIn(ZONA, now) < a.desde) return { activo: true, datos: sandiaConfigurada(), esperando: `Empieza el ${a.desde}.` }
  let armado: unknown
  try {
    armado = await armarLosDeHoy(accountId, now)
  } catch (e) {
    armado = { error: e instanceof Error ? e.message : String(e) }
  }
  const publicado = await publicarElQueToca(accountId, now)
  return { activo: true, armado, publicado }
}
