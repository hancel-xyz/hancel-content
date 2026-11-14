import { ImageResponse } from "next/og"

import { cargarFuente } from "../render/fonts"
import { ALTO, ANCHO } from "../render/theme"
import type { Direccion, Movimiento, Ranking } from "./sandia"
import { cuando, etiquetaDia, fechaLarga, lugar, pesos, porcentaje, rangoSemana } from "./textos"
import { animarLamina, type Animacion, type CapaPng } from "./video"

/**
 * Las laminas de los carruseles de precios.
 *
 * Al reves de los de noticias, que son sobrios, estos tienen que parar el
 * scroll: fondo de color a sangre (rojo-naranja si subieron, verde-turquesa si
 * bajaron), la palabra que importa en un bloque amarillo, los productos
 * recortados y el porcentaje en una pegatina. Siete laminas: portada, una por
 * producto y la invitacion a consultar los demas precios.
 *
 * Satori solo entiende flexbox: todo div con hijos lleva `display: flex`.
 */

const AMARILLO = "#FFE14D"
const NEGRO = "#111111"

const TEMAS: Record<Direccion, { a: string; b: string; fuerte: string }> = {
  subieron: { a: "#FF1F4B", b: "#FF7A00", fuerte: "#E0002B" },
  bajaron: { a: "#00C46A", b: "#00A3C4", fuerte: "#00894A" },
}

const OSWALD = "Oswald"
const HERO = "HeroFont"

export type DatosLaminas = {
  ranking: Ranking
  /** Fecha local de hoy (YYYY-MM-DD): decide si se dice "hoy" o "ayer". */
  hoy: string
  /** Logo en blanco de la cuenta, ya descargado (data URI). */
  logo: string | null
  /** Imagen de cada producto, ya reducida (data URI), por slug. */
  imagenes: Record<string, string | null>
  dominio: string
  /**
   * Para animar: que capa dibujar. Sin capa sale la lamina entera (la imagen
   * fija). "fondo" es todo lo que no se mueve; cualquier otro nombre dibuja
   * solo ese elemento, en su sitio y sobre transparente.
   */
  capa?: string
}

/** Si un elemento se ve en la capa que se esta dibujando. */
function en(capa: string | undefined, nombre: string): React.CSSProperties {
  if (capa === undefined) return {}
  // Lo oculto va sin sombra: el desenfoque de una sombra es lo mas caro de dibujar.
  const oculto: React.CSSProperties = { opacity: 0, boxShadow: "none" }
  if (capa === "fondo") return nombre === "fondo" ? {} : oculto
  return nombre === capa ? {} : oculto
}

/** Si se dibuja de verdad (las fotos ocultas no se cargan: es lo que mas tarda). */
const ve = (capa: string | undefined, nombre: string) => capa === undefined || capa === nombre

/** El fondo de la lamina solo se pinta en la imagen fija y en la capa de fondo. */
const conFondo = (capa: string | undefined) => capa === undefined || capa === "fondo"

function Flecha({ dir, lado, color }: { dir: Direccion; lado: number; color: string }) {
  const d =
    dir === "subieron"
      ? "M50 4 L96 54 L68 54 L68 96 L32 96 L32 54 L4 54 Z"
      : "M50 96 L96 46 L68 46 L68 4 L32 4 L32 46 L4 46 Z"
  return (
    <svg width={lado} height={lado} viewBox="0 0 100 100">
      <path d={d} fill={color} />
    </svg>
  )
}

function FlechaDerecha({ lado, color }: { lado: number; color: string }) {
  return (
    <svg width={lado} height={lado} viewBox="0 0 100 100">
      <path d="M8 40 L58 40 L58 14 L96 50 L58 86 L58 60 L8 60 Z" fill={color} />
    </svg>
  )
}

function Img({ src, lado }: { src: string; lado: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={lado} height={lado} style={{ width: lado, height: lado, objectFit: "contain" }} />
}

function Logo({ src, alto, ancho }: { src: string | null; alto: number; ancho: number }) {
  if (!src) return <div style={{ display: "flex", width: ancho, height: alto }} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={ancho} height={alto} style={{ width: ancho, height: alto, objectFit: "contain", objectPosition: "left center" }} />
  )
}

