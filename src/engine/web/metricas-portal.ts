import { dayIn, getSettings } from "../schedule"
import { supabaseAdmin } from "../supabase-admin"
import { conexionWeb, firmar } from "./webhook"

/**
 * Metricas del portal: visitantes, tiempo de lectura, canales, clics de la pagina de enlaces.
 *
 * El portal mide por su cuenta (sin terceros) y expone un resumen por dia en
 * `<portal>/api/metricas/resumen`. Hancel lo pide cada hora con una peticion firmada con el mismo
 * secreto del webhook (`X-Hancel-Signature: t=…,v1=HMAC(secreto, "t.?query")`). Ninguno depende
 * del otro: si el portal no responde, la pasada se registra con su error y la siguiente lo vuelve
 * a intentar.
 *
 * Se piden los ultimos 3 dias (el de hoy cambia todo el dia y el tiempo de lectura de ayer puede
 * llegar tarde); la primera vez, los ultimos 60.
 */

const DIAS_NORMAL = 3
const DIAS_PRIMERA = 60

type DiaPortal = {
  dia: string
  visitantes: number
  nuevos: number
  sesiones: number
  vistas: number
  rebote: number
  paginas_por_sesion: number
  segundos_lectura: number
  canales: Record<string, unknown>
  dispositivos: Record<string, number>
  paises: Record<string, number>
  ciudades: Record<string, number>
  enlaces: Record<string, number>
  clics: Record<string, number>
}

type NoticiaDia = {
  dia: string
  noticia_id: string
  vistas: number
  visitantes: number
  segundos_promedio: number
  segundos_mediana: number
  scroll_promedio: number
  lecturas: number
  desde_enlaces: number
  clics_portada: number
  compartidos: number
  canales: Record<string, number> | null
}

type Acumulado = {
  noticia_id: string
  slug: string | null
  titular: string | null
  publicada_at: string | null
  vistas: number
  visitantes: number
  segundos_promedio: number
  scroll_promedio: number
  desde_enlaces: number
}

type Resumen = {
  dias: DiaPortal[]
  noticias: NoticiaDia[]
  acumulado: Acumulado[]
  visitantes_ventana: Record<string, number>
}

export type ResultadoPortal = { ok: true; dias: number; noticias: number } | { ok: false; error: string } | null

function restarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Trae y guarda el resumen del portal de una empresa. null si la empresa no tiene portal conectado. */
export async function traerMetricasPortal(accountId: string): Promise<ResultadoPortal> {
  const conexion = await conexionWeb(accountId)
  if (!conexion) return null
  const supabase = supabaseAdmin()

  const registrar = async (error: string | null, ventana?: Record<string, number>) => {
    await supabase.from("portal_metricas_cuenta").upsert(
      {
        account_id: accountId,
        ...(ventana ? { visitantes_ventana: ventana, leido_at: new Date().toISOString() } : {}),
        error,
        actualizado_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    )
  }

  try {
    const { timezone } = await getSettings(accountId)
    const hoy = dayIn(timezone, new Date())
    const { count } = await supabase.from("portal_metricas_dia").select("dia", { count: "exact", head: true }).eq("account_id", accountId)
    const desde = restarDias(hoy, (count ?? 0) > 0 ? DIAS_NORMAL - 1 : DIAS_PRIMERA - 1)

    const query = `?${new URLSearchParams({ desde, hasta: hoy, zona: timezone }).toString()}`
    const t = Math.floor(Date.now() / 1000)
    const url = `${new URL(conexion.url).origin}/api/metricas/resumen${query}`
    const res = await fetch(url, {
      headers: { "X-Hancel-Signature": `t=${t},v1=${firmar(conexion.secreto, t, query)}` },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    })
    if (!res.ok) {
      const error = `El portal respondió ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`
      await registrar(error)
      return { ok: false, error }
    }
    const r = (await res.json()) as Resumen
    const ahora = new Date().toISOString()

    const dias = (r.dias ?? []).map((d) => ({
      account_id: accountId,
      dia: d.dia,
      visitantes: d.visitantes ?? 0,
      nuevos: d.nuevos ?? 0,
      sesiones: d.sesiones ?? 0,
      vistas: d.vistas ?? 0,
      rebote: d.rebote ?? 0,
      paginas_por_sesion: d.paginas_por_sesion ?? 0,
      segundos_lectura: d.segundos_lectura ?? 0,
      canales: d.canales ?? {},
      dispositivos: d.dispositivos ?? {},
      paises: d.paises ?? {},
      ciudades: d.ciudades ?? {},
      enlaces: d.enlaces ?? {},
      clics: d.clics ?? {},
      actualizado_at: ahora,
    }))
    if (dias.length) {
      const { error } = await supabase.from("portal_metricas_dia").upsert(dias, { onConflict: "account_id,dia" })
      if (error) throw new Error(error.message)
    }

    const noticias = (r.noticias ?? []).map((n) => ({ account_id: accountId, ...n, canales: n.canales ?? {}, actualizado_at: ahora }))
    for (let i = 0; i < noticias.length; i += 500) {
      const { error } = await supabase.from("portal_metricas_noticia").upsert(noticias.slice(i, i + 500), { onConflict: "account_id,dia,noticia_id" })
      if (error) throw new Error(error.message)
    }

    const acumulado = (r.acumulado ?? []).map((a) => ({ account_id: accountId, ...a, actualizado_at: ahora }))
    for (let i = 0; i < acumulado.length; i += 500) {
      const { error } = await supabase.from("portal_metricas_acumulado").upsert(acumulado.slice(i, i + 500), { onConflict: "account_id,noticia_id" })
      if (error) throw new Error(error.message)
    }

    await registrar(null, r.visitantes_ventana ?? {})
    return { ok: true, dias: dias.length, noticias: noticias.length }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await registrar(error).catch(() => {})
    return { ok: false, error }
  }
}
