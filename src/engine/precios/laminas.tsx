import { ImageResponse } from "next/og"

import { cargarFuente } from "../render/fonts"
import { ALTO, ANCHO } from "../render/theme"
import type { ListaPrecios, PrecioProducto } from "./sandia"
import { FUENTE, fechaEtiqueta, nombreCentral, pesos, porcentajeAbs, titular } from "./textos"

/**
 * Las laminas de los carruseles de precios de una central.
 *
 * Minimalistas: fondo blanco, tipografia grotesca grande en dos tonos (negro y
 * gris), etiquetas en monoespaciada y lineas finas. Nada de tarjetas ni
 * botones. El unico color es el verde de "¡Atención!" y el de los indicadores
 * (verde si subio, rojo si bajo).
 *
 *   portada  la central y su ciudad en grande, y los dos que mas subieron y
 *            los dos que mas bajaron.
 *   lista    todos los productos, en orden alfabetico, como mucho
 *            `POR_LAMINA` por lamina: foto, nombre, central, precio por kilo
 *            y cuanto subio o bajo.
 *   cierre   la invitacion al portal de precios. Cambia segun la red: en
 *            Instagram el link va en la descripcion; en Facebook, en el
 *            primer comentario.
 *
 * Satori solo entiende flexbox: todo div con hijos lleva `display: flex`.
 */

/** Productos en cada lamina de lista, como mucho. */
export const POR_LAMINA = 8
/** Instagram admite hasta 20 laminas: portada + 18 de lista + cierre. */
const MAX_LISTAS = 18
/** Con muchisimos productos se aprietan hasta este numero por lamina. */
const MAX_POR_LAMINA = 10

const BLANCO = "#FFFFFF"
const TINTA = "#0A0A0A"
const GRIS = "#8A8A8A"
const GRIS_CLARO = "#BDBDBD"
const LINEA = "#E8E8E8"
const VERDE = "#15A04A"
const ROJO = "#DB3A2E"

const SANS = "Inter"
const MONO = "JetBrains Mono"
const M = 72

export type Red = "instagram" | "facebook"

export type DatosLaminas = {
  lista: ListaPrecios
  /** Logo oscuro de la cuenta (para fondo claro), ya descargado (data URI). */
  logo: string | null
  /** Imagen de cada producto, ya reducida (data URI), por slug. */
  imagenes: Record<string, string | null>
  /** El portal de precios, sin protocolo: "usesandia.com". */
  dominio: string
}

/**
 * Reparte los productos en laminas de lista, como mucho `POR_LAMINA` en cada
 * una y parejas: 35 productos son 5 laminas de 7, no 4 de 8 y una de 3.
 */
export function repartir(productos: PrecioProducto[]): PrecioProducto[][] {
  let por = POR_LAMINA
  if (Math.ceil(productos.length / por) > MAX_LISTAS) por = Math.min(MAX_POR_LAMINA, Math.ceil(productos.length / MAX_LISTAS))
  const todos = productos.slice(0, por * MAX_LISTAS)
  const laminas = Math.ceil(todos.length / por)
  const grupos: PrecioProducto[][] = []
  let desde = 0
  for (let i = 0; i < laminas; i++) {
    const cuantos = Math.ceil((todos.length - desde) / (laminas - i))
    grupos.push(todos.slice(desde, desde + cuantos))
    desde += cuantos
  }
  return grupos
}

/** Cuantas laminas tiene el carrusel: portada, las de lista y el cierre. */
export const totalLaminas = (l: ListaPrecios) => repartir(l.productos).length + 2

// ------------------------------------------------------------------ piezas

function Triangulo({ sube, lado, color }: { sube: boolean; lado: number; color: string }) {
  return (
    <svg width={lado} height={lado} viewBox="0 0 10 10">
      <path d={sube ? "M5 1 L9.5 9 L0.5 9 Z" : "M5 9 L9.5 1 L0.5 1 Z"} fill={color} />
    </svg>
  )
}

