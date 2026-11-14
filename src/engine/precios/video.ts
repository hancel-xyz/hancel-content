import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { ALTO, ANCHO } from "../render/theme"

/**
 * Las laminas animadas: de capas fijas a un MP4, sin IA.
 *
 * Cada lamina se dibuja por capas (el fondo que no se mueve y un PNG por cada
 * elemento que se mueve, en su sitio). ffmpeg las monta encima del fondo y les
 * da movimiento con expresiones en funcion del tiempo: entrar (deslizarse,
 * aparecer, saltar con rebote), flotar, girar un poco, latir.
 *
 * Instagram pide para un video de carrusel: MP4 H.264, 4:5, de 3 a 60
 * segundos, con pista de audio (se le pone silencio).
 */

export type Animacion = {
  /** Como entra: salta con rebote, se desliza desde un lado, o solo aparece. "nada" = esta desde el principio. */
  tipo?: "pop" | "izq" | "der" | "abajo" | "arriba" | "fade" | "nada"
  /** Segundo en que empieza a entrar. */
  entra?: number
  /** Cuanto tarda en entrar. */
  dura?: number
  /** Desde cuantos pixeles se desliza. */
  distancia?: number
  /** Pixeles que sube y baja, en bucle. */
  flota?: number
  /** Pixeles que va y viene en horizontal, en bucle. */
  vaiven?: number
  /** Grados que se mece, en bucle. */
  gira?: number
  /** Cuanto crece y se encoge (0.05 = 5%), en bucle. */
  late?: number
  /** Segundos de una vuelta del bucle; mejor si divide la duracion, para que el video empalme. */
  periodo?: number
  /** Desfase del bucle (0 a 1), para que no se muevan todos a la vez. */
  fase?: number
}

export type CapaPng = { nombre: string; png: Buffer; anim: Animacion }

export const FPS = 30

/** La ruta de ffmpeg: la de FFMPEG_PATH, la del paquete ffmpeg-static (en el servidor) o la del sistema. */
function rutaFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const req = createRequire(import.meta.url)
    const nombre = "ffmpeg-static"
    const ruta = req(nombre) as string | null
    if (ruta) return ruta
  } catch {
    // sin el paquete resuelto: se busca su binario donde lo deja la instalacion
  }
  const binario = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
  if (existsSync(binario)) return binario
  return "ffmpeg"
}

function ffmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(rutaFfmpeg(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd })
    let err = ""
    p.stderr.on("data", (b) => (err += String(b)))
    p.on("error", reject)
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}: ${err.slice(-800)}`))))
  })
}

/** El rectangulo con contenido de una capa (alfa > 0), o null si esta vacia. */
async function recorte(png: Buffer): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const sharp = (await import("sharp")).default
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) {
    const fila = y * W * C
    for (let x = 0; x < W; x++) {
      if (data[fila + x * C + 3] > 2) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

const par = (n: number) => Math.ceil(n / 2) * 2
const num = (n: number) => Number(n.toFixed(4)).toString()

/** Progreso de la entrada, de 0 a 1. */
const prog = (a: Animacion) => `clip((t-${num(a.entra ?? 0)})/${num(a.dura ?? 0.5)},0,1)`
/** Frena al llegar. */
const suave = (p: string) => `(1-pow(1-${p},3))`
/** Se pasa un poco y vuelve: el salto de una pegatina. */
const rebote = (p: string) => `(1+2.70158*pow(${p}-1,3)+1.70158*pow(${p}-1,2))`
/** Una onda del bucle, de -1 a 1. */
const onda = (a: Animacion, desfase = 0) => `sin(2*PI*(t/${num(a.periodo ?? 3)}+${num((a.fase ?? 0) + desfase)}))`

/**
 * Monta una lamina animada: el fondo y sus capas, durante `duracion`
 * segundos, en un MP4 listo para Instagram. Con `cartel` (la lamina completa)
 * el primer cuadro es ese: Instagram toma el primero de miniatura.
 */
export async function animarLamina(fondo: Buffer, capas: CapaPng[], duracion: number, cartel?: Buffer | null): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "precios-"))
  try {
    await writeFile(path.join(dir, "fondo.png"), fondo)
    const sharp = (await import("sharp")).default
    const cuadros = Math.round(duracion * FPS)
    // Cada PNG entra una vez y se repite en el filtro: con -loop 1 ffmpeg lo volveria a decodificar en cada cuadro.
    const fija = (i: number) => `[${i}:v]loop=loop=${cuadros - 1}:size=1:start=0,setpts=N/${FPS}/TB,`
    const entradas: string[] = ["-i", "fondo.png"]
    const filtros: string[] = [`${fija(0)}format=yuv420p[b0]`]
    let base = "b0"
    let n = 0

    for (const capa of capas) {
      const r = await recorte(capa.png)
      if (!r) continue
      const a = capa.anim
      const escala = a.tipo === "pop" || !!a.late
      // Margen alrededor para que al girar o crecer no se corte.
      const m = Math.ceil(Math.max(r.w, r.h) * (a.gira ? 0.12 : 0.02)) + 16
      const w = par(r.w + 2 * m)
      const h = par(r.h + 2 * m)
      const recortada = await sharp(capa.png)
        .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
        .extend({ top: m, left: m, bottom: h - r.h - m, right: w - r.w - m, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
      n += 1
      const archivo = `c${n}.png`
      await writeFile(path.join(dir, archivo), recortada)
      entradas.push("-i", archivo)

      const p = prog(a)
      const cadena: string[] = ["format=rgba"]
      // El lienzo donde cabe la capa aunque crezca (rebote y latido).
      const W = escala ? par(w * 1.3) : w
      const H = escala ? par(h * 1.3) : h
      if (escala) {
        const s = [a.tipo === "pop" ? rebote(p) : "1", a.late ? `(1+${num(a.late)}*${onda(a)})` : "1"].join("*")
        cadena.push(`scale=w='max(2,trunc(${w}*${s}/2)*2)':h='max(2,trunc(${h}*${s}/2)*2)':eval=frame`)
        cadena.push(`pad=w=${W}:h=${H}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`)
      }
      if (a.gira) cadena.push(`rotate=a='${num((a.gira * Math.PI) / 180)}*${onda(a, 0.13)}':c=none`)
      if (a.tipo && a.tipo !== "nada") cadena.push(`fade=t=in:st=${num(a.entra ?? 0)}:d=${num(Math.max(0.12, (a.dura ?? 0.5) * (a.tipo === "pop" ? 0.35 : 0.7)))}:alpha=1`)
      filtros.push(`${fija(n)}${cadena.join(",")}[l${n}]`)

      // Posicion: la de la lamina fija, mas la entrada y el bucle.
      const dist = num(a.distancia ?? 160)
      let x = `${r.x - m - (W - w) / 2}`
      let y = `${r.y - m - (H - h) / 2}`
      if (a.tipo === "izq") x += `-(1-${suave(p)})*${dist}`
      if (a.tipo === "der") x += `+(1-${suave(p)})*${dist}`
      if (a.tipo === "abajo") y += `+(1-${suave(p)})*${dist}`
      if (a.tipo === "arriba") y += `-(1-${suave(p)})*${dist}`
      if (a.flota) y += `+${num(a.flota)}*${onda(a)}`
      if (a.vaiven) x += `+${num(a.vaiven)}*${onda(a)}`
      const sig = `b${n}`
      filtros.push(`[${base}][l${n}]overlay=x='${x}':y='${y}':eval=frame:format=yuv420[${sig}]`)
      base = sig
    }
    if (cartel) {
      await writeFile(path.join(dir, "cartel.png"), cartel)
      entradas.push("-i", "cartel.png")
      filtros.push(`[${base}][${n + 1}:v]overlay=x=0:y=0:enable='eq(n,0)':eof_action=pass:format=yuv420[bc]`)
      base = "bc"
    }
    filtros.push(`[${base}]format=yuv420p[v]`)
    const audio = n + 1 + (cartel ? 1 : 0)

    await ffmpeg(
      [
        ...entradas,
        "-f", "lavfi", "-t", num(duracion), "-i", "anullsrc=r=44100:cl=stereo",
        "-filter_complex", filtros.join(";"),
        "-map", "[v]", "-map", `${audio}:a`,
        "-s", `${ANCHO}x${ALTO}`, "-r", String(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "64k",
        "-t", num(duracion), "-movflags", "+faststart",
        "salida.mp4",
      ],
      dir
    )
    return await readFile(path.join(dir, "salida.mp4"))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Pega varias laminas animadas en un solo video (para Facebook, que no admite
 * videos dentro de un post de varias fotos). Todas salen de `animarLamina` con
 * el mismo formato, asi que se pegan sin recodificar.
 */
export async function unirVideos(videos: Buffer[]): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "precios-"))
  try {
    const lista: string[] = []
    for (const [i, v] of videos.entries()) {
      await writeFile(path.join(dir, `v${i}.mp4`), v)
      lista.push(`file 'v${i}.mp4'`)
    }
    await writeFile(path.join(dir, "lista.txt"), lista.join("\n"))
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", "lista.txt", "-c", "copy", "-movflags", "+faststart", "unido.mp4"], dir)
    return await readFile(path.join(dir, "unido.mp4"))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
