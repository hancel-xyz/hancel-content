import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Conector MCP remoto de Pexels, para los conectores personalizados de claude.ai.
 *
 * Habla MCP sobre "Streamable HTTP" en modo sin estado: cada POST trae un
 * mensaje JSON-RPC y se responde con JSON. No hay sesiones ni streaming porque
 * ninguna herramienta los necesita.
 *
 * La URL lleva un token secreto (`/api/mcp/pexels/<token>`), porque claude.ai
 * no deja mandar cabeceras propias a un conector y el endpoint gasta la cuota de
 * nuestra clave. El token es `PEXELS_MCP_TOKEN` si existe y, si no, se deriva de
 * la propia clave de Pexels: asi funciona sin configurar nada nuevo en Vercel, y
 * rotar la clave de Pexels invalida tambien la URL.
 */

const API = "https://api.pexels.com"
const VERSION = "1.0.0"

// ---------------------------------------------------------------- token

export function tokenEsperado(): string | null {
  const explicito = process.env.PEXELS_MCP_TOKEN?.trim()
  if (explicito) return explicito
  const clave = process.env.PEXELS_API_KEY?.trim()
  if (!clave) return null
  return createHash("sha256").update(`pexels-mcp:${clave}`).digest("hex").slice(0, 32)
}

export function tokenValido(recibido: string): boolean {
  const esperado = tokenEsperado()
  if (!esperado) return false
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------------------------------------------------------------- API de Pexels

type Params = Record<string, unknown>
type Limite = { restantes: number; limite: number } | null

async function pexels(ruta: string, params: Params = {}, limite?: { v: Limite }) {
  const clave = process.env.PEXELS_API_KEY
  if (!clave) throw new Error("PEXELS_API_KEY no esta configurada en el servidor.")
  const url = new URL(ruta, API)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, { headers: { Authorization: clave }, cache: "no-store" })
  const restantes = res.headers.get("x-ratelimit-remaining")
  if (restantes && limite) {
    limite.v = { restantes: Number(restantes), limite: Number(res.headers.get("x-ratelimit-limit")) }
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("Pexels rechazo la clave (401).")
    if (res.status === 404) throw new Error("No existe en Pexels (404). Revisa el id.")
    if (res.status === 429) throw new Error("Limite de peticiones de Pexels agotado (429).")
    throw new Error(`Pexels respondio ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`)
  }
  return res.json()
}

// ---------------------------------------------------------------- formato

/* eslint-disable @typescript-eslint/no-explicit-any */
const resumirFoto = (p: any) => ({
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

const resumirVideo = (v: any) => ({
  id: v.id,
  autor: v.user?.name,
  autor_url: v.user?.url,
  ancho: v.width,
  alto: v.height,
  duracion_s: v.duration,
  pagina: v.url,
  portada: v.image,
  archivos: (v.video_files || [])
    .filter((f: any) => f.link)
    .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))
    .map((f: any) => ({ calidad: f.quality, ancho: f.width, alto: f.height, fps: f.fps, tipo: f.file_type, link: f.link })),
})

const paginado = (d: any, clave: string, resumir: (x: any) => unknown) => ({
  total: d.total_results,
  pagina: d.page,
  por_pagina: d.per_page,
  hay_mas: Boolean(d.next_page),
  resultados: (d[clave] || []).map(resumir),
})

const colecciones = (d: any) => ({
  total: d.total_results,
  pagina: d.page,
  hay_mas: Boolean(d.next_page),
  colecciones: d.collections,
})
/* eslint-enable @typescript-eslint/no-explicit-any */

type Contenido = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
type Resultado = { content: Contenido[]; isError?: boolean }

const texto = (obj: unknown, limite: Limite): Resultado => ({
  content: [
    {
      type: "text",
      text:
        JSON.stringify(obj, null, 2) +
        (limite ? `\n\n(Peticiones restantes este mes: ${limite.restantes}/${limite.limite})` : ""),
    },
  ],
})

// ---------------------------------------------------------------- herramientas

