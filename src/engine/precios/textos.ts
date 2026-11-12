import type { Direccion, Movimiento, Ranking } from "./sandia"

/**
 * Las palabras de los carruseles de precios: fechas, cifras y los textos de
 * Instagram y Facebook. Todo por plantilla, sin IA: los datos son los que son
 * y se dicen igual cada dia.
 */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

function partes(fecha: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = fecha.slice(0, 10).split("-").map(Number)
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** "2026-11-11" -> "miércoles" */
export const diaSemana = (fecha: string) => DIAS[partes(fecha).dow]

/** "2026-11-11" -> "miércoles 11 de noviembre" */
export function fechaLarga(fecha: string): string {
  const p = partes(fecha)
  return `${DIAS[p.dow]} ${p.d} de ${MESES[p.m - 1]}`
}

/** "2026-11-11" -> "11 nov" */
export function fechaCorta(fecha: string): string {
  const p = partes(fecha)
  return `${p.d} ${MESES[p.m - 1].slice(0, 3)}`
}

/** "2026-11-11" -> "MIÉ 11 NOV", para las etiquetas de precio. */
export function etiquetaDia(fecha: string): string {
  const p = partes(fecha)
  return `${DIAS[p.dow].slice(0, 3)} ${p.d} ${MESES[p.m - 1].slice(0, 3)}`.toUpperCase()
}

/** Dias entre dos fechas (b - a). */
export function diasEntre(a: string, b: string): number {
  const pa = partes(a)
  const pb = partes(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000)
}

/** Como se nombra el dia de los precios visto desde hoy: "hoy", "ayer" o "el viernes". */
export function cuando(fecha: string, hoy: string): string {
  const d = diasEntre(fecha, hoy)
  if (d === 0) return "hoy"
  if (d === 1) return "ayer"
  return `el ${diaSemana(fecha)}`
}

/** 3387 -> "$3.387" */
export function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`
}

/** 41.67 -> "+41,7%"; -29.14 -> "−29,1%" */
export function porcentaje(p: number): string {
  const v = Math.abs(p).toFixed(1).replace(".", ",").replace(/,0$/, "")
  return `${p >= 0 ? "+" : "−"}${v}%`
}

/** "Mercasa · Pereira", sin repetir cuando la central se llama como la ciudad. */
export function lugar(m: Movimiento): string {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
  return norm(m.central) === norm(m.ciudad) || norm(m.central).includes(norm(m.ciudad)) ? m.central : `${m.central} · ${m.ciudad}`
}

/** El rango de la semana: "9 al 13 de noviembre". */
export function rangoSemana(r: Ranking): string {
  if (!r.lunes || !r.viernes) return fechaLarga(r.referencia)
  const a = partes(r.lunes)
  const b = partes(r.viernes)
  return a.m === b.m ? `${a.d} al ${b.d} de ${MESES[b.m - 1]}` : `${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`
}

const verbo = (d: Direccion) => (d === "subieron" ? "subieron" : "bajaron")

const HASHTAGS = "#preciosagricolas #agrocolombia #centralesdeabastos #preciosmayoristas #campocolombiano"

/**
 * El texto del post. Instagram lleva el link en la descripcion; Facebook lo
 * deja en el primer comentario, que es donde no le resta alcance.
 */
export function textoDelPost(r: Ranking, red: "instagram" | "facebook", link: string, hoy: string): string {
  const icono = r.direccion === "subieron" ? "📈" : "📉"
  const dominio = link.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const encabezado =
    r.periodo === "dia"
      ? `${icono} ${capital(fechaLarga(r.referencia))}: estos son los 5 productos que más ${verbo(r.direccion)} de precio ${cuando(r.referencia, hoy)} en las centrales de abastos de Colombia.`
      : `${icono} Resumen de la semana del ${rangoSemana(r)}: los 5 productos que más ${verbo(r.direccion)} de precio en las centrales de abastos de Colombia.`

  const lista = r.productos
    .map((m, i) => `${i + 1}. ${m.nombre}: ${porcentaje(m.porcentaje)} en ${lugar(m).replace(/ · (.+)$/, " ($1)")}. Pasó de ${pesos(m.antes)} a ${pesos(m.ahora)} el kilo.`)
    .join("\n")

  const t = r.totales
  const balance = `En total, de ${t.evaluados} precios ${r.periodo === "dia" ? "reportados" : "de la semana"}, ${t.subieron} subieron, ${t.bajaron} bajaron y ${t.estables} se mantuvieron.`

  const cierre =
    red === "instagram"
      ? `¿Buscas el precio de otro producto? Consulta todos los precios mayoristas en ${dominio} (link en la descripción): ${link}`
      : "¿Buscas el precio de otro producto? Consulta todos los precios mayoristas en el link del primer comentario."

  return [encabezado, lista, balance, cierre, "Precios por kilo en mercado mayorista. Fuente: Sandia.", HASHTAGS].join("\n\n")
}

/** El primer comentario de Facebook, con el link. */
export function comentarioFacebook(link: string): string {
  return `Consulta aquí el precio de todos los productos en las centrales de abastos: ${link}`
}

/** El titulo corto del carrusel, para el tablero. */
export function tituloCarrusel(r: Pick<Ranking, "periodo" | "direccion" | "referencia" | "lunes" | "viernes">): string {
  const que = r.direccion === "subieron" ? "Los 5 que más subieron" : "Los 5 que más bajaron"
  return r.periodo === "dia" ? `${que} · ${fechaLarga(r.referencia)}` : `${que} · semana del ${rangoSemana(r as Ranking)}`
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