function fondo(dir: Direccion, angulo = 150): React.CSSProperties {
  const t = TEMAS[dir]
  return { backgroundImage: `linear-gradient(${angulo}deg, ${t.a} 0%, ${t.b} 100%)` }
}

function Pagina({ n, total, capa, color = "rgba(255,255,255,0.85)" }: { n: number; total: number; capa?: string; color?: string }) {
  return <div style={{ display: "flex", position: "absolute", bottom: 40, right: 64, fontFamily: HERO, fontWeight: 600, fontSize: 26, color, ...en(capa, "fondo") }}>{`${n}/${total}`}</div>
}

// ------------------------------------------------------------------ portada

function Portada({ d }: { d: DatosLaminas }) {
  const r = d.ranking
  const dir = r.direccion
  const palabra = dir === "subieron" ? "SUBIERON" : "BAJARON"
  const tercera = r.periodo === "dia" ? cuando(r.referencia, d.hoy).toUpperCase() : "EN LA SEMANA"
  const kicker = r.periodo === "dia" ? `${fechaLarga(r.referencia)} · Centrales de abastos` : `Semana del ${rangoSemana(r)}`
  // Neutro: lo leen sobre todo productores, no compradores.
  const fomo = "Así cambiaron los precios en las centrales"
  const [p1, p2, p3, p4, p5] = r.productos
  const c = d.capa

  // El collage: el primero grande al centro, los demas alrededor.
  const sitios: { m: Movimiento | undefined; lado: number; left: number; top: number; principal?: boolean; capa: string }[] = [
    { m: p4, lado: 200, left: 70, top: 20, capa: "prod4" },
    { m: p5, lado: 190, left: 820, top: 40, capa: "prod5" },
    { m: p2, lado: 240, left: 40, top: 262, capa: "prod2" },
    { m: p3, lado: 230, left: 812, top: 276, capa: "prod3" },
    { m: p1, lado: 430, left: 325, top: 64, principal: true, capa: "prod1" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width: ANCHO, height: ALTO, color: "#FFFFFF", fontFamily: OSWALD, overflow: "hidden", ...(conFondo(c) ? fondo(dir) : {}) }}>
      {/* Circulos de luz detras del collage. */}
      <div style={{ display: "flex", position: "absolute", width: 980, height: 980, borderRadius: 980, background: "rgba(255,255,255,0.10)", left: 50, top: 640, ...en(c, "fondo") }} />
      <div style={{ display: "flex", position: "absolute", width: 620, height: 620, borderRadius: 620, background: "rgba(255,255,255,0.12)", left: 230, top: 680, ...en(c, "fondo") }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "52px 64px 0", ...en(c, "fondo") }}>
        <Logo src={conFondo(c) ? d.logo : null} alto={66} ancho={260} />
        <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "12px 28px", fontFamily: HERO, fontWeight: 700, fontSize: 25, letterSpacing: 3 }}>
          {r.periodo === "dia" ? "PRECIOS DEL DÍA" : "RESUMEN SEMANAL"}
        </div>
      </div>

      <div style={{ display: "flex", padding: "38px 64px 0", fontFamily: HERO, fontWeight: 600, fontSize: 34, ...en(c, "kicker") }}>{capital(kicker)}</div>

      <div style={{ display: "flex", flexDirection: "column", padding: "6px 64px 0" }}>
        <div style={{ display: "flex", fontSize: 118, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1, ...en(c, "linea1") }}>LOS 5 QUE MÁS</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            alignSelf: "flex-start",
            background: AMARILLO,
            color: NEGRO,
            padding: "0 26px 0 30px",
            marginTop: 10,
            transform: "rotate(-2deg)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
            ...en(c, "bloque"),
          }}
        >
          <div style={{ display: "flex", fontSize: 172, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>{palabra}</div>
          <div style={{ display: "flex", marginLeft: 14 }}>
            <Flecha dir={dir} lado={128} color={TEMAS[dir].fuerte} />
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 118, fontWeight: 700, lineHeight: 1.05, marginTop: 14, letterSpacing: -1, ...en(c, "linea3") }}>{tercera}</div>
      </div>

      <div style={{ display: "flex", position: "absolute", left: 0, top: 672, width: ANCHO, height: 540 }}>
        {sitios.map((s, i) => {
          if (!s.m) return null
          const img = d.imagenes[s.m.producto]
          // Cada producto sobre un circulo blanco, como pegatina: algunas fotos
          // de Sandia traen fondo blanco y sueltas se verian como recuadros.
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", left: s.left, top: s.top, width: s.lado, ...en(c, s.capa) }}>
              <div style={{ display: "flex", width: s.lado, height: s.lado, borderRadius: s.lado, background: "#FFFFFF", alignItems: "center", justifyContent: "center", boxShadow: ve(c, s.capa) ? "0 18px 44px rgba(0,0,0,0.22)" : "none" }}>
                {img && ve(c, s.capa) ? <Img src={img} lado={Math.round(s.lado * 0.78)} /> : null}
              </div>
              {s.principal ? null : (
                <div style={{ display: "flex", marginTop: -18, background: NEGRO, color: "#FFFFFF", borderRadius: 999, padding: "6px 18px", fontSize: 30, fontWeight: 600 }}>
                  {porcentaje(s.m.porcentaje)}
                </div>
              )}
            </div>
          )
        })}
        {p1 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              position: "absolute",
              left: 600,
              top: 0,
              width: 230,
              height: 230,
              borderRadius: 230,
              background: AMARILLO,
              color: NEGRO,
              transform: "rotate(10deg)",
              boxShadow: "0 16px 36px rgba(0,0,0,0.28)",
              ...en(c, "sticker"),
            }}
          >
            <div style={{ display: "flex", fontSize: 62, fontWeight: 700, lineHeight: 1 }}>{porcentaje(p1.porcentaje)}</div>
            <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, marginTop: 6, textTransform: "uppercase" }}>{p1.nombre.length > 14 ? "el primero" : p1.nombre}</div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: ANCHO, height: 128, background: NEGRO, ...en(c, "fondo") }} />
      <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: ANCHO, height: 128, alignItems: "center", justifyContent: "space-between", padding: "0 64px" }}>
        <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 36, ...en(c, "fondo") }}>{fomo}</div>
        <div style={{ display: "flex", alignItems: "center", fontFamily: HERO, fontWeight: 700, fontSize: 32, color: AMARILLO }}>
          <div style={{ display: "flex", marginRight: 10, ...en(c, "fondo") }}>Desliza</div>
          <div style={{ display: "flex", ...en(c, "flecha") }}>
            <FlechaDerecha lado={44} color={AMARILLO} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- producto

