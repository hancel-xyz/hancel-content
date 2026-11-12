import { dayIn, partsIn } from "../schedule"
import { supabaseAdmin } from "../supabase-admin"
import { comentarFacebook, publicarFacebook, publicarInstagram } from "../publish/meta"
import { subirCarrusel, subirImagenSuelta } from "../render/storage"
import { dibujarCarrusel } from "./laminas"
import { sandiaConfigurada, traerRankings, type Direccion, type Periodo, type Ranking } from "./sandia"
import { comentarioFacebook, diasEntre, textoDelPost } from "./textos"

/**
 * El pipeline de precios: datos de Sandia -> carrusel -> publicacion.
 *
 * Sin IA. Cada etapa es un proceso aparte:
 *
 *   1. Datos     la API de Sandia da el ranking de lo que mas subio y bajo.
 *   2. Carrusel  se dibujan las laminas, se suben a R2 y se escriben los
 *                textos de Instagram y Facebook. Queda "listo", con su hora.
 *   3. Publicar  a su hora sale en Instagram (link en la descripcion) y en
 *                Facebook (link en el primer comentario).
 *
 * Calendario (hora de la cuenta, Bogota):
 *   lunes a viernes  dos diarios: los que bajaron (13:00) y los que subieron (13:10).
 *   sabado           dos semanales, de la semana de lunes a viernes que cerro.
 *   domingo          nada: las centrales no reportan.
 *
 * Se arma desde media hora antes de la primera hora y hasta las 20:00, en
 * cuanto haya datos que no se hayan publicado. Un dia de precios sale una sola
 * vez (unico por referencia) y cada dia sale como mucho un carrusel por
 * direccion, aunque Sandia cargue dos fechas el mismo dia.
 */

export type AjustesPrecios = {
  activo: boolean
  horaBajaron: string
  horaSubieron: string
  link: string
  redes: ("instagram" | "facebook")[]
  /** Desde que dia local (YYYY-MM-DD) corre lo automatico; antes no arma ni publica. */
  desde: string | null
}

const POR_DEFECTO: AjustesPrecios = { activo: false, horaBajaron: "13:00", horaSubieron: "13:10", link: "https://usesandia.com", redes: ["instagram", "facebook"], desde: null }
const ZONA = "America/Bogota"
/** Un carrusel que no salio a su hora no se publica despues de esto: los precios ya serian viejos. */
const VENCE_MS = 6 * 3_600_000
const MAX_INTENTOS = 3

export async function ajustesPrecios(accountId: string): Promise<AjustesPrecios> {
  const { data } = await supabaseAdmin().from("precios_ajustes").select("*").eq("account_id", accountId).maybeSingle()
  const d = data as { activo: boolean; hora_bajaron: string; hora_subieron: string; link: string; redes: string[]; activo_desde: string | null } | null
  if (!d) return POR_DEFECTO
  return {
    activo: d.activo,
    horaBajaron: d.hora_bajaron || POR_DEFECTO.horaBajaron,
    horaSubieron: d.hora_subieron || POR_DEFECTO.horaSubieron,
    link: d.link || POR_DEFECTO.link,
    redes: (d.redes ?? []).filter((r): r is "instagram" | "facebook" => r === "instagram" || r === "facebook"),
    desde: d.activo_desde ?? null,
  }
}