const P_PAGINA = { type: "integer", minimum: 1, description: "Pagina de resultados (por defecto 1)." }
const P_POR_PAGINA = { type: "integer", minimum: 1, maximum: 80, description: "Resultados por pagina, 1-80 (por defecto 15)." }
const P_ORIENTACION = { type: "string", enum: ["landscape", "portrait", "square"], description: "Horizontal, vertical o cuadrada." }
const P_TAMANO = { type: "string", enum: ["large", "medium", "small"], description: "Tamano minimo: large=24MP, medium=12MP, small=4MP." }
const P_ID = { type: "integer", description: "Id en Pexels." }

type Herramienta = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  run: (args: Params, limite: { v: Limite }) => Promise<Resultado>
}

const SOLO_LECTURA = { readOnlyHint: true, openWorldHint: true }

const BASE: Omit<Herramienta, "annotations">[] = [
  {
    name: "buscar_fotos",
    description:
      "Busca fotos en Pexels por palabra clave. Devuelve id, descripcion, autor, tamanos y URLs directas (src.original, src.large2x, src.large, src.medium...). Las busquedas en ingles suelen dar mas resultados.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Que buscar, p. ej. 'cafe colombiano' o 'farmer field'." },
        orientation: P_ORIENTACION,
        size: P_TAMANO,
        color: { type: "string", description: "red, orange, yellow, green, turquoise, blue, violet, pink, brown, black, gray, white o un hex (#ffffff)." },
        locale: { type: "string", description: "Idioma de la busqueda, p. ej. 'es-ES' o 'en-US'." },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
      required: ["query"],
    },
    run: async (a, l) => texto(paginado(await pexels("/v1/search", a, l), "photos", resumirFoto), l.v),
  },
  {
    name: "fotos_destacadas",
    description: "Fotos seleccionadas a mano por el equipo de Pexels (curated). Se renuevan cada hora.",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: async (a, l) => texto(paginado(await pexels("/v1/curated", a, l), "photos", resumirFoto), l.v),
  },
  {
    name: "obtener_foto",
    description: "Datos completos de una foto de Pexels por su id, con todas sus URLs de descarga.",
    inputSchema: { type: "object", properties: { id: P_ID }, required: ["id"] },
    run: async (a, l) => texto(resumirFoto(await pexels(`/v1/photos/${Number(a.id)}`, {}, l)), l.v),
  },
  {
    name: "ver_fotos",
    description:
      "Muestra a Claude una o varias fotos de Pexels (hasta 6) como imagen para mirarlas y elegir. Usa 'small' o 'medium' para no gastar contexto.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 6, description: "Ids de las fotos." },
        tamano: { type: "string", enum: ["tiny", "small", "medium", "large"], description: "Por defecto 'medium'." },
      },
      required: ["ids"],
    },
    run: async (a, l) => {
      const tamano = typeof a.tamano === "string" ? a.tamano : "medium"
      const ids = (Array.isArray(a.ids) ? a.ids : []).slice(0, 6).map(Number)
      const partes = await Promise.all(
        ids.map(async (id): Promise<Contenido[]> => {
          try {
            const foto = await pexels(`/v1/photos/${id}`, {}, l)
            const res = await fetch(foto.src[tamano] || foto.src.medium)
            if (!res.ok) throw new Error(`descarga ${res.status}`)
            const data = Buffer.from(await res.arrayBuffer()).toString("base64")
            return [
              { type: "text", text: `Foto ${id}: ${foto.alt || "sin descripcion"}. Por ${foto.photographer}. ${foto.url}` },
              { type: "image", data, mimeType: res.headers.get("content-type") || "image/jpeg" },
            ]
          } catch (e) {
            return [{ type: "text", text: `No pude cargar la foto ${id}: ${(e as Error).message}` }]
          }
        }),
      )
      return { content: partes.flat() }
    },
  },
  {
    name: "buscar_videos",
    description: "Busca videos en Pexels por palabra clave. Devuelve duracion, portada y los enlaces MP4 de cada calidad.",
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
    run: async (a, l) => texto(paginado(await pexels("/videos/search", a, l), "videos", resumirVideo), l.v),
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
    run: async (a, l) => texto(paginado(await pexels("/videos/popular", a, l), "videos", resumirVideo), l.v),
  },
  {
    name: "obtener_video",
    description: "Datos completos de un video de Pexels por su id, con sus enlaces MP4.",
    inputSchema: { type: "object", properties: { id: P_ID }, required: ["id"] },
    run: async (a, l) => texto(resumirVideo(await pexels(`/videos/videos/${Number(a.id)}`, {}, l)), l.v),
  },
  {
    name: "mis_colecciones",
    description: "Lista las colecciones de MI cuenta de Pexels (la duena de la clave de la API).",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: async (a, l) => texto(colecciones(await pexels("/v1/collections", a, l)), l.v),
  },
  {
    name: "colecciones_destacadas",
    description: "Colecciones destacadas de Pexels.",
    inputSchema: { type: "object", properties: { page: P_PAGINA, per_page: P_POR_PAGINA } },
    run: async (a, l) => texto(colecciones(await pexels("/v1/collections/featured", a, l)), l.v),
  },
  {
    name: "contenido_coleccion",
    description: "Fotos y videos de una coleccion (mia o destacada) por su id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id de la coleccion, p. ej. 'bdwkoub'." },
        type: { type: "string", enum: ["photos", "videos"], description: "Filtrar por tipo. Sin esto trae ambos." },
        sort: { type: "string", enum: ["asc", "desc"] },
        page: P_PAGINA,
        per_page: P_POR_PAGINA,
      },
      required: ["id"],
    },
    run: async (a, l) => {
      const { id, ...resto } = a
      const d = await pexels(`/v1/collections/${encodeURIComponent(String(id))}`, resto, l)
      return texto(
        {
          id: d.id,
          total: d.total_results,
          pagina: d.page,
          hay_mas: Boolean(d.next_page),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          medios: (d.media || []).map((m: any) =>
            m.type === "Video" ? { tipo: "video", ...resumirVideo(m) } : { tipo: "foto", ...resumirFoto(m) },
          ),
        },
        l.v,
      )
    },
  },
]

