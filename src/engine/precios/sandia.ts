/**
 * Los movimientos de precios de la API de Sandia (usesandia.com).
 *
 * La API ya entrega el ranking calculado: los que mas subieron y los que mas
 * bajaron, del dia (ultima fecha con precios contra el reporte anterior) o de
 * la semana (primer precio de lunes a viernes contra el ultimo). Aqui solo se
 * pide, se deja en una forma comun para dia y semana, y se queda con cinco
 * productos distintos: el ranking es por producto y central, y el mismo
 * producto sale varias veces (la zanahoria en Pasto y en Neiva). De cada
 * producto se queda su movimiento mas fuerte.
 *
 * La clave va en `SANDIA_API_KEY` (plan interno, sin limite diario).
 */

import { diasEntre } from "./textos"

const BASE = "https://usesandia.com/api/v1"

export type Periodo = "dia" | "semana"
export type Direccion = "subieron" | "bajaron"

export type Movimiento = {
  producto: string
  nombre: string
  imagen: string | null
  categoria: string
  central: string
  ciudad: string
  antes: number
  ahora: number
  /** La fecha del precio de antes y la del de ahora (YYYY-MM-DD). */
  fechaAntes: string
  fechaAhora: string
  diferencia: number
  porcentaje: number
}

export type Ranking = {
  periodo: Periodo
  direccion: Direccion
  /** La fecha del dia de los precios, o el lunes de la semana. */
  referencia: string
  /** Solo semana: el lunes y el viernes de la semana calendario. */
  lunes?: string
  viernes?: string
  totales: { subieron: number; bajaron: number; estables: number; evaluados: number }
  productos: Movimiento[]
}

type FilaApi = {
  producto: string
  producto_nombre: string
  producto_imagen?: string | null
  categoria_nombre?: string
  central_nombre: string
  ciudad_nombre: string
  precio_kilo?: number
  precio_anterior?: number
  fecha?: string
  fecha_anterior?: string
  precio_inicio?: number
  precio_fin?: number
  fecha_inicio?: string
  fecha_fin?: string
  diferencia: number
  porcentaje: number
}

type BloqueApi = {
  fecha?: string
  lunes?: string
  viernes?: string
  total_evaluados: number
  totales: { subieron: number; bajaron: number; estables: number }
  subieron: FilaApi[]
  bajaron: FilaApi[]
}

export function sandiaConfigurada(): boolean {
  return Boolean(process.env.SANDIA_API_KEY?.trim())
}

async function pedir(ruta: string, params: Record<string, string>): Promise<unknown> {
  const clave = process.env.SANDIA_API_KEY?.trim()
  if (!clave) throw new Error("Falta SANDIA_API_KEY en las variables de entorno.")
  const url = `${BASE}${ruta}?${new URLSearchParams(params).toString()}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${clave}` }, signal: AbortSignal.timeout(30_000), cache: "no-store" })
  const cuerpo = (await r.json().catch(() => null)) as { error?: { mensaje?: string } } | null
  if (!r.ok) throw new Error(`Sandia respondió ${r.status}: ${cuerpo?.error?.mensaje ?? "sin detalle"}`)
  return cuerpo
}

function aMovimiento(f: FilaApi, periodo: Periodo): Movimiento {
  const dia = periodo === "dia"
  return {
    producto: f.producto,
    nombre: f.producto_nombre,
    imagen: f.producto_imagen ?? null,
    categoria: f.categoria_nombre ?? "",
    central: f.central_nombre,
    ciudad: f.ciudad_nombre,
    antes: Number(dia ? f.precio_anterior : f.precio_inicio),
    ahora: Number(dia ? f.precio_kilo : f.precio_fin),
    fechaAntes: String(dia ? f.fecha_anterior : f.fecha_inicio),
    fechaAhora: String(dia ? f.fecha : f.fecha_fin),
    diferencia: f.diferencia,
    porcentaje: f.porcentaje,
  }
}

/** Cinco productos distintos, cada uno con su movimiento mas fuerte (la lista ya viene ordenada). */
function cincoDistintos(filas: FilaApi[], periodo: Periodo): Movimiento[] {
  const vistos = new Set<string>()
  const salida: Movimiento[] = []
  for (const f of filas) {
    if (vistos.has(f.producto)) continue
    const m = aMovimiento(f, periodo)
    if (!(m.antes > 0) || !(m.ahora > 0)) continue
    // En el diario, la API compara cada central con su reporte anterior, que
    // puede ser de hace una semana si la central dejo de reportar. Eso no es
    // "lo que subio ayer": se aceptan hasta 4 dias (cubre el fin de semana y
    // un lunes festivo).
    if (periodo === "dia" && diasEntre(m.fechaAntes, m.fechaAhora) > 4) continue
    vistos.add(f.producto)
    salida.push(m)
    if (salida.length === 5) break
  }
  return salida
}

/**
 * Los dos rankings (subieron y bajaron) de un periodo.
 *
 *   dia     `fecha` opcional (YYYY-MM-DD); sin ella, la ultima con precios.
 *   semana  `semana`: "cerrada" (la ultima de lunes a viernes ya cerrada), o
 *           una fecha de esa semana.
 */
export async function traerRankings(
  periodo: Periodo,
  opciones: { fecha?: string; semana?: string } = {}
): Promise<Record<Direccion, Ranking>> {
  const params: Record<string, string> = { periodo, limite: "80" }
  if (periodo === "dia" && opciones.fecha) params.fecha = opciones.fecha
  if (periodo === "semana") params.semana = opciones.semana ?? "cerrada"
  const datos = (await pedir("/precios/movimientos", params)) as Partial<Record<Periodo, BloqueApi>>
  const bloque = datos[periodo]
  if (!bloque) throw new Error(`Sandia no devolvió el bloque "${periodo}".`)

  const referencia = periodo === "dia" ? bloque.fecha : bloque.lunes
  if (!referencia) throw new Error("Sandia no devolvió la fecha de los precios.")
  const totales = { ...bloque.totales, evaluados: bloque.total_evaluados }
  const armar = (direccion: Direccion): Ranking => ({
    periodo,
    direccion,
    referencia,
    ...(periodo === "semana" ? { lunes: bloque.lunes, viernes: bloque.viernes } : {}),
    totales,
    productos: cincoDistintos(bloque[direccion] ?? [], periodo),
  })
  return { subieron: armar("subieron"), bajaron: armar("bajaron") }
}