function tamanoNombre(t: string): number {
  if (t.length <= 8) return 136
  if (t.length <= 12) return 112
  if (t.length <= 16) return 92
  return 78
}

function Producto({ d, m, i, total }: { d: DatosLaminas; m: Movimiento; i: number; total: number }) {
  const dir = d.ranking.direccion
  const t = TEMAS[dir]
  const img = d.imagenes[m.producto]
  const etiquetaAntes = etiquetaDia(m.fechaAntes)
  const etiquetaAhora = etiquetaDia(m.fechaAhora)
  const c = d.capa
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", width: ANCHO, height: ALTO, color: "#FFFFFF", fontFamily: OSWALD, overflow: "hidden", ...(conFondo(c) ? fondo(dir, i % 2 === 0 ? 160 : 200) : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: ANCHO, padding: "48px 64px 0", ...en(c, "fondo") }}>
        <Logo src={conFondo(c) ? d.logo : null} alto={54} ancho={220} />
        <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, letterSpacing: 3, background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "10px 24px" }}>
          {/* No "en un dia": si la central no reporto ayer, la comparacion es con su reporte anterior. */}
          {`${dir === "subieron" ? "SUBIÓ" : "BAJÓ"} ${d.ranking.periodo === "dia" ? "DE PRECIO" : "EN LA SEMANA"}`}
        </div>
      </div>

      {/* El producto sobre un circulo blanco, con su puesto y la pegatina del porcentaje. */}
      <div style={{ display: "flex", position: "relative", width: 600, height: 600, marginTop: 26, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", position: "absolute", left: 30, top: 30, width: 540, height: 540, borderRadius: 540, background: "#FFFFFF", boxShadow: "0 24px 60px rgba(0,0,0,0.22)", ...en(c, "circulo") }} />
        <div style={{ display: "flex", ...en(c, "fruta") }}>
          {!ve(c, "fruta") ? <div style={{ display: "flex", width: 450, height: 450 }} /> : img ? <Img src={img} lado={450} /> : <div style={{ display: "flex", fontSize: 120, color: t.fuerte, fontWeight: 700 }}>{m.nombre.slice(0, 1)}</div>}
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: -40,
            top: 10,
            width: 150,
            height: 150,
            borderRadius: 150,
            background: NEGRO,
            color: AMARILLO,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 84,
            fontWeight: 700,
            ...en(c, "rango"),
          }}
        >
          {`#${i + 1}`}
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: -90,
            bottom: 40,
            background: AMARILLO,
            color: NEGRO,
            padding: "6px 28px",
            borderRadius: 24,
            fontSize: 92,
            fontWeight: 700,
            transform: "rotate(-6deg)",
            boxShadow: "0 16px 36px rgba(0,0,0,0.28)",
            ...en(c, "pct"),
          }}
        >
          {porcentaje(m.porcentaje)}
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 18, fontSize: tamanoNombre(m.nombre), fontWeight: 700, lineHeight: 1.02, letterSpacing: -1, textAlign: "center", ...en(c, "nombre") }}>{m.nombre.toUpperCase()}</div>
      <div style={{ display: "flex", marginTop: 14, background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "10px 30px", fontFamily: HERO, fontWeight: 600, fontSize: 32, ...en(c, "lugar") }}>{lugar(m)}</div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "absolute",
          left: 64,
          bottom: 104,
          width: ANCHO - 128,
          background: "#FFFFFF",
          color: NEGRO,
          borderRadius: 36,
          padding: "28px 44px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.22)",
          ...en(c, "precio"),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, letterSpacing: 2, color: "#8A8A8A" }}>{etiquetaAntes}</div>
          {/* Tachado a mano: Satori dibuja el text-decoration aunque el elemento tenga opacidad 0, y ensuciaba las capas animadas. */}
          <div style={{ display: "flex", position: "relative", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 600, color: "#8A8A8A" }}>{pesos(m.antes)}</div>
            <div style={{ display: "flex", position: "absolute", left: -4, right: -4, top: "54%", height: 5, background: "#8A8A8A", borderRadius: 3 }} />
          </div>
        </div>
        <FlechaDerecha lado={84} color={t.fuerte} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, letterSpacing: 2, color: t.fuerte }}>{etiquetaAhora}</div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1.05 }}>{pesos(m.ahora)}</div>
            <div style={{ display: "flex", fontFamily: HERO, fontWeight: 600, fontSize: 28, color: "#555555", marginLeft: 8, marginBottom: 16 }}>/kg</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", position: "absolute", left: 64, bottom: 40, fontFamily: HERO, fontWeight: 600, fontSize: 24, color: "rgba(255,255,255,0.9)", ...en(c, "fondo") }}>
        Precio mayorista por kilo · Fuente: Sandia
      </div>
      <Pagina n={i + 2} total={total} capa={c} />
    </div>
  )
}