function Foto({ src, nombre, lado }: { src: string | null | undefined; nombre: string; lado: number }) {
  if (!src) return <div style={{ display: "flex", width: lado, height: lado, alignItems: "center", justifyContent: "center", fontFamily: SANS, fontWeight: 600, fontSize: lado * 0.45, color: GRIS_CLARO, flexShrink: 0 }}>{nombre.slice(0, 1)}</div>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={lado} height={lado} style={{ width: lado, height: lado, objectFit: "contain", flexShrink: 0 }} />
}

function Logo({ src, alto }: { src: string | null; alto: number }) {
  // El logo de Indice Agro es apaisado (2,08:1).
  const ancho = Math.round(alto * 2.08)
  if (!src) return <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: alto * 0.42, lineHeight: 1, color: TINTA }}>ÍNDICE AGRO</div>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={ancho} height={alto} style={{ width: ancho, height: alto, objectFit: "contain", objectPosition: "left center" }} />
}

/** Etiquetas en monoespaciada: "[CORABASTOS][25 NOV 2026]". */
function Mono({ children, tam = 20, color = GRIS }: { children: string; tam?: number; color?: string }) {
  return <div style={{ display: "flex", fontFamily: MONO, fontWeight: 400, fontSize: tam, letterSpacing: 1, color, textTransform: "uppercase" }}>{children}</div>
}

function Lamina({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", position: "relative", width: ANCHO, height: ALTO, background: BLANCO, color: TINTA, fontFamily: SANS, overflow: "hidden" }}>{children}</div>
}

/** Arriba: el logo a la izquierda y etiquetas a la derecha. */
function Cabeza({ logo, derecha, alto = 46 }: { logo: string | null; derecha: string[]; alto?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: `60px ${M}px 0` }}>
      <Logo src={logo} alto={alto} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        {derecha.map((t) => (
          <Mono key={t}>{t}</Mono>
        ))}
      </div>
    </div>
  )
}

/** Abajo: la fuente y la pagina. */
function Pie({ n, total, extra }: { n: number; total: number; extra?: string }) {
  return (
    <div style={{ display: "flex", position: "absolute", left: M, right: M, bottom: 54, justifyContent: "space-between", alignItems: "center" }}>
      <Mono tam={18}>{`Fuente: ${FUENTE}`}</Mono>
      <Mono tam={18} color={TINTA}>{`${extra ? `${extra}   ` : ""}${String(n).padStart(2, "0")}/${String(total).padStart(2, "0")}`}</Mono>
    </div>
  )
}

/** Cuanto cambio un precio: "▲ 23,6 %" en verde, "▼ 20,3 %" en rojo o "Sin cambio". */
function Cambio({ p, tam }: { p: number | null; tam: number }) {
  if (p === null) return <div style={{ display: "flex", fontWeight: 400, fontSize: tam, color: GRIS_CLARO }}>Sin dato anterior</div>
  if (Math.abs(p) < 0.05) return <div style={{ display: "flex", fontWeight: 400, fontSize: tam, color: GRIS }}>Sin cambio</div>
  const sube = p > 0
  const color = sube ? VERDE : ROJO
  return (
    <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: tam, color }}>
      <div style={{ display: "flex", marginRight: 8 }}>
        <Triangulo sube={sube} lado={Math.round(tam * 0.55)} color={color} />
      </div>
      {porcentajeAbs(p)}
    </div>
  )
}

/** El tamano de un texto para que quepa en `ancho` (aproximado: ~0,58 em por letra en Inter). */
const ajustar = (texto: string, ancho: number, max: number) => Math.min(max, Math.floor(ancho / (texto.length * 0.58)))

// ------------------------------------------------------------------ portada

