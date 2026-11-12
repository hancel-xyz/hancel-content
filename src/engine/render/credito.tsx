import { ImageResponse } from "next/og"

import { cargarFuente } from "./fonts"
import type { Estilo } from "./theme"

/**
 * El credito de la foto de prensa en la portada: "Foto: <medio>", diminuto.
 *
 * Se estampa sobre la lamina ya dibujada en vez de meterlo en cada plantilla:
 * son cinco estilos con la foto en sitios distintos, y asi el credito vive en
 * un solo lugar. Satori dibuja el texto (con nuestras fuentes, que en el
 * servidor no hay otras) y sharp lo pega.
 *
 * Donde va:
 *   periodico y editorial  justo debajo de la foto, a la derecha, en gris,
 *                          sobre el blanco de la lamina.
 *   el resto               la foto ocupa toda la lamina: en vertical pegado al
 *                          borde derecho, en blanco con sombra, como en prensa.
 */
export async function estamparCredito(
  png: Buffer,
  medio: string | null | undefined,
  estilo: Estilo,
  /** Donde va la tira si no es la portada (la lamina 2 del periodico tiene la foto mas arriba). */
  arriba?: number
): Promise<Buffer> {
  const texto = (medio ?? "").trim()
  if (!texto) return png

  const sharp = (await import("sharp")).default
  const { width: W = 1080 } = await sharp(png).metadata()
  const fuentes = await cargarFuente(estilo.fuente)
  const tira = async (ancho: number, color: string, sombra: boolean) =>
    Buffer.from(
      await new ImageResponse(
        (
          <div
            style={{
              display: "flex",
              width: ancho,
              height: 28,
              alignItems: "center",
              justifyContent: "flex-end",
              fontFamily: estilo.fuente,
              fontSize: 17,
              letterSpacing: 0.3,
              color,
              ...(sombra ? { textShadow: "0 0 4px rgba(0,0,0,0.9)" } : {}),
            }}
          >
            {`Foto: ${texto.slice(0, 50)}`}
          </div>
        ),
        { width: ancho, height: 28, fonts: fuentes }
      ).arrayBuffer()
    )

  const sobreBlanco: Record<string, number> = { periodico: 858, editorial: 748 }
  const top = arriba ?? sobreBlanco[estilo.plantilla]
  if (top !== undefined) {
    const margen = estilo.plantilla === "editorial" ? 44 : 20
    return sharp(png)
      .composite([{ input: await tira(600, "#8A8A8A", false), left: W - 600 - margen, top }])
      .png()
      .toBuffer()
  }

  // Vertical, de abajo arriba, con el final del texto hacia arriba a 140 px del borde.
  const vertical = await sharp(await tira(700, "rgba(255,255,255,0.9)", true)).rotate(270).png().toBuffer()
  return sharp(png)
    .composite([{ input: vertical, left: W - 28 - 8, top: 140 }])
    .png()
    .toBuffer()
}