// ------------------------------------------------------------------- cierre

function Cierre({ d, total, red }: { d: DatosLaminas; total: number; red: "instagram" | "facebook" }) {
  const dir = d.ranking.direccion
  const t = TEMAS[dir]
  const c = d.capa
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", width: ANCHO, height: ALTO, background: conFondo(c) ? NEGRO : "transparent", color: "#FFFFFF", fontFamily: OSWALD, padding: "0 80px", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: 760, height: 760, borderRadius: 760, right: -420, top: -470, ...fondo(dir), ...en(c, "blob1") }} />
      <div style={{ display: "flex", position: "absolute", width: 460, height: 460, borderRadius: 460, right: -230, bottom: -250, ...fondo(dir, 330), opacity: 0.9, ...en(c, "blob2") }} />

      <div style={{ display: "flex", ...en(c, "fondo") }}>
        <Logo src={conFondo(c) ? d.logo : null} alto={80} ancho={320} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56, fontSize: 120, fontWeight: 700, lineHeight: 1.14, letterSpacing: -1 }}>
        <div style={{ display: "flex", ...en(c, "l1") }}>¿Y EL PRECIO DE</div>
        <div style={{ display: "flex", ...en(c, "l2") }}>LO QUE TÚ</div>
        <div style={{ display: "flex", color: AMARILLO, ...en(c, "l3") }}>COMPRAS?</div>
      </div>
      <div style={{ display: "flex", marginTop: 34, fontFamily: HERO, fontWeight: 400, fontSize: 42, lineHeight: 1.3, color: "#E6E6E6", maxWidth: 880, ...en(c, "parrafo") }}>
        Consulta el precio mayorista de todos los productos en las centrales de abastos del país, actualizado cada día.
      </div>
      <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 48, borderRadius: 999, padding: "18px 54px", fontSize: 84, fontWeight: 700, ...fondo(dir, 90), boxShadow: `0 18px 50px ${t.a}66`, ...en(c, "dominio") }}>
        {d.dominio}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 34, fontFamily: HERO, fontWeight: 700, fontSize: 40, color: AMARILLO, ...en(c, "link") }}>
        <div style={{ display: "flex", marginRight: 14 }}>{red === "instagram" ? "Link en la descripción" : "Link en el primer comentario"}</div>
        <Flecha dir="bajaron" lado={46} color={AMARILLO} />
      </div>
      <Pagina n={total} total={total} capa={c} />
    </div>
  )
}

