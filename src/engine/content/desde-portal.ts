import type { RawNews } from "@/lib/types"

import { supabaseAdmin } from "../supabase-admin"
import { conexionWeb } from "../web/webhook"
import { enqueueInstagramJob } from "./jobs"
import type { ContentAngle, NotaDelPortal, Variables } from "./types"

/**
 * El carrusel nace de la nota del portal.
 *
 * En una cuenta con portal el flujo principal es el de redaccion: la noticia se
 * selecciona, se investiga (fuentes, busqueda, foto del hecho), se redacta y se
 * publica en el portal. Solo entonces, con el link de la nota ya en la mano, se
 * escribe su carrusel, y se escribe a partir de la nota y sus fuentes, no de la
 * noticia cruda. Asi toda nota tiene su carrusel y todo carrusel su nota.
 *
 * El agente de angulo no interviene: la nota ya decidio como se cuenta el
 * hecho. El angulo que se guarda es solo el enlace que el resto del pipeline de
 * redes necesita (piezas y buzon cuelgan de un angulo), y lleva el resumen.
 *
 * Las cuentas sin portal (Plogy) siguen con el flujo de redes de siempre.
 */

/** Solo las notas de las ultimas 24 horas: lo viejo no se rescata. */
const VENTANA_MS = 24 * 3600_000
const MAX_TEXTO = 9000

export async function cuentasConPortal(ids: string[]): Promise<Set<string>> {
  const con = new Set<string>()
  for (const id of ids) if (await conexionWeb(id)) con.add(id)
  return con
}

type Seccion = { titulo?: string | null; parrafos?: string[] | null }
type Payload = { titular?: string; resumen?: string; entrada?: Seccion; secciones?: Seccion[] }
type Fuente = { medio?: string | null; titulo?: string | null }

/** La nota en texto plano para el agente: titular, resumen, cuerpo y fuentes. */
export function textoDeLaNota(payload: Payload, fuentes: Fuente[] | null): string {
  const partes: string[] = []
  if (payload.resumen) partes.push(`RESUMEN: ${payload.resumen}`)
  for (const s of [payload.entrada, ...(payload.secciones ?? [])]) {
    if (!s) continue
    if (s.titulo) partes.push(`## ${s.titulo}`)
    partes.push(...(s.parrafos ?? []))
  }
  const medios = [...new Set((fuentes ?? []).map((f) => f.medio).filter(Boolean))]
  if (medios.length) partes.push(`FUENTES CONSULTADAS: ${medios.join(", ")}`)
  return partes.join("\n\n").slice(0, MAX_TEXTO)
}

/**
 * Encola el carrusel de cada nota ya publicada en el portal que aun no lo
 * tiene. Devuelve cuantos encolo.
 */
export async function encolarCarruselesDelPortal(accountId: string, variables: Variables): Promise<number> {
  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from("news_redacciones")
    .select("raw_news_id, titular, payload, fuentes, web_url")
    .eq("account_id", accountId)
    .eq("status", "redactada")
    .not("web_url", "is", null)
    .gte("redactada_at", new Date(Date.now() - VENTANA_MS).toISOString())
    .order("redactada_at", { ascending: true })
    .limit(40)
  const notas = (data ?? []) as { raw_news_id: string; titular: string | null; payload: Payload; fuentes: Fuente[] | null; web_url: string }[]
  if (notas.length === 0) return 0

  // Las que ya tienen angulo ya entraron (o salieron) del pipeline de redes.
  const { data: conAngulo } = await supabase
    .from("content_angles")
    .select("raw_news_id")
    .in("raw_news_id", notas.map((n) => n.raw_news_id))
  const yaEntraron = new Set(((conAngulo ?? []) as { raw_news_id: string }[]).map((a) => a.raw_news_id))

  let encoladas = 0
  for (const nota of notas.filter((n) => !yaEntraron.has(n.raw_news_id))) {
    const { data: news } = await supabase.from("raw_news").select("*").eq("id", nota.raw_news_id).maybeSingle()
    if (!news) continue
    const titular = nota.titular ?? nota.payload.titular ?? (news as RawNews).title

    const { data: angulo, error } = await supabase
      .from("content_angles")
      .insert({
        account_id: accountId,
        raw_news_id: nota.raw_news_id,
        angle: nota.payload.resumen ?? titular,
        thesis: null,
        playbook_format: "portal",
        status: "pending_generation",
      })
      .select("*")
      .single()
    if (error || !angulo) throw new Error(`No se pudo crear el enlace del carrusel: ${error?.message}`)

    await enqueueInstagramJob(angulo as ContentAngle, news as RawNews, variables, null, ["instagram", "facebook"], {
      titular,
      texto: textoDeLaNota(nota.payload, nota.fuentes),
      url: nota.web_url,
    })
    encoladas++
  }
  return encoladas
}

/** El link de la nota del portal de una noticia, si ya esta publicada. */
export async function linkDeLaNota(rawNewsId: string | null): Promise<string | null> {
  if (!rawNewsId) return null
  const { data } = await supabaseAdmin().from("news_redacciones").select("web_url").eq("raw_news_id", rawNewsId).maybeSingle()
  return (data as { web_url: string | null } | null)?.web_url ?? null
}
