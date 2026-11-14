import "server-only"

import { ajustesPrecios, type AjustesPrecios } from "@/engine/precios/pipeline"
import { sandiaConfigurada, type Ranking } from "@/engine/precios/sandia"
import { tituloCarrusel } from "@/engine/precios/textos"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { idDeCuentaActual } from "@/lib/accounts"

/**
 * El tablero del pipeline de precios: los carruseles de los ultimos dias, por
 * etapa, y los ajustes (activo y horas).
 */

export type EtapaPrecios = "listo" | "publicando" | "publicado" | "error" | "descartado"

export type FichaPrecios = {
  id: string
  titulo: string
  periodo: "dia" | "semana"
  direccion: "subieron" | "bajaron"
  referencia: string
  etapa: EtapaPrecios
  imagenes: string[]
  imagenesFacebook: string[]
  /** Las laminas animadas: un MP4 por lamina (Instagram) y uno con todas (Facebook). */
  videos: string[]
  videoFacebook: string | null
  videoEstado: "pendiente" | "listo" | "error" | null
  videoError: string | null
  totalLaminas: number
  textoInstagram: string | null
  textoFacebook: string | null
  programadoPara: string
  publicadoAt: string | null
  instagramId: string | null
  facebookId: string | null
  error: string | null
  productos: { nombre: string; porcentaje: number }[]
}

export type TableroPrecios = {
  ajustes: AjustesPrecios
  sandia: boolean
  fichas: Record<EtapaPrecios, FichaPrecios[]>
}

export async function getTableroPrecios(): Promise<TableroPrecios> {
  const accountId = await idDeCuentaActual()
  const desde = new Date(Date.now() - 21 * 86_400_000).toISOString()
  const [ajustes, { data }] = await Promise.all([
    ajustesPrecios(accountId),
    supabaseAdmin()
      .from("precios_carruseles")
      .select("*")
      .eq("account_id", accountId)
      .gte("created_at", desde)
      .order("programado_para", { ascending: false })
      .limit(80),
  ])

  const fichas: Record<EtapaPrecios, FichaPrecios[]> = { listo: [], publicando: [], publicado: [], error: [], descartado: [] }
  for (const f of (data ?? []) as Record<string, unknown>[]) {
    const datos = f.datos as Ranking
    const etapa = f.etapa as EtapaPrecios
    fichas[etapa]?.push({
      id: String(f.id),
      titulo: tituloCarrusel(datos),
      periodo: f.periodo as "dia" | "semana",
      direccion: f.direccion as "subieron" | "bajaron",
      referencia: String(f.referencia),
      etapa,
      imagenes: (f.imagenes as string[]) ?? [],
      imagenesFacebook: (f.imagenes_facebook as string[]) ?? [],
      videos: (f.videos as string[] | null) ?? [],
      videoFacebook: (f.video_facebook as string | null) ?? null,
      videoEstado: (f.video_estado as FichaPrecios["videoEstado"]) ?? null,
      videoError: (f.video_error as string | null) ?? null,
      totalLaminas: (datos.productos?.length ?? 0) + 2,
      textoInstagram: (f.texto_instagram as string | null) ?? null,
      textoFacebook: (f.texto_facebook as string | null) ?? null,
      programadoPara: String(f.programado_para),
      publicadoAt: (f.publicado_at as string | null) ?? null,
      instagramId: (f.instagram_id as string | null) ?? null,
      facebookId: (f.facebook_id as string | null) ?? null,
      error: (f.error as string | null) ?? null,
      productos: (datos.productos ?? []).map((p) => ({ nombre: p.nombre, porcentaje: p.porcentaje })),
    })
  }
  // Los listos, el proximo primero.
  fichas.listo.reverse()
  return { ajustes, sandia: sandiaConfigurada(), fichas }
}
