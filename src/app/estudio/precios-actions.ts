"use server"

import { after } from "next/server"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { guardarAjustesPrecios } from "@/engine/precios/pipeline"
import { supabaseAdmin } from "@/engine/supabase-admin"
import { cuentaActual } from "@/lib/accounts"

/**
 * Las acciones del tablero de precios. Lo que tarda (dibujar, publicar) no
 * corre aqui: se le pide a la ruta del tick, que tiene cinco minutos, y la
 * accion responde de inmediato. El tablero se refresca solo.
 */

export type Resultado = { ok: true; aviso?: string } | { ok: false; error: string }

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

async function despertar(slug: string, params: Record<string, string>): Promise<boolean> {
  const secreto = process.env.INGEST_SECRET
  if (!secreto) return false
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (!host) return false
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const url = `${proto}://${host}/api/precios/tick?${new URLSearchParams({ cuenta: slug, ...params }).toString()}`
  after(async () => {
    try {
      await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secreto}` }, signal: AbortSignal.timeout(8_000) })
    } catch {
      // Se corta a proposito: la ruta sigue trabajando aunque nadie la espere.
    }
  })
  return true
}

export async function guardarActivoPrecios(activo: boolean): Promise<Resultado> {
  try {
    const cuenta = await cuentaActual()
    await guardarAjustesPrecios(cuenta.id, { activo })
    revalidatePath("/")
    return { ok: true, aviso: activo ? "Activado: los carruseles de precios se arman y publican solos." : "Pausado: no se arma ni se publica nada." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function guardarHorasPrecios(horaBajaron: string, horaSubieron: string): Promise<Resultado> {
  const a = horaBajaron.trim().padStart(5, "0")
  const b = horaSubieron.trim().padStart(5, "0")
  if (!HORA.test(a) || !HORA.test(b)) return { ok: false, error: "Las horas van como 13:00." }
  try {
    const cuenta = await cuentaActual()
    await guardarAjustesPrecios(cuenta.id, { horaBajaron: a, horaSubieron: b })
    revalidatePath("/")
    return { ok: true, aviso: `Guardado: bajaron a las ${a}, subieron a las ${b}.` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function armarPreciosAhora(periodo: "dia" | "semana"): Promise<Resultado> {
  const cuenta = await cuentaActual()
  if (!(await despertar(cuenta.slug, { armar: periodo }))) return { ok: false, error: "No se pudo llamar al motor (falta INGEST_SECRET)." }
  return { ok: true, aviso: `Armando los ${periodo === "dia" ? "diarios" : "semanales"} con los datos de Sandia: en un minuto aparecen en Listos.` }
}

async function delaCuenta(id: string) {
  const cuenta = await cuentaActual()
  const { data } = await supabaseAdmin().from("precios_carruseles").select("id, etapa").eq("id", id).eq("account_id", cuenta.id).maybeSingle()
  return { cuenta, fila: data as { id: string; etapa: string } | null }
}

export async function publicarPrecioAhora(id: string): Promise<Resultado> {
  const { cuenta, fila } = await delaCuenta(id)
  if (!fila) return { ok: false, error: "Ese carrusel no es de esta empresa." }
  if (fila.etapa === "publicado") return { ok: false, error: "Ya está publicado." }
  if (fila.etapa === "publicando") return { ok: false, error: "Se está publicando." }
  await supabaseAdmin().from("precios_carruseles").update({ etapa: "listo", intentos: 0, error: null, programado_para: new Date().toISOString() }).eq("id", id)
  if (!(await despertar(cuenta.slug, { publicar: id }))) return { ok: false, error: "No se pudo llamar al motor (falta INGEST_SECRET)." }
  revalidatePath("/")
  return { ok: true, aviso: "Publicando en Instagram y Facebook: tarda uno o dos minutos." }
}

export async function rehacerPrecio(id: string): Promise<Resultado> {
  const { cuenta, fila } = await delaCuenta(id)
  if (!fila) return { ok: false, error: "Ese carrusel no es de esta empresa." }
  if (fila.etapa === "publicado") return { ok: false, error: "Ya está publicado: no se rehace." }
  if (!(await despertar(cuenta.slug, { rehacer: id }))) return { ok: false, error: "No se pudo llamar al motor (falta INGEST_SECRET)." }
  return { ok: true, aviso: "Rehaciendo las láminas con los datos de Sandia: en un minuto se actualizan." }
}

export async function descartarPrecio(id: string): Promise<Resultado> {
  const { fila } = await delaCuenta(id)
  if (!fila) return { ok: false, error: "Ese carrusel no es de esta empresa." }
  if (fila.etapa === "publicado") return { ok: false, error: "Ya está publicado." }
  await supabaseAdmin().from("precios_carruseles").update({ etapa: "descartado", updated_at: new Date().toISOString() }).eq("id", id)
  revalidatePath("/")
  return { ok: true, aviso: "Descartado: no se publica." }
}

export async function recuperarPrecio(id: string): Promise<Resultado> {
  const { fila } = await delaCuenta(id)
  if (!fila) return { ok: false, error: "Ese carrusel no es de esta empresa." }
  if (fila.etapa !== "descartado" && fila.etapa !== "error") return { ok: false, error: "Solo se recupera uno descartado o con error." }
  await supabaseAdmin().from("precios_carruseles").update({ etapa: "listo", intentos: 0, error: null, updated_at: new Date().toISOString() }).eq("id", id)
  revalidatePath("/")
  return { ok: true, aviso: "De vuelta en Listos. Si ya pasó su hora, usa Publicar ahora." }
}
