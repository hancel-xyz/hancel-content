import type { ListaPrecios, PrecioProducto } from "./sandia"

/**
 * Las palabras de los carruseles de precios: fechas, cifras y los textos de
 * Instagram y Facebook. Todo por plantilla, sin IA: los datos son los que son
 * y se dicen igual cada dia.
 */

export const FUENTE = "Índice Agro"

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

function partes(fecha: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = fecha.slice(0, 10).split("-").map(Number)
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** "2026-11-11" -> "miércoles 11 de noviembre" */
export function fechaLarga(fecha: string): string {
  const p = partes(fecha)
  return `${DIAS[p.dow]} ${p.d} de ${MESES[p.m - 1]}`
}

/** "2026-11-25" -> "25 de noviembre de 2026" */
export function fechaConAno(fecha: string): string {
  const p = partes(fecha)
  return `${p.d} de ${MESES[p.m - 1]} de ${p.y}`
}

/** "2026-11-25" -> "25 NOV 2026", para las etiquetas. */
export function fechaEtiqueta(fecha: string): string {
  const p = partes(fecha)
  return `${p.d} ${MESES[p.m - 1].slice(0, 3)} ${p.y}`.toUpperCase()
}

/** Dias entre dos fechas (b - a). */
export function diasEntre(a: string, b: string): number {
  const pa = partes(a)
  const pb = partes(b)
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000)
}

/** 3387 -> "$3.387" */
export function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`
}

/** 23.6 -> "23,6 %" (sin signo: la flecha o la palabra dicen si subio o bajo). */
export function porcentajeAbs(p: number): string {
  return `${Math.abs(p).toFixed(1).replace(".", ",").replace(/,0$/, "")} %`
}

/** 23.6 -> "+23,6 %"; -20.3 -> "−20,3 %"; null -> "" */
export function porcentaje(p: number | null): string {
  if (p === null) return ""
  return `${p >= 0 ? "+" : "−"}${porcentajeAbs(p)}`
}

/** El rango de la semana: "9 al 13 de noviembre". */
export function rangoSemana(l: Pick<ListaPrecios, "referencia" | "lunes" | "viernes">): string {
  if (!l.lunes || !l.viernes) return fechaLarga(l.referencia)
  const a = partes(l.lunes)
  const b = partes(l.viernes)
  return a.m === b.m ? `${a.d} al ${b.d} de ${MESES[b.m - 1]}` : `${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`
}

/**
 * Como se nombra una central. `titulo` va grande en la portada; `texto` en los
 * posts, con el articulo si lo lleva.
 */
const NOMBRES: Record<string, { titulo: string; texto: string }> = {
  corabastos: { titulo: "Corabastos", texto: "Corabastos" },
  cma: { titulo: "La Mayorista", texto: "la Central Mayorista de Antioquia" },
  cavasa: { titulo: "Cavasa", texto: "Cavasa" },
  centroabastos: { titulo: "Centroabastos", texto: "Centroabastos" },
}

export function nombreCentral(c: ListaPrecios["central"]): { titulo: string; texto: string; conCiudad: string } {
  const n = NOMBRES[c.slug] ?? { titulo: c.nombre, texto: c.nombre }
  return { ...n, conCiudad: `${n.texto} (${c.ciudad})` }
}

/** "Precios de hoy" / "Precios de la semana". */
export const titular = (l: Pick<ListaPrecios, "periodo">) => (l.periodo === "dia" ? "Precios de hoy" : "Precios de la semana")

/** La fecha como va en la portada: "25 de noviembre de 2026" o "Semana del 16 al 20 de noviembre". */
export const fechaPortada = (l: ListaPrecios) => (l.periodo === "dia" ? fechaConAno(l.referencia) : `Semana del ${rangoSemana(l)}`)

const HASHTAGS = "#preciosagricolas #agrocolombia #centralesdeabastos #preciosmayoristas #campocolombiano"

const etiquetaCentral = (l: ListaPrecios) => `#${nombreCentral(l.central).titulo.toLowerCase().replace(/[^a-z]/g, "")}`

const linea = (p: PrecioProducto, sube: boolean) => `${sube ? "▲" : "▼"} ${p.nombre}: ${pesos(p.precio)}/kg (${sube ? "subió" : "bajó"} ${porcentajeAbs(p.porcentaje ?? 0)})`


/** "https://indiceagro.co/precios/co" -> "indiceagro.co/precios/co" */
export const dominioDe = (link: string) => link.replace(/^https?:\/\//, "").replace(/\/$/, "")

/**
 * El texto del post: el titular de la central, los dos que mas subieron y los
 * dos que mas bajaron, la invitacion a buscar el suyo, el balance y el portal.
 * Instagram lleva el link en la descripcion; Facebook lo deja en el primer
 * comentario, que es donde no le resta alcance.
 */
export function textoDelPost(l: ListaPrecios, red: "instagram" | "facebook", link: string): string {
  const c = nombreCentral(l.central)
  const cuando = l.periodo === "dia" ? capital(fechaLarga(l.referencia)) : `Semana del ${rangoSemana(l)}`
  const encabezado = `🚨 ¡Atención! ${titular(l)} en ${c.conCiudad} · ${cuando}.`

  const movidos = [
    l.subieron.length ? `Los que más subieron:\n${l.subieron.map((p) => linea(p, true)).join("\n")}` : "",
    l.bajaron.length ? `Los que más bajaron:\n${l.bajaron.map((p) => linea(p, false)).join("\n")}` : "",
  ].filter(Boolean)

  const busque = `👉 ¿Subió o bajó lo suyo? Deslice y busque su producto: ${l.productos.length} precios mayoristas por kilo, de la A a la Z.`

  const t = l.totales
  const balance = `En total, ${t.subieron} subieron, ${t.bajaron} bajaron y ${t.estables} se mantuvieron frente al ${l.periodo === "dia" ? "reporte anterior" : "lunes"}.`

  const portal =
    red === "instagram"
      ? `¿Y el precio de lo que usted compra o vende? Consulte todos los precios de ${c.texto} y de las demás centrales en ${dominioDe(link)} (link en la descripción): ${link}`
      : `¿Y el precio de lo que usted compra o vende? Consulte todos los precios de ${c.texto} y de las demás centrales en el link del primer comentario.`

  const cierre = `Publicamos los precios de ${c.texto} cada día: síganos y guarde este post.\n¿Qué precio quiere que revisemos? Escríbanos.`

  return [encabezado, ...movidos, busque, balance, portal, cierre, `Precio mayorista por kilo. Fuente: ${FUENTE}.`, `${HASHTAGS} ${etiquetaCentral(l)}`].join("\n\n")
}

/** El primer comentario de Facebook, con el link a la central. */
export function comentarioFacebook(link: string, l: Pick<ListaPrecios, "central">): string {
  return `📊 Consulte aquí todos los precios de hoy en ${nombreCentral(l.central).conCiudad}: ${link}`
}

/** El titulo corto del carrusel, para el tablero. */
export function tituloCarrusel(l: Pick<ListaPrecios, "periodo" | "referencia" | "lunes" | "viernes" | "central">): string {
  const donde = l.central ? ` en ${nombreCentral(l.central).titulo}` : ""
  return l.periodo === "dia" ? `${titular(l)}${donde} · ${fechaLarga(l.referencia)}` : `${titular(l)}${donde} · semana del ${rangoSemana(l)}`
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
