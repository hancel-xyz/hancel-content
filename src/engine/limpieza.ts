import { supabaseAdmin } from "./supabase-admin"

const BUCKET = "carousels"
/** Nada se guarda: las imagenes se borran en cuanto lo publicado salio en todas sus redes. */
const DIAS = 0
/** Lo que nunca se publico (descartado, fallido): se borra pasado un dia. */
const DIAS_SIN_PUBLICAR = 1
/** Lo que lleva mas de esto en cola sin publicarse ya es prensa vieja: se descarta. */
const DIAS_EN_COLA = 2
/** Carpetas por pasada: la limpieza no debe comerse el tiempo del tick. */
const POR_PASADA = 25

/**
 * Borra las imagenes de lo que ya se publico, y saca de la cola lo que se quedo
 * esperando mas de dos dias (sus archivos se borran en la pasada siguiente).
 *
 * Instagram y Facebook guardan su propia copia al publicar, asi que las
 * laminas (PNG), su copia en JPEG y el HTML del Estudio dejan de hacer falta.
 * Sin esto el almacenamiento crece unos cientos de MB al dia y el plan se
 * queda sin espacio (paso en Supabase y en InsForge). Las fotos de las noticias
 * redactadas no se tocan: el portal las sigue mostrando.
 *
 * Un carrusel de noticias se limpia en cuanto todas sus piezas (una por red)
 * salieron; lo descartado o fallido, al dia siguiente. Cada pieza limpia queda marcada en su payload (`archivos_borrados`)
 * para no volver a mirarla.
 */
export async function limpiarPublicados(): Promise<{ carpetas: number; archivos: number; errores: string[] }> {
  const s = supabaseAdmin()
  const st = s.storage.from(BUCKET)
  const antes = new Date(Date.now() - DIAS * 86400_000).toISOString()
  const errores: string[] = []
  let carpetas = 0
  let archivos = 0

  const vaciar = async (carpeta: string) => {
    const { data, error } = await st.list(carpeta)
    if (error) throw new Error(error.message)
    const rutas = (data ?? []).map((f: { name: string }) => `${carpeta}/${f.name}`)
    if (rutas.length) {
      const r = await st.remove(rutas)
      if (r.error) throw new Error(r.error.message)
    }
    archivos += rutas.length
  }

  // La cola vieja del estudio: piezas generadas que nunca salieron ocupaban
  // espacio para siempre (asi se lleno InsForge). Los carruseles de noticias no
  // se descartan: todo lo que se redacta sale el mismo dia (ver el tick).
  const enCola = new Date(Date.now() - DIAS_EN_COLA * 86400_000).toISOString()
  {
    const r = await s.from("studio_pieces").update({ status: "failed" }).eq("status", "generated").lt("created_at", enCola)
    if (r.error) errores.push(`cola del estudio: ${r.error.message}`)
  }

  // Noticias: por carrusel (job de Instagram), cuando todas sus piezas salieron.
  const { data: piezas } = await s
    .from("content_pieces")
    .select("id, job_instagram_id, payload")
    .eq("status", "published")
    .lt("published_at", antes)
    .not("job_instagram_id", "is", null)
    .is("payload->archivos_borrados", null)
    .limit(200)
  const porJob = new Map<string, { id: string; payload: Record<string, unknown> }[]>()
  for (const p of (piezas ?? []) as { id: string; job_instagram_id: string; payload: Record<string, unknown> }[]) {
    porJob.set(p.job_instagram_id, [...(porJob.get(p.job_instagram_id) ?? []), p])
  }
  for (const [job, lista] of [...porJob].slice(0, POR_PASADA)) {
    try {
      const { count } = await s
        .from("content_pieces")
        .select("id", { count: "exact", head: true })
        .eq("job_instagram_id", job)
        .not("status", "in", "(published,discarded,rejected)")
      if ((count ?? 0) > 0) continue
      await vaciar(job)
      await vaciar(`jpeg/${job}`)
      const marca = new Date().toISOString()
      for (const p of lista) await s.from("content_pieces").update({ payload: { ...p.payload, archivos_borrados: marca } }).eq("id", p.id)
      carpetas++
    } catch (e) {
      errores.push(`noticia ${job}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Estudio: la pieza publicada en todas sus redes.
  const { data: estudio } = await s
    .from("studio_pieces")
    .select("id, account_id, payload")
    .eq("status", "published")
    .lt("published_at", antes)
    .is("payload->archivos_borrados", null)
    .limit(POR_PASADA)
  for (const p of (estudio ?? []) as { id: string; account_id: string; payload: Record<string, unknown> | null }[]) {
    try {
      await vaciar(`studio/${p.account_id}/${p.id}`)
      await s.from("studio_pieces").update({ payload: { ...(p.payload ?? {}), archivos_borrados: new Date().toISOString() } }).eq("id", p.id)
      carpetas++
    } catch (e) {
      errores.push(`estudio ${p.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Lo que no se va a publicar: piezas descartadas o fallidas, y sus archivos.
  const viejo = new Date(Date.now() - DIAS_SIN_PUBLICAR * 86400_000).toISOString()
  const { data: muertas } = await s
    .from("content_pieces")
    .select("id, job_instagram_id, payload")
    .in("status", ["discarded", "rejected", "failed"])
    .lt("created_at", viejo)
    .not("job_instagram_id", "is", null)
    .is("payload->archivos_borrados", null)
    .limit(POR_PASADA)
  for (const p of (muertas ?? []) as { id: string; job_instagram_id: string; payload: Record<string, unknown> }[]) {
    try {
      const { count } = await s.from("content_pieces").select("id", { count: "exact", head: true }).eq("job_instagram_id", p.job_instagram_id).in("status", ["generated", "approved", "publishing"])
      if ((count ?? 0) === 0) {
        await vaciar(p.job_instagram_id)
        await vaciar(`jpeg/${p.job_instagram_id}`)
        carpetas++
      }
      await s.from("content_pieces").update({ payload: { ...p.payload, archivos_borrados: new Date().toISOString() } }).eq("id", p.id)
    } catch (e) {
      errores.push(`descartada ${p.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const { data: fallidas } = await s
    .from("studio_pieces")
    .select("id, account_id, payload")
    .in("status", ["failed", "discarded"])
    .lt("created_at", viejo)
    .is("payload->archivos_borrados", null)
    .limit(POR_PASADA)
  for (const p of (fallidas ?? []) as { id: string; account_id: string; payload: Record<string, unknown> | null }[]) {
    try {
      await vaciar(`studio/${p.account_id}/${p.id}`)
      await s.from("studio_pieces").update({ payload: { ...(p.payload ?? {}), archivos_borrados: new Date().toISOString() } }).eq("id", p.id)
      carpetas++
    } catch (e) {
      errores.push(`estudio fallida ${p.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { carpetas, archivos, errores }
}
