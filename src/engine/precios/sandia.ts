/**
 * Los precios de una central, de la API de precios (usesandia.com).
 *
 * Se pide `/precios/ultimos` filtrado por la central: trae el ultimo precio
 * por kilo de cada producto, el del reporte anterior y la variacion del dia y
 * de la semana (lunes a viernes). De ahi sale el carrusel: todos los productos
 * del ultimo dia, en orden alfabetico, y para la portada los dos que mas
 * subieron y los dos que mas bajaron.
 *
 * En las laminas y los textos la fuente es "Índice Agro": la API es solo de
 * donde se leen los datos.
 *
 * La clave va en `SANDIA_API_KEY` (plan interno, sin limite diario).
 */

import { diasEntre } from "./textos"

const BASE = "https://usesandia.com/api/v1"

export type Periodo = "dia" | "semana"

/** Por debajo de esto (en %) un precio se cuenta como estable. */
const UMBRAL_ESTABLE = 0.5

export type PrecioProducto = {
  /** Slug del producto. */
  producto: string
  nombre: string
  imagen: string | null
  /** Precio por kilo del dia (o del cierre de la semana). */
  precio: number
  /** Precio con el que se compara; null si no hay uno reciente. */
  anterior: number | null
  /** Variacion en %; null si no hay con que comparar. */
  porcentaje: number | null
}

export type ListaPrecios = {
  periodo: Periodo
  /** La fecha de los precios, o el lunes de la semana. */
  referencia: string
  /** Solo semana: el lunes y el viernes de la semana calendario. */
  lunes?: string
  viernes?: string
  central: { slug: string; nombre: string; ciudad: string }
  /** Todos los productos de la central, en orden alfabetico. */
  productos: PrecioProducto[]
  /** Los dos que mas subieron y los dos que mas bajaron, para la portada. */
  subieron: PrecioProducto[]
  bajaron: PrecioProducto[]
  totales: { subieron: number; bajaron: number; estables: number; evaluados: number }
}

type FilaApi = {
  fecha: string
  producto: string
  producto_nombre: string
  producto_imagen?: string | null
  central_nombre: string
  ciudad_nombre: string
  precio_kilo: number
  precio_anterior: number | null
  fecha_anterior: string | null
  variacion: { diferencia: number; porcentaje: number } | null
  variacion_semana: {
    lunes: string
    viernes: string
    precio_inicio: number
    precio_fin: number
    fecha_fin: string
    porcentaje: number
  } | null
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
  if (!r.ok) throw new Error(`La API de precios respondió ${r.status}: ${cuerpo?.error?.mensaje ?? "sin detalle"}`)
  return cuerpo
}

/** "Papa  criolla" -> "Papa criolla" */
const limpio = (t: string) => t.replace(/\s+/g, " ").trim()

/**
 * Arma la lista a partir de las filas de la API (de una sola central).
 * Separado de la llamada para poder probarlo con datos guardados.
 */
export function armarLista(filas: FilaApi[], periodo: Periodo, slug: string): ListaPrecios {
  if (filas.length === 0) throw new Error(`No hay precios de ${slug}.`)
  let elegidas: FilaApi[]
  let referencia: string
  let lunes: string | undefined
  let viernes: string | undefined

  if (periodo === "dia") {
    // El ultimo dia que reporto la central; los productos que no salieron ese dia no van.
    referencia = filas.reduce((m, f) => (f.fecha > m ? f.fecha : m), "")
    elegidas = filas.filter((f) => f.fecha === referencia)
  } else {
    elegidas = filas.filter((f) => f.variacion_semana)
    const s = elegidas[0]?.variacion_semana
    if (!s) throw new Error(`No hay precios de la semana en ${slug}.`)
    referencia = s.lunes
    lunes = s.lunes
    viernes = s.viernes
  }

  const productos: PrecioProducto[] = elegidas
    .map((f): PrecioProducto => {
      if (periodo === "semana") {
        const s = f.variacion_semana!
        return { producto: f.producto, nombre: limpio(f.producto_nombre), imagen: f.producto_imagen ?? null, precio: s.precio_fin, anterior: s.precio_inicio, porcentaje: s.porcentaje }
      }
      // La API compara con el reporte anterior de la central, que puede ser de
      // hace semanas si dejo de reportar ese producto: se aceptan hasta 4 dias
      // (fin de semana y un lunes festivo); si no, sale sin variacion.
      const reciente = f.variacion && f.fecha_anterior && diasEntre(f.fecha_anterior, f.fecha) <= 4
      return {
        producto: f.producto,
        nombre: limpio(f.producto_nombre),
        imagen: f.producto_imagen ?? null,
        precio: f.precio_kilo,
        anterior: reciente ? f.precio_anterior : null,
        porcentaje: reciente ? f.variacion!.porcentaje : null,
      }
    })
    .filter((p) => p.precio > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))

  const conCambio = productos.filter((p) => p.porcentaje !== null)
  const subieron = conCambio.filter((p) => p.porcentaje! >= UMBRAL_ESTABLE)
  const bajaron = conCambio.filter((p) => p.porcentaje! <= -UMBRAL_ESTABLE)

  const f0 = elegidas[0] ?? filas[0]
  return {
    periodo,
    referencia,
    ...(lunes ? { lunes, viernes } : {}),
    central: { slug, nombre: f0.central_nombre, ciudad: f0.ciudad_nombre },
    productos,
    subieron: [...subieron].sort((a, b) => b.porcentaje! - a.porcentaje!).slice(0, 2),
    bajaron: [...bajaron].sort((a, b) => a.porcentaje! - b.porcentaje!).slice(0, 2),
    totales: { subieron: subieron.length, bajaron: bajaron.length, estables: conCambio.length - subieron.length - bajaron.length, evaluados: conCambio.length },
  }
}

/**
 * Todos los precios de una central: los del ultimo dia que reporto (`dia`) o
 * los de la ultima semana de lunes a viernes ya cerrada (`semana`).
 */
export async function traerLista(periodo: Periodo, central: string, opciones: { semana?: "auto" | "cerrada" } = {}): Promise<ListaPrecios> {
  const params: Record<string, string> = { central, dias_vigencia: periodo === "dia" ? "7" : "14" }
  if (periodo === "semana") params.semana = opciones.semana ?? "cerrada"
  const datos = (await pedir("/precios/ultimos", params)) as { datos?: FilaApi[] }
  return armarLista(datos.datos ?? [], periodo, central)
}