function Portada({ d, total }: { d: DatosLaminas; total: number }) {
  const l = d.lista
  const c = nombreCentral(l.central)
  const tam = ajustar(c.titulo, ANCHO - 2 * M, 176)
  const hoy = l.periodo === "dia"
  const columna = (ANCHO - 2 * M - 56) / 2
  return (
    <Lamina>
      <Cabeza logo={d.logo} derecha={["[Precios][Mayoristas]", "[Por kilo][COP]"]} alto={60} />

      <div style={{ display: "flex", alignItems: "center", padding: `150px ${M}px 0`, fontSize: 30, fontWeight: 600 }}>
        <div style={{ display: "flex", color: VERDE }}>¡Atención!</div>
        <div style={{ display: "flex", marginLeft: 12 }}>{titular(l)}</div>
        <div style={{ display: "flex", marginLeft: 12, fontWeight: 400, color: GRIS }}>{`· ${hoy ? fechaEtiqueta(l.referencia).toLowerCase() : "lunes a viernes"}`}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: `18px ${M}px 0` }}>
        <div style={{ display: "flex", fontWeight: 600, fontSize: tam, lineHeight: 1, letterSpacing: -tam * 0.05 }}>{c.titulo}</div>
        <div style={{ display: "flex", fontWeight: 600, fontSize: tam, lineHeight: 1.04, letterSpacing: -tam * 0.05, color: GRIS_CLARO }}>{`${l.central.ciudad}.`}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", padding: `40px ${M}px 0` }}>
        <div style={{ display: "flex", width: 420, fontSize: 27, lineHeight: 1.4, color: TINTA }}>
          {`¿Subió o bajó lo suyo? Busque su producto entre los ${l.productos.length} precios por kilo de hoy.`}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", position: "absolute", left: M, right: M, top: 880 }}>
        <Movidos titulo="Más subieron" productos={l.subieron} imagenes={d.imagenes} ancho={columna} />
        <Movidos titulo="Más bajaron" productos={l.bajaron} imagenes={d.imagenes} ancho={columna} />
      </div>

      <Pie n={1} total={total} extra="Desliza →" />
    </Lamina>
  )
}

function Movidos({ titulo, productos, imagenes, ancho }: { titulo: string; productos: PrecioProducto[]; imagenes: Record<string, string | null>; ancho: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: ancho }}>
      <div style={{ display: "flex", paddingBottom: 14, borderBottom: `2px solid ${TINTA}` }}>
        <Mono tam={19} color={TINTA}>{titulo}</Mono>
      </div>
      {productos.length === 0 ? (
        <div style={{ display: "flex", paddingTop: 24, fontSize: 24, color: GRIS }}>Ninguno hoy</div>
      ) : (
        productos.map((p) => (
          <div key={p.producto} style={{ display: "flex", alignItems: "center", height: 132, borderBottom: `1px solid ${LINEA}` }}>
            <Foto src={imagenes[p.producto]} nombre={p.nombre} lado={84} />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 18, flex: 1 }}>
              <div style={{ display: "flex", fontWeight: 600, fontSize: p.nombre.length > 16 ? 24 : 28, letterSpacing: -0.4, lineHeight: 1.15 }}>{p.nombre}</div>
              <div style={{ display: "flex", marginTop: 4, fontSize: 23, color: GRIS }}>{`${pesos(p.precio)} /kg`}</div>
            </div>
            <Cambio p={p.porcentaje} tam={28} />
          </div>
        ))
      )}
    </div>
  )
}

// -------------------------------------------------------------------- lista

function Lista({ d, grupo, n, total }: { d: DatosLaminas; grupo: PrecioProducto[]; n: number; total: number }) {
  const l = d.lista
  const c = nombreCentral(l.central)
  // Las filas llenan el alto disponible (con pocos productos, sin pasar de 124 px).
  const alto = Math.min(124, Math.floor(880 / grupo.length))
  const lado = Math.min(84, alto - 30)
  const primero = grupo[0]?.nombre ?? ""
  const ultimo = grupo[grupo.length - 1]?.nombre ?? ""
  return (
    <Lamina>
      <Cabeza logo={d.logo} derecha={[`[${c.titulo}][${fechaEtiqueta(l.referencia)}]`]} />

      <div style={{ display: "flex", flexDirection: "column", padding: `52px ${M}px 0` }}>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 64, letterSpacing: -2.6, lineHeight: 1.02 }}>{titular(l)}</div>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 64, letterSpacing: -2.6, lineHeight: 1.02, color: GRIS_CLARO }}>{`${primero} — ${ultimo}`}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: `34px ${M}px 0` }}>
        <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 12, borderBottom: `2px solid ${TINTA}` }}>
          <Mono tam={18}>Producto</Mono>
          <Mono tam={18}>Precio por kilo · cambio</Mono>
        </div>
        {grupo.map((p) => (
          <div key={p.producto} style={{ display: "flex", alignItems: "center", height: alto, borderBottom: `1px solid ${LINEA}` }}>
            <Foto src={d.imagenes[p.producto]} nombre={p.nombre} lado={lado} />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 22, flex: 1 }}>
              <div style={{ display: "flex", fontWeight: 600, fontSize: p.nombre.length > 22 ? 30 : 34, letterSpacing: -0.6, lineHeight: 1.1 }}>{p.nombre}</div>
              <div style={{ display: "flex", marginTop: 4, fontSize: 22, color: GRIS }}>{`${c.titulo} · ${l.central.ciudad}`}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontWeight: 600, fontSize: 36, letterSpacing: -0.8 }}>{pesos(p.precio)}</div>
              <div style={{ display: "flex", marginTop: 2 }}>
                <Cambio p={p.porcentaje} tam={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Pie n={n} total={total} />
    </Lamina>
  )
}

