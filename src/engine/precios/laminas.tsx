import { ImageResponse } from "next/og"

import { cargarFuente } from "../render/fonts"
import { ALTO, ANCHO } from "../render/theme"
import type { Direccion, Movimiento, Ranking } from "./sandia"
import { cuando, etiquetaDia, fechaLarga, lugar, pesos, porcentaje, rangoSemana } from "./textos"

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
}

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

function Pagina({ n, total, color = "rgba(255,255,255,0.85)" }: { n: number; total: number; color?: string }) {
  return <div style={{ display: "flex", position: "absolute", bottom: 40, right: 64, fontFamily: HERO, fontWeight: 600, fontSize: 26, color }}>{`${n}/${total}`}</div>
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

  // El collage: el primero grande al centro, los demas alrededor.
  const sitios: { m: Movimiento | undefined; lado: number; left: number; top: number; principal?: boolean }[] = [
    { m: p4, lado: 200, left: 70, top: 20 },
    { m: p5, lado: 190, left: 820, top: 40 },
    { m: p2, lado: 240, left: 40, top: 262 },
    { m: p3, lado: 230, left: 812, top: 276 },
    { m: p1, lado: 430, left: 325, top: 64, principal: true },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width: ANCHO, height: ALTO, color: "#FFFFFF", fontFamily: OSWALD, overflow: "hidden", ...fondo(dir) }}>
      {/* Circulos de luz detras del collage. */}
      <div style={{ display: "flex", position: "absolute", width: 980, height: 980, borderRadius: 980, background: "rgba(255,255,255,0.10)", left: 50, top: 640 }} />
      <div style={{ display: "flex", position: "absolute", width: 620, height: 620, borderRadius: 620, background: "rgba(255,255,255,0.12)", left: 230, top: 680 }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "52px 64px 0" }}>
        <Logo src={d.logo} alto={66} ancho={260} />
        <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "12px 28px", fontFamily: HERO, fontWeight: 700, fontSize: 25, letterSpacing: 3 }}>
          {r.periodo === "dia" ? "PRECIOS DEL DÍA" : "RESUMEN SEMANAL"}
        </div>
      </div>

      <div style={{ display: "flex", padding: "38px 64px 0", fontFamily: HERO, fontWeight: 600, fontSize: 34 }}>{capital(kicker)}</div>

      <div style={{ display: "flex", flexDirection: "column", padding: "6px 64px 0" }}>
        <div style={{ display: "flex", fontSize: 118, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1 }}>LOS 5 QUE MÁS</div>
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
          }}
        >
          <div style={{ display: "flex", fontSize: 172, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>{palabra}</div>
          <div style={{ display: "flex", marginLeft: 14 }}>
            <Flecha dir={dir} lado={128} color={TEMAS[dir].fuerte} />
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 118, fontWeight: 700, lineHeight: 1.05, marginTop: 14, letterSpacing: -1 }}>{tercera}</div>
      </div>

      <div style={{ display: "flex", position: "absolute", left: 0, top: 672, width: ANCHO, height: 540 }}>
        {sitios.map((s, i) => {
          if (!s.m) return null
          const img = d.imagenes[s.m.producto]
          // Cada producto sobre un circulo blanco, como pegatina: algunas fotos
          // de Sandia traen fondo blanco y sueltas se verian como recuadros.
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "absolute", left: s.left, top: s.top, width: s.lado }}>
              <div style={{ display: "flex", width: s.lado, height: s.lado, borderRadius: s.lado, background: "#FFFFFF", alignItems: "center", justifyContent: "center", boxShadow: "0 18px 44px rgba(0,0,0,0.22)" }}>
                {img ? <Img src={img} lado={Math.round(s.lado * 0.78)} /> : null}
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
            }}
          >
            <div style={{ display: "flex", fontSize: 62, fontWeight: 700, lineHeight: 1 }}>{porcentaje(p1.porcentaje)}</div>
            <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, marginTop: 6, textTransform: "uppercase" }}>{p1.nombre.length > 14 ? "el primero" : p1.nombre}</div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", position: "absolute", left: 0, bottom: 0, width: ANCHO, height: 128, background: NEGRO, alignItems: "center", justifyContent: "space-between", padding: "0 64px" }}>
        <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 36 }}>{fomo}</div>
        <div style={{ display: "flex", alignItems: "center", fontFamily: HERO, fontWeight: 700, fontSize: 32, color: AMARILLO }}>
          <div style={{ display: "flex", marginRight: 10 }}>Desliza</div>
          <FlechaDerecha lado={44} color={AMARILLO} />
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
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", width: ANCHO, height: ALTO, color: "#FFFFFF", fontFamily: OSWALD, overflow: "hidden", ...fondo(dir, i % 2 === 0 ? 160 : 200) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: ANCHO, padding: "48px 64px 0" }}>
        <Logo src={d.logo} alto={54} ancho={220} />
        <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, letterSpacing: 3, background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "10px 24px" }}>
          {/* No "en un dia": si la central no reporto ayer, la comparacion es con su reporte anterior. */}
          {`${dir === "subieron" ? "SUBIÓ" : "BAJÓ"} ${d.ranking.periodo === "dia" ? "DE PRECIO" : "EN LA SEMANA"}`}
        </div>
      </div>

      {/* El producto sobre un circulo blanco, con su puesto y la pegatina del porcentaje. */}
      <div style={{ display: "flex", position: "relative", width: 600, height: 600, marginTop: 26, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", position: "absolute", left: 30, top: 30, width: 540, height: 540, borderRadius: 540, background: "#FFFFFF", boxShadow: "0 24px 60px rgba(0,0,0,0.22)" }} />
        {img ? <Img src={img} lado={450} /> : <div style={{ display: "flex", fontSize: 120, color: t.fuerte, fontWeight: 700 }}>{m.nombre.slice(0, 1)}</div>}
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
          }}
        >
          {porcentaje(m.porcentaje)}
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 18, fontSize: tamanoNombre(m.nombre), fontWeight: 700, lineHeight: 1.02, letterSpacing: -1, textAlign: "center" }}>{m.nombre.toUpperCase()}</div>
      <div style={{ display: "flex", marginTop: 14, background: "rgba(0,0,0,0.25)", borderRadius: 999, padding: "10px 30px", fontFamily: HERO, fontWeight: 600, fontSize: 32 }}>{lugar(m)}</div>

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
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: HERO, fontWeight: 700, fontSize: 24, letterSpacing: 2, color: "#8A8A8A" }}>{etiquetaAntes}</div>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 600, color: "#8A8A8A", textDecoration: "line-through" }}>{pesos(m.antes)}</div>
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

      <div style={{ display: "flex", position: "absolute", left: 64, bottom: 40, fontFamily: HERO, fontWeight: 600, fontSize: 24, color: "rgba(255,255,255,0.9)" }}>
        Precio mayorista por kilo · Fuente: Sandia
      </div>
      <Pagina n={i + 2} total={total} />
    </div>
  )
}