export async function guardarAjustesPrecios(accountId: string, a: Partial<AjustesPrecios>): Promise<void> {
  const fila: Record<string, unknown> = { account_id: accountId, updated_at: new Date().toISOString() }
  if (a.activo !== undefined) fila.activo = a.activo
  if (a.horaBajaron) fila.hora_bajaron = a.horaBajaron
  if (a.horaSubieron) fila.hora_subieron = a.horaSubieron
  if (a.link) fila.link = a.link
  if (a.redes) fila.redes = a.redes
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

async function logoClaro(accountId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("generation_config").select("carousel").eq("account_id", accountId).maybeSingle()
  const logos = ((data as { carousel?: { logos?: { claro?: string | null } } } | null)?.carousel?.logos) ?? {}
  return reducida(logos.claro ?? null, 640)
}

export type CarruselPrecios = {
  id: string
  periodo: Periodo
  direccion: Direccion
  referencia: string
  etapa: string
  imagenes: string[]
  programado_para: string
}

/**
 * Dibuja, sube y deja listo un carrusel. Si ya existia (mismo dia o semana y
 * direccion), lo rehace en su sitio con los datos de ahora y conserva su hora,
 * salvo que ya este publicado.
 */
export async function armarCarrusel(
  accountId: string,
  ranking: Ranking,
  programadoPara: Date,
  hoy: string,
  ajustes?: AjustesPrecios
): Promise<CarruselPrecios> {
  if (ranking.productos.length < 3) throw new Error(`Sandia trajo solo ${ranking.productos.length} productos que ${ranking.direccion}.`)
  const a = ajustes ?? (await ajustesPrecios(accountId))
  const supabase = supabaseAdmin()

  const { data: previa } = await supabase
    .from("precios_carruseles")
    .select("id, etapa")
    .eq("account_id", accountId)
    .eq("periodo", ranking.periodo)
    .eq("direccion", ranking.direccion)
    .eq("referencia", ranking.referencia)
    .maybeSingle()
  if ((previa as { etapa: string } | null)?.etapa === "publicado") throw new Error("Ese carrusel ya se publicó.")

  const [logo, ...fotos] = await Promise.all([logoClaro(accountId), ...ranking.productos.map((m) => reducida(m.imagen, 520))])
  const imagenes = Object.fromEntries(ranking.productos.map((m, i) => [m.producto, fotos[i]]))
  const dominio = a.link.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const dibujo = await dibujarCarrusel({ ranking, hoy, logo, imagenes, dominio })

  const clave = `precios/${accountId}/${ranking.periodo}-${ranking.referencia}-${ranking.direccion}`
  const urls = await subirCarrusel(clave, [...dibujo.comunes, dibujo.cierreInstagram])
  const cierreFb = await subirImagenSuelta(clave, "cierre-facebook", dibujo.cierreFacebook)

  const fila = {
    account_id: accountId,
    periodo: ranking.periodo,
    direccion: ranking.direccion,
    referencia: ranking.referencia,
    etapa: "listo",
    datos: ranking,
    imagenes: urls,
    imagenes_facebook: [...urls.slice(0, -1), cierreFb],
    texto_instagram: textoDelPost(ranking, "instagram", a.link, hoy),
    texto_facebook: textoDelPost(ranking, "facebook", a.link, hoy),
    error: null,
    intentos: 0,
    updated_at: new Date().toISOString(),
  }
  const consulta = previa
    ? supabase.from("precios_carruseles").update(fila).eq("id", (previa as { id: string }).id)
    : supabase.from("precios_carruseles").insert({ ...fila, programado_para: programadoPara.toISOString() })
  const { data, error } = await consulta.select("id, periodo, direccion, referencia, etapa, imagenes, programado_para").single()
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
  const primera = Math.min(minutos(a.horaBajaron), minutos(a.horaSubieron))
  if (!opciones.forzar && (ahora < primera - 30 || ahora >= 20 * 60)) {
    return { armados, motivos: [`Fuera de la ventana de armado (desde media hora antes de las ${a.horaBajaron} hasta las 20:00).`] }
  }

  const supabase = supabaseAdmin()
  // Lo que ya se armo hoy: un carrusel por direccion y dia, como mucho.
  const inicioHoy = instanteLocal(hoy, "00:00").toISOString()
  const { data: deHoy } = await supabase
    .from("precios_carruseles")
    .select("direccion, referencia")
    .eq("account_id", accountId)
    .eq("periodo", periodo)
    .gte("programado_para", inicioHoy)
  const yaHoy = new Set(((deHoy ?? []) as { direccion: string }[]).map((f) => f.direccion))
  if (yaHoy.has("bajaron") && yaHoy.has("subieron")) return { armados, motivos: ["Los de hoy ya están armados."] }

  // El sabado, "auto" es la semana que acaba de cerrar; un armado a mano entre
  // semana pide la ultima cerrada, no la que va a medias.
  const rankings = await traerRankings(periodo, periodo === "semana" ? { semana: diaSemana === 6 || diaSemana === 0 ? "auto" : "cerrada" } : {})
  const referencia = rankings.subieron.referencia
  // El dia de precios no puede ser viejo: con un festivo el lunes, el ultimo es
  // el viernes (3 dias); mas que eso es que Sandia no ha cargado.
  // Sandia carga los precios del dia entre las 11 y las 12: a la 1 ya estan.
  // Lo automatico publica solo los de hoy; si aun no llegan, espera a la
  // siguiente pasada en vez de sacar los de ayer.
  if (periodo === "dia" && !opciones.forzar && referencia !== hoy) {
    return { armados, motivos: [`Sandia aún no carga los precios de hoy (el último día es ${referencia}).`] }
  }
  if (periodo === "dia" && diasEntre(referencia, hoy) > 4) {
    return { armados, motivos: [`El último día con precios es ${referencia}: demasiado viejo para publicarlo.`] }
  }

  const { data: usadas } = await supabase
    .from("precios_carruseles")
    .select("direccion")
    .eq("account_id", accountId)
    .eq("periodo", periodo)
    .eq("referencia", referencia)
  const usadasSet = new Set(((usadas ?? []) as { direccion: string }[]).map((f) => f.direccion))

  for (const direccion of ["bajaron", "subieron"] as Direccion[]) {
    if (yaHoy.has(direccion)) continue
    if (usadasSet.has(direccion)) {
      motivos.push(`Los que ${direccion} del ${referencia} ya se armaron; se espera a que Sandia cargue un día nuevo.`)
      continue
    }
    const hora = direccion === "bajaron" ? a.horaBajaron : a.horaSubieron
    try {
      const c = await armarCarrusel(accountId, rankings[direccion], instanteLocal(hoy, hora), hoy, a)
      armados.push(`${periodo} ${direccion} ${referencia} (${c.imagenes.length} láminas)`)
    } catch (e) {
      motivos.push(`${direccion}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { armados, motivos }
}

/** Rehace un carrusel con los datos de su mismo dia o semana. */
export async function rehacerCarrusel(accountId: string, id: string, now: Date): Promise<void> {
  const { data } = await supabaseAdmin().from("precios_carruseles").select("periodo, direccion, referencia, programado_para").eq("id", id).eq("account_id", accountId).maybeSingle()
  const f = data as { periodo: Periodo; direccion: Direccion; referencia: string; programado_para: string } | null
  if (!f) throw new Error("Ese carrusel no es de esta empresa.")
  const rankings = await traerRankings(f.periodo, f.periodo === "dia" ? { fecha: f.referencia } : { semana: f.referencia })
  // "Hoy" es el dia en que se publica: asi la portada dice "ayer" u "hoy" bien.
  await armarCarrusel(accountId, rankings[f.direccion], new Date(f.programado_para), dayIn(ZONA, new Date(Math.max(now.getTime(), new Date(f.programado_para).getTime()))))
}

// ---------------------------------------------------------------- publicar

type Fila = {
  id: string
  account_id: string
  periodo: Periodo
  direccion: Direccion
  referencia: string
  imagenes: string[]
  imagenes_facebook: string[]
  texto_instagram: string | null
  texto_facebook: string | null
  programado_para: string
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
      if (r.postId && r.postId !== "publicado") {
        const c = await comentarFacebook(accountId, r.postId, comentarioFacebook(a.link))
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
    .select("id, programado_para, periodo, direccion, referencia")
    .eq("account_id", accountId)
    .eq("etapa", "listo")
    .lte("programado_para", now.toISOString())
    .order("programado_para")
    .limit(5)
  for (const f of (data ?? []) as { id: string; programado_para: string; periodo: string; direccion: string; referencia: string }[]) {
    if (now.getTime() - new Date(f.programado_para).getTime() > VENCE_MS) {
      await supabase.from("precios_carruseles").update({ etapa: "error", error: "No salió a su hora y los precios ya serían viejos." }).eq("id", f.id)
      continue
    }
    const r = await publicarCarruselPrecios(accountId, f.id)
    return `${f.periodo} ${f.direccion} ${f.referencia}: ${r.ok ? "publicado" : r.error}`
  }
  return null
}

/** La pasada del tick para una cuenta: armar lo que toque y publicar lo que llego a su hora. */
export async function pasadaPrecios(accountId: string, now: Date): Promise<Record<string, unknown>> {
  const a = await ajustesPrecios(accountId)
  if (!a.activo) return { activo: false, sandia: sandiaConfigurada() }
  if (a.desde && dayIn(ZONA, now) < a.desde) return { activo: true, sandia: sandiaConfigurada(), esperando: `Empieza el ${a.desde}.` }
  let armado: unknown
  try {
    armado = await armarLosDeHoy(accountId, now)
  } catch (e) {
    armado = { error: e instanceof Error ? e.message : String(e) }
  }
  const publicado = await publicarElQueToca(accountId, now)
  return { activo: true, armado, publicado }
}
