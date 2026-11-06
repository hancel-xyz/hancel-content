import { NextResponse } from "next/server"

import { manejarMensaje, tokenValido } from "@/engine/pexels-mcp"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Endpoint MCP de Pexels para los conectores personalizados de claude.ai.
 *
 * Es publico a proposito (lo llaman los servidores de Anthropic, no un navegador
 * con sesion), asi que la autorizacion es el token de la URL. Ver
 * `engine/pexels-mcp.ts`.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
}

type Ctx = { params: Promise<{ token: string }> }

async function autorizado(ctx: Ctx) {
  const { token } = await ctx.params
  return tokenValido(token)
}

export async function POST(request: Request, ctx: Ctx) {
  if (!(await autorizado(ctx))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: CORS })
  }

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalido" } },
      { status: 400, headers: CORS },
    )
  }

  const lote = Array.isArray(cuerpo)
  const mensajes = (lote ? cuerpo : [cuerpo]) as Parameters<typeof manejarMensaje>[0][]
  const respuestas = (await Promise.all(mensajes.map(manejarMensaje))).filter((r) => r !== null)

  // Solo notificaciones: se aceptan sin cuerpo.
  if (respuestas.length === 0) return new Response(null, { status: 202, headers: CORS })

  return NextResponse.json(lote ? respuestas : respuestas[0], { headers: CORS })
}

/** Sin sesiones ni notificaciones del servidor: no hay stream que abrir. */
export async function GET(_request: Request, ctx: Ctx) {
  if (!(await autorizado(ctx))) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: CORS })
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } })
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