// ------------------------------------------------------------------- render

async function dibujar(vista: React.ReactElement): Promise<Buffer> {
  const fuentes = [...(await cargarFuente("Oswald")), ...(await cargarFuente("HeroFont"))]
  const r = new ImageResponse(vista, { width: ANCHO, height: ALTO, fonts: fuentes })
  return Buffer.from(await r.arrayBuffer())
}

/**
 * Todas las laminas. La ultima cambia segun la red (el link esta en la
 * descripcion en Instagram y en el primer comentario en Facebook), asi que se
 * dibuja dos veces; las demas son las mismas para las dos.
 */
export async function dibujarCarrusel(d: DatosLaminas): Promise<{ comunes: Buffer[]; cierreInstagram: Buffer; cierreFacebook: Buffer }> {
  const total = d.ranking.productos.length + 2
  const comunes: Buffer[] = [await dibujar(<Portada d={d} />)]
  for (const [i, m] of d.ranking.productos.entries()) comunes.push(await dibujar(<Producto d={d} m={m} i={i} total={total} />))
  return {
    comunes,
    cierreInstagram: await dibujar(<Cierre d={d} total={total} red="instagram" />),
    cierreFacebook: await dibujar(<Cierre d={d} total={total} red="facebook" />),
  }
}

// ---------------------------------------------------------------- animadas

/**
 * Como se mueve cada capa. La portada arma el titular linea a linea y luego
 * caen los productos, que se quedan flotando; en cada producto la fruta salta
 * y flota, y el precio sube desde abajo; el cierre escribe la pregunta y el
 * link late. Los bucles duran lo que divide la lamina, para que el video
 * empalme al repetirse.
 */
const ANIM_PORTADA: Record<string, Animacion> = {
  kicker: { tipo: "arriba", entra: 0.1, dura: 0.5, distancia: 30 },
  linea1: { tipo: "izq", entra: 0.2, dura: 0.55, distancia: 520 },
  bloque: { tipo: "pop", entra: 0.55, dura: 0.6, late: 0.02, periodo: 2 },
  linea3: { tipo: "izq", entra: 0.95, dura: 0.55, distancia: 520 },
  prod1: { tipo: "pop", entra: 1.25, dura: 0.6, flota: 12, gira: 3, periodo: 3 },
  prod2: { tipo: "pop", entra: 1.45, dura: 0.55, flota: 10, gira: 5, periodo: 3, fase: 0.25 },
  prod3: { tipo: "pop", entra: 1.6, dura: 0.55, flota: 10, gira: 5, periodo: 2, fase: 0.6 },
  prod4: { tipo: "pop", entra: 1.75, dura: 0.55, flota: 9, gira: 6, periodo: 2, fase: 0.1 },
  prod5: { tipo: "pop", entra: 1.9, dura: 0.55, flota: 9, gira: 6, periodo: 3, fase: 0.8 },
  sticker: { tipo: "pop", entra: 2.3, dura: 0.5, late: 0.05, gira: 3, periodo: 1.5 },
  flecha: { tipo: "nada", vaiven: 10, periodo: 1 },
}

