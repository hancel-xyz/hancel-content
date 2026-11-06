#!/usr/bin/env node
/**
 * Servidor MCP de Pexels: el puente entre Claude y la API de Pexels.
 *
 * Sin dependencias: habla MCP por stdio (JSON-RPC, un mensaje por linea) con
 * Node puro, asi que no hace falta `npm install` para usarlo.
 *
 * La clave se toma de la variable de entorno PEXELS_API_KEY y, si no esta,
 * del `.env.local` en la raiz del repo (dos carpetas arriba de este archivo).
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = resolve(AQUI, "..", "..")
const API = "https://api.pexels.com"
const NOMBRE = "pexels"
const VERSION = "1.0.0"

// ---------------------------------------------------------------- clave

function leerEnvLocal() {
  for (const archivo of [".env.local", ".env"]) {
    const ruta = join(RAIZ_REPO, archivo)
    if (!existsSync(ruta)) continue
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = linea.match(/^\s*PEXELS_API_KEY\s*=\s*(.*)\s*$/)
      if (m) {
        const valor = m[1].replace(/^['"]|['"]$/g, "").trim()
        if (valor) return valor
      }
    }
  }
  return ""
}

const CLAVE = (process.env.PEXELS_API_KEY || "").trim() || leerEnvLocal()

// ---------------------------------------------------------------- API

let ultimoLimite = null

async function pexels(ruta, params = {}) {
  if (!CLAVE) {
    throw new Error(
      "No encuentro PEXELS_API_KEY. Ponla en la variable de entorno o en .env.local en la raiz del repo.",
    )
  }
  const url = new URL(ruta, API)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, { headers: { Authorization: CLAVE } })
  const restantes = res.headers.get("x-ratelimit-remaining")
  if (restantes) ultimoLimite = { restantes: Number(restantes), limite: Number(res.headers.get("x-ratelimit-limit")) }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "")
    if (res.status === 401) throw new Error("Pexels rechazo la clave (401). Revisa PEXELS_API_KEY.")
    if (res.status === 429) throw new Error("Limite de peticiones de Pexels agotado (429). Espera y vuelve a intentar.")
    throw new Error(`Pexels respondio ${res.status}: ${cuerpo.slice(0, 300)}`)
  }
  return res.json()
}

// ---------------------------------------------------------------- formato

const resumirFoto = (p) => ({
  id: p.id,
  descripcion: p.alt || "",
  autor: p.photographer,
  autor_url: p.photographer_url,
  ancho: p.width,
  alto: p.height,
  color_medio: p.avg_color,
  pagina: p.url,
  src: p.src,
})

function resumirVideo(v) {
  const archivos = (v.video_files || [])
    .filter((f) => f.link)
    .sort((a, b) => (b.width || 0) - (a.width || 0))
    .map((f) => ({ calidad: f.quality, ancho: f.width, alto: f.height, fps: f.fps, tipo: f.file_type, link: f.link }))
  return {
    id: v.id,
    autor: v.user?.name,
    autor_url: v.user?.url,
    ancho: v.width,
    alto: v.height,
    duracion_s: v.duration,
    pagina: v.url,
    portada: v.image,
    archivos,
  }
}

function paginado(data, clave, resumir) {
  return {
    total: data.total_results,
    pagina: data.page,
    por_pagina: data.per_page,
    hay_mas: Boolean(data.next_page),
    resultados: (data[clave] || []).map(resumir),
  }
}

const texto = (obj) => ({
  content: [
    {
      type: "text",
      text:
        JSON.stringify(obj, null, 2) +
        (ultimoLimite ? `\n\n(Peticiones restantes este mes: ${ultimoLimite.restantes}/${ultimoLimite.limite})` : ""),
    },
  ],
})

// ---------------------------------------------------------------- herramientas

const P_PAGINA = { type: "integer", minimum: 1, description: "Pagina de resultados (por defecto 1)." }
const P_POR_PAGINA = { type: "integer", minimum: 1, maximum: 80, description: "Resultados por pagina, 1-80 (por defecto 15)." }
const P_ORIENTACION = { type: "string", enum: ["landscape", "portrait", "square"], description: "Horizontal, vertical o cuadrada." }
const P_TAMANO = { type: "string", enum: ["large", "medium", "small"], description: "Tamano minimo: large=24MP, medium=12MP, small=4MP." }
const TAMANOS_FOTO = ["original", "large2x", "large", "medium", "small", "portrait", "landscape", "tiny"]

const HERRAMIENTAS = [
  {
    name: "buscar_fotos",
    description:
      "Busca fotos en Pexels por palabra clave. Devuelve id, descripcion, autor, tamanos y URLs de cada foto. Consejo: las busquedas en ingles suelen dar mas resultados.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Que buscar, p. ej. 'cafe colombiano', 'farmer field'." },
        orientation: P_ORIENTACION,
        size: P_TAMANO,
        color: { type: "string", description: "Color deseado: red, orange, yellow, green, turquoise, blue, violet, pink, brown, black, gray, white o hex (#ffffff)." },
        locale: { type: "string", description: "Idioma de la busqueda, p. ej. 'es-ES', 'en-US', 'pt-BR'." },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
      required: ["query"],
    },
    run: (a) =>
      pexels("/v1/search", a).then((d) => texto(paginado(d, "photos", resumirFoto))),
  },
  {
    name: "fotos_destacadas",
    description: "Fotos seleccionadas a mano por el equipo de Pexels (curated), se renuevan cada hora.",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: (a) => pexels("/v1/curated", a).then((d) => texto(paginado(d, "photos", resumirFoto))),
  },
  {
    name: "obtener_foto",
    description: "Datos completos de una foto de Pexels por su id.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: (a) => pexels(`/v1/photos/${a.id}`).then((d) => texto(resumirFoto(d))),
  },
  {
    name: "ver_fotos",
    description:
      "Muestra a Claude una o varias fotos de Pexels (hasta 6) como imagen, para poder mirarlas y elegir. Usa 'medium' o 'small' para no gastar contexto.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 6, description: "Ids de las fotos." },
        tamano: { type: "string", enum: ["tiny", "small", "medium", "large"], description: "Por defecto 'medium'." },
      },
      required: ["ids"],
    },
    run: async (a) => {
      const tamano = a.tamano || "medium"
      const content = []
      for (const id of a.ids.slice(0, 6)) {
        try {
          const foto = await pexels(`/v1/photos/${id}`)
          const res = await fetch(foto.src[tamano] || foto.src.medium)
          if (!res.ok) throw new Error(`descarga ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          content.push({ type: "text", text: `Foto ${id} - ${foto.alt || "sin descripcion"} - por ${foto.photographer}` })
          content.push({ type: "image", data: buf.toString("base64"), mimeType: res.headers.get("content-type") || "image/jpeg" })
        } catch (e) {
          content.push({ type: "text", text: `No pude cargar la foto ${id}: ${e.message}` })
        }
      }
      return { content }
    },
  },
  {
    name: "descargar_foto",
    description:
      "Descarga una foto de Pexels a una carpeta del computador y devuelve la ruta del archivo. Por defecto guarda en ~/Downloads/pexels.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        tamano: { type: "string", enum: TAMANOS_FOTO, description: "Por defecto 'original'." },
        carpeta: { type: "string", description: "Carpeta destino (absoluta). Opcional." },
      },
      required: ["id"],
    },
    run: async (a) => {
      const tamano = a.tamano || "original"
      const foto = await pexels(`/v1/photos/${a.id}`)
      const url = foto.src[tamano] || foto.src.original
      const res = await fetch(url)
      if (!res.ok) throw new Error(`No se pudo descargar (${res.status}).`)
      const tipo = res.headers.get("content-type") || ""
      const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : "jpg"
      const carpeta = a.carpeta ? resolve(a.carpeta) : join(homedir(), "Downloads", "pexels")
      mkdirSync(carpeta, { recursive: true })
      const ruta = join(carpeta, `pexels-${foto.id}-${tamano}.${ext}`)
      writeFileSync(ruta, Buffer.from(await res.arrayBuffer()))
      return texto({
        archivo: ruta,
        credito: `Foto de ${foto.photographer} en Pexels`,
        autor_url: foto.photographer_url,
        pagina: foto.url,
      })
    },
  },
  {
    name: "buscar_videos",
    description: "Busca videos en Pexels por palabra clave. Devuelve duracion, portada y los archivos MP4 disponibles por calidad.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        orientation: P_ORIENTACION,
        size: P_TAMANO,
        locale: { type: "string" },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
      required: ["query"],
    },
    run: (a) => pexels("/videos/search", a).then((d) => texto(paginado(d, "videos", resumirVideo))),
  },
  {
    name: "videos_populares",
    description: "Videos populares de Pexels, con filtros opcionales de tamano y duracion.",
    inputSchema: {
      type: "object",
      properties: {
        min_width: { type: "integer" },
        min_height: { type: "integer" },
        min_duration: { type: "integer", description: "Segundos." },
        max_duration: { type: "integer", description: "Segundos." },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
    },
    run: (a) => pexels("/videos/popular", a).then((d) => texto(paginado(d, "videos", resumirVideo))),
  },
  {
    name: "obtener_video",
    description: "Datos completos de un video de Pexels por su id.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: (a) => pexels(`/videos/videos/${a.id}`).then((d) => texto(resumirVideo(d))),
  },
  {
    name: "mis_colecciones",
    description: "Lista las colecciones de TU cuenta de Pexels (las asociadas a la clave de la API).",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: (a) =>
      pexels("/v1/collections", a).then((d) =>
        texto({ total: d.total_results, pagina: d.page, hay_mas: Boolean(d.next_page), colecciones: d.collections }),
      ),
  },
  {
    name: "colecciones_destacadas",
    description: "Colecciones destacadas de Pexels.",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: (a) =>
      pexels("/v1/collections/featured", a).then((d) =>
        texto({ total: d.total_results, pagina: d.page, hay_mas: Boolean(d.next_page), colecciones: d.collections }),
      ),
  },
  {
    name: "contenido_coleccion",
    description: "Fotos y videos dentro de una coleccion (tuya o destacada) por su id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id de la coleccion, p. ej. '8xntbhr'." },
        type: { type: "string", enum: ["photos", "videos"], description: "Filtrar por tipo. Sin esto trae ambos." },
        sort: { type: "string", enum: ["asc", "desc"] },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
      required: ["id"],
    },
    run: async (a) => {
      const { id, ...resto } = a
      const d = await pexels(`/v1/collections/${encodeURIComponent(id)}`, resto)
      return texto({
        id: d.id,
        total: d.total_results,
        pagina: d.page,
        hay_mas: Boolean(d.next_page),
        medios: (d.media || []).map((m) =>
          m.type === "Video" ? { tipo: "video", ...resumirVideo(m) } : { tipo: "foto", ...resumirFoto(m) },
        ),
      })
    },
  },
]

// ---------------------------------------------------------------- MCP / JSON-RPC

const enviar = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")
const log = (...a) => process.stderr.write(`[pexels-mcp] ${a.join(" ")}\n`)

async function manejar(msg) {
  const { id, method, params } = msg
  const esPeticion = id !== undefined && id !== null

  switch (method) {
    case "initialize":
      return enviar({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: NOMBRE, version: VERSION },
          instructions:
            "Acceso a la API de Pexels (fotos y videos libres). Busca con buscar_fotos/buscar_videos, mira candidatas con ver_fotos y guarda con descargar_foto. Da credito al fotografo cuando uses una imagen.",
        },
      })
    case "ping":
      return esPeticion && enviar({ jsonrpc: "2.0", id, result: {} })
    case "tools/list":
      return enviar({
        jsonrpc: "2.0",
        id,
        result: { tools: HERRAMIENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      })
    case "tools/call": {
      const herramienta = HERRAMIENTAS.find((h) => h.name === params?.name)
      if (!herramienta) {
        return enviar({ jsonrpc: "2.0", id, error: { code: -32602, message: `Herramienta desconocida: ${params?.name}` } })
      }
      try {
        const result = await herramienta.run(params.arguments || {})
        return enviar({ jsonrpc: "2.0", id, result })
      } catch (e) {
        return enviar({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: e.message }] } })
      }
    }
    default:
      if (esPeticion) enviar({ jsonrpc: "2.0", id, error: { code: -32601, message: `Metodo no soportado: ${method}` } })
  }
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let salto
  while ((salto = buffer.indexOf("\n")) >= 0) {
    const linea = buffer.slice(0, salto).trim()
    buffer = buffer.slice(salto + 1)
    if (!linea) continue
    let msg
    try {
      msg = JSON.parse(linea)
    } catch {
      enviar({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalido" } })
      continue
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      manejar(m).catch((e) => log("error:", e.message))
    }
  }
})
process.stdin.on("end", () => process.exit(0))

log(CLAVE ? "listo, clave de Pexels cargada" : "AVISO: no hay PEXELS_API_KEY")
