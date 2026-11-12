import "server-only"

import { supabaseAdmin } from "@/engine/supabase-admin"
import { getSettings } from "@/engine/schedule"
import { idDeCuentaActual } from "@/lib/accounts"

/**
 * Lo que muestra Metricas: los posts publicados desde Hancel con sus ultimas
 * cifras y las metricas diarias de la cuenta. Los filtros (periodo, red, orden)
 * y los promedios se hacen en el cliente: son pocos cientos de filas.
 */

export type PostMetrica = {
  id: string
  red: "instagram" | "facebook"
  origen: "noticia" | "estudio" | "precios"
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

/**
 * Una fila diaria de la cuenta. En Instagram, `toques_link` son los toques al
 * link de la bio y `alcance` el alcance de la cuenta; en Facebook, `toques_link`
 * son los clics en el boton y los datos de contacto de la pagina y `alcance` las
 * vistas de toda la pagina.
 */
export type DiaCuenta = { red: "instagram" | "facebook"; dia: string; toques_link: number | null; visitas_perfil: number | null; alcance: number | null }

export type MetricasVista = { posts: PostMetrica[]; dias: DiaCuenta[]; timezone: string; actualizado: string | null }

export async function getMetricas(): Promise<MetricasVista> {
  const supabase = supabaseAdmin()
  const accountId = await idDeCuentaActual()
  const [posts, dias, { timezone }] = await Promise.all([
    supabase
      .from("post_metricas")
      .select("id, red, origen, texto, enlace, imagen, tipo, publicado_at, vistas, alcance, me_gusta, comentarios, guardados, compartidos, interacciones, actualizado_at")
      .eq("account_id", accountId)
      .order("publicado_at", { ascending: false })
      .limit(3000),
    supabase
      .from("cuenta_metricas_dia")
      .select("red, dia, toques_link, visitas_perfil, alcance")
      .eq("account_id", accountId)
      .order("dia", { ascending: false })
      .limit(800),
    getSettings(accountId),
  ])
  const lista = (posts.data ?? []) as PostMetrica[]
  const actualizado = lista.reduce<string | null>((max, p) => (!max || p.actualizado_at > max ? p.actualizado_at : max), null)
  return { posts: lista, dias: (dias.data ?? []) as DiaCuenta[], timezone, actualizado }
}