// ------------------------------------------------------------------- cierre

function Cierre({ d, total, red }: { d: DatosLaminas; total: number; red: "instagram" | "facebook" }) {
  const dir = d.ranking.direccion
  const t = TEMAS[dir]
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", width: ANCHO, height: ALTO, background: NEGRO, color: "#FFFFFF", fontFamily: OSWALD, padding: "0 80px", overflow: "hidden" }}>
      <div style={{ display: "flex", position: "absolute", width: 760, height: 760, borderRadius: 760, right: -420, top: -470, ...fondo(dir) }} />
      <div style={{ display: "flex", position: "absolute", width: 460, height: 460, borderRadius: 460, right: -230, bottom: -250, ...fondo(dir, 330), opacity: 0.9 }} />

      <Logo src={d.logo} alto={80} ancho={320} />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56, fontSize: 120, fontWeight: 700, lineHeight: 1.14, letterSpacing: -1 }}>
        <div style={{ display: "flex" }}>¿Y EL PRECIO DE</div>
        <div style={{ display: "flex" }}>LO QUE TÚ</div>
        <div style={{ display: "flex", color: AMARILLO }}>COMPRAS?</div>
      </div>
      <div style={{ display: "flex", marginTop: 34, fontFamily: HERO, fontWeight: 400, fontSize: 42, lineHeight: 1.3, color: "#E6E6E6", maxWidth: 880 }}>
        Consulta el precio mayorista de todos los productos en las centrales de abastos del país, actualizado cada día.
      </div>
      <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 48, borderRadius: 999, padding: "18px 54px", fontSize: 84, fontWeight: 700, ...fondo(dir, 90), boxShadow: `0 18px 50px ${t.a}66` }}>
        {d.dominio}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 34, fontFamily: HERO, fontWeight: 700, fontSize: 40, color: AMARILLO }}>
        <div style={{ display: "flex", marginRight: 14 }}>{red === "instagram" ? "Link en la descripción" : "Link en el primer comentario"}</div>
        <Flecha dir="bajaron" lado={46} color={AMARILLO} />
      </div>
      <Pagina n={total} total={total} />
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

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
