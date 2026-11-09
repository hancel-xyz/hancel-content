import "server-only"

import { conexionWeb } from "@/engine/web/webhook"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { getSettings } from "@/engine/schedule"
import { idDeCuentaActual } from "@/lib/accounts"

/** Lo que muestra Metricas > Portal: el resumen que el tick trae del portal cada hora. */

export type DiaPortal = {
  dia: string
  visitantes: number
  nuevos: number
  sesiones: number
  vistas: number
  rebote: number
  paginas_por_sesion: number
  segundos_lectura: number
  canales: Record<string, { visitantes: number; sesiones: number; vistas: number }>
  dispositivos: Record<string, number>
  ciudades: Record<string, number>
  enlaces: { vistas?: number; visitantes?: number; clics_portadas?: number; visitantes_portadas?: number; clics_alertas?: number; visitantes_alertas?: number }
  clics: Record<string, number>
}

export type NoticiaDiaPortal = {
  dia: string
  noticia_id: string
  vistas: number
  visitantes: number
  segundos_promedio: number
  scroll_promedio: number
  lecturas: number
  desde_enlaces: number
  clics_portada: number
  compartidos: number
  canales: Record<string, number>
}

export type AcumuladoPortal = {
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

export type PortalVista = {
  conectado: boolean
  urlPortal: string | null
  dias: DiaPortal[]
  noticias: NoticiaDiaPortal[]
  acumulado: AcumuladoPortal[]
  ventana: Record<string, number>
  leidoAt: string | null
  error: string | null
  timezone: string
}

export async function getMetricasPortal(): Promise<PortalVista> {
  const supabase = supabaseAdmin()
  const accountId = await idDeCuentaActual()
  const [conexion, { timezone }, dias, noticias, acumulado, cuenta] = await Promise.all([
    conexionWeb(accountId),
    getSettings(accountId),
    supabase
      .from("portal_metricas_dia")
      .select("dia, visitantes, nuevos, sesiones, vistas, rebote, paginas_por_sesion, segundos_lectura, canales, dispositivos, ciudades, enlaces, clics")
      .eq("account_id", accountId)
      .order("dia", { ascending: false })
      .limit(400),
    supabase
      .from("portal_metricas_noticia")
      .select("dia, noticia_id, vistas, visitantes, segundos_promedio, scroll_promedio, lecturas, desde_enlaces, clics_portada, compartidos, canales")
      .eq("account_id", accountId)
      .order("dia", { ascending: false })
      .limit(10000),
    supabase
      .from("portal_metricas_acumulado")
      .select("noticia_id, slug, titular, publicada_at, vistas, visitantes, segundos_promedio, scroll_promedio, desde_enlaces")
      .eq("account_id", accountId)
      .limit(5000),
    supabase.from("portal_metricas_cuenta").select("visitantes_ventana, leido_at, error").eq("account_id", accountId).maybeSingle(),
  ])
  const c = cuenta.data as { visitantes_ventana: Record<string, number>; leido_at: string | null; error: string | null } | null
  let urlPortal: string | null = null
  try {
    urlPortal = conexion ? new URL(conexion.url).origin : null
  } catch {
    urlPortal = null
  }
  return {
    conectado: Boolean(conexion),
    urlPortal,
    dias: ((dias.data ?? []) as DiaPortal[]).map((d) => ({ ...d, rebote: Number(d.rebote), paginas_por_sesion: Number(d.paginas_por_sesion) })),
    noticias: (noticias.data ?? []) as NoticiaDiaPortal[],
    acumulado: (acumulado.data ?? []) as AcumuladoPortal[],
    ventana: c?.visitantes_ventana ?? {},
    leidoAt: c?.leido_at ?? null,
    error: c?.error ?? null,
    timezone,
  }
}