const HERRAMIENTAS: Herramienta[] = BASE.map((h) => ({ ...h, annotations: SOLO_LECTURA }))

// ---------------------------------------------------------------- JSON-RPC

type Mensaje = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Params }
type Respuesta = Record<string, unknown>

const PROTOCOLOS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

/** Devuelve la respuesta, o `null` si el mensaje era una notificacion. */
export async function manejarMensaje(msg: Mensaje): Promise<Respuesta | null> {
  const { id, method, params } = msg
  const esPeticion = id !== undefined && id !== null
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result })
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

  switch (method) {
    case "initialize": {
      const pedido = typeof params?.protocolVersion === "string" ? params.protocolVersion : ""
      return ok({
        protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[1],
        capabilities: { tools: {} },
        serverInfo: { name: "pexels", title: "Pexels", version: VERSION },
        instructions:
          "Acceso a la API de Pexels (fotos y videos libres de uso). Busca con buscar_fotos o buscar_videos, mira candidatas con ver_fotos y entrega las URLs de src para descargar. Da credito al fotografo cuando se use una imagen.",
      })
    }
    case "ping":
      return esPeticion ? ok({}) : null
    case "tools/list":
      return ok({ tools: HERRAMIENTAS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) })
    case "tools/call": {
      const h = HERRAMIENTAS.find((x) => x.name === params?.name)
      if (!h) return error(-32602, `Herramienta desconocida: ${String(params?.name)}`)
      const limite = { v: null as Limite }
      try {
        return ok(await h.run((params?.arguments as Params) || {}, limite))
      } catch (e) {
        return ok({ isError: true, content: [{ type: "text", text: (e as Error).message }] })
      }
    }
    default:
      return esPeticion ? error(-32601, `Metodo no soportado: ${String(method)}`) : null
  }
}