// ------------------------------------------------------------------- cierre

function Cierre({ d, total, red }: { d: DatosLaminas; total: number; red: Red }) {
  const l = d.lista
  const c = nombreCentral(l.central)
  const tamDominio = ajustar(d.dominio, ANCHO - 2 * M, 88)
  return (
    <Lamina>
      <Cabeza logo={d.logo} derecha={["[Portal][De precios]", "[Todas las centrales]"]} />

      <div style={{ display: "flex", flexDirection: "column", padding: `250px ${M}px 0` }}>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 104, letterSpacing: -5, lineHeight: 1.02 }}>¿Y el precio de</div>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 104, letterSpacing: -5, lineHeight: 1.02 }}>lo que usted</div>
        <div style={{ display: "flex", fontWeight: 600, fontSize: 104, letterSpacing: -5, lineHeight: 1.02, color: GRIS_CLARO }}>compra o vende?</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: `70px ${M}px 0` }}>
        <Mono tam={20}>Consúltelo en el portal de precios</Mono>
        <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 14, paddingBottom: 6, borderBottom: `4px solid ${TINTA}`, fontWeight: 600, fontSize: tamDominio, letterSpacing: -tamDominio * 0.04, lineHeight: 1.05 }}>{d.dominio}</div>
        <div style={{ display: "flex", marginTop: 22 }}>
          <Mono tam={22} color={TINTA}>{red === "instagram" ? "[↓ Link en la descripción]" : "[↓ Link en el primer comentario]"}</Mono>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", padding: `70px ${M}px 0` }}>
        <div style={{ display: "flex", flexDirection: "column", width: 440, fontSize: 26, lineHeight: 1.4 }}>
          <div style={{ display: "flex" }}>{`Publicamos los precios de ${c.texto} cada día. Síganos y guarde este post.`}</div>
          <div style={{ display: "flex", marginTop: 16, color: GRIS }}>¿Qué precio quiere que revisemos? Escríbanos.</div>
        </div>
      </div>

      <Pie n={total} total={total} />
    </Lamina>
  )
}

// ------------------------------------------------------------------- render

async function dibujar(vista: React.ReactElement): Promise<Buffer> {
  const fuentes = [...(await cargarFuente("Inter")), ...(await cargarFuente("JetBrainsMono"))]
  const r = new ImageResponse(vista, { width: ANCHO, height: ALTO, fonts: fuentes })
  return Buffer.from(await r.arrayBuffer())
}

/**
 * Todas las laminas. La ultima cambia segun la red (el link esta en la
 * descripcion en Instagram y en el primer comentario en Facebook), asi que se
 * dibuja dos veces; las demas son las mismas para las dos.
 */
export async function dibujarCarrusel(d: DatosLaminas): Promise<{ comunes: Buffer[]; cierreInstagram: Buffer; cierreFacebook: Buffer }> {
  const grupos = repartir(d.lista.productos)
  const total = grupos.length + 2
  const comunes: Buffer[] = [await dibujar(<Portada d={d} total={total} />)]
  for (const [i, g] of grupos.entries()) comunes.push(await dibujar(<Lista d={d} grupo={g} n={i + 2} total={total} />))
  return {
    comunes,
    cierreInstagram: await dibujar(<Cierre d={d} total={total} red="instagram" />),
    cierreFacebook: await dibujar(<Cierre d={d} total={total} red="facebook" />),
  }
}