const ANIM_PRODUCTO: Record<string, Animacion> = {
  circulo: { tipo: "pop", entra: 0, dura: 0.5 },
  fruta: { tipo: "pop", entra: 0.2, dura: 0.65, flota: 14, gira: 4, periodo: 2.5 },
  rango: { tipo: "pop", entra: 0.5, dura: 0.5 },
  pct: { tipo: "pop", entra: 0.85, dura: 0.5, late: 0.05, periodo: 1.25 },
  nombre: { tipo: "abajo", entra: 0.35, dura: 0.5, distancia: 90 },
  lugar: { tipo: "abajo", entra: 0.5, dura: 0.5, distancia: 90 },
  precio: { tipo: "abajo", entra: 0.7, dura: 0.6, distancia: 420 },
}

const ANIM_CIERRE: Record<string, Animacion> = {
  blob1: { tipo: "nada", vaiven: 30, flota: 30, periodo: 5 },
  blob2: { tipo: "nada", vaiven: 24, flota: 20, periodo: 2.5, fase: 0.3 },
  l1: { tipo: "izq", entra: 0.1, dura: 0.5, distancia: 520 },
  l2: { tipo: "izq", entra: 0.3, dura: 0.5, distancia: 520 },
  l3: { tipo: "pop", entra: 0.55, dura: 0.55 },
  parrafo: { tipo: "abajo", entra: 0.9, dura: 0.5, distancia: 60 },
  dominio: { tipo: "pop", entra: 1.2, dura: 0.55, late: 0.04, periodo: 1.25 },
  link: { tipo: "abajo", entra: 1.5, dura: 0.5, distancia: 60, flota: 8, periodo: 1 },
}

const DURA_PORTADA = 6
const DURA_LAMINA = 5

async function animar(
  vista: (capa?: string) => React.ReactElement,
  anims: Record<string, Animacion>,
  duracion: number,
  conCartel = false
): Promise<Buffer> {
  // Las capas se dibujan a la vez: el rasterizado corre en los hilos de sharp.
  const nombres = Object.keys(anims)
  const [fondo, cartel, ...pngs] = await Promise.all([
    dibujar(vista("fondo")),
    conCartel ? dibujar(vista()) : Promise.resolve(null),
    ...nombres.map((n) => dibujar(vista(n))),
  ])
  const capas: CapaPng[] = nombres.map((nombre, k) => ({ nombre, anim: anims[nombre], png: pngs[k] }))
  return animarLamina(fondo, capas, duracion, cartel)
}

/** Cuantas laminas tiene el carrusel: portada, una por producto y el cierre. */
export const totalLaminas = (d: Pick<DatosLaminas, "ranking">) => d.ranking.productos.length + 2

/**
 * Una lamina animada, en MP4: la 0 es la portada, luego un producto por
 * lamina y la ultima es el cierre (que cambia segun la red). Se hacen de a una
 * porque cada una tarda: el pipeline las va armando en varias pasadas.
 *
 * La portada empieza con un cuadro de la lamina completa: es el que Instagram
 * usa de miniatura, y asi no sale una portada a medio armar.
 */
export async function animarUna(d: DatosLaminas, i: number, red: "instagram" | "facebook" = "instagram"): Promise<Buffer> {
  const total = totalLaminas(d)
  if (i === 0) return animar((capa) => <Portada d={{ ...d, capa }} />, ANIM_PORTADA, DURA_PORTADA, true)
  if (i === total - 1) return animar((capa) => <Cierre d={{ ...d, capa }} total={total} red={red} />, ANIM_CIERRE, DURA_LAMINA)
  const m = d.ranking.productos[i - 1]
  if (!m) throw new Error(`No hay lámina ${i}.`)
  return animar((capa) => <Producto d={{ ...d, capa }} m={m} i={i - 1} total={total} />, ANIM_PRODUCTO, DURA_LAMINA)
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
