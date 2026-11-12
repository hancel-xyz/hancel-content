import { NextResponse } from "next/server"

import { cuentaPorSlug, todasLasCuentas } from "@/engine/accounts"
import { armarLosDeHoy, pasadaPrecios, publicarCarruselPrecios, rehacerCarrusel } from "@/engine/precios/pipeline"
import { authorizeEngineRequest } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/** Dibujar siete laminas y publicar un carrusel en dos redes tarda minutos. */
export const maxDuration = 300

/**
 * El tick del pipeline de precios: arma los carruseles de precios cuando hay
 * datos nuevos de Sandia y los publica a su hora. Lo llama el cron de Postgres
 * cada cinco minutos (fire_precios_tick). Solo hace algo en las cuentas con los
 * precios activados. `?cuenta=<slug>` corre una sola.
 */
async function handle(request: Request) {
  const denied = authorizeEngineRequest(request)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })

  const params = new URL(request.url).searchParams
  const soloCuenta = params.get("cuenta")
  const now = new Date()

  // Lo que piden los botones del tablero, para una cuenta: armar ahora (fuera
  // de la ventana), publicar ya un carrusel, o rehacerlo con datos frescos.
  const armar = params.get("armar")
  const publicar = params.get("publicar")
  const rehacer = params.get("rehacer")
  if (soloCuenta && (armar || publicar || rehacer)) {
    const cuenta = await cuentaPorSlug(soloCuenta)
    if (!cuenta) return NextResponse.json({ error: "Cuenta desconocida." }, { status: 404 })
    try {
      const resultado =
        armar === "dia" || armar === "semana"
          ? await armarLosDeHoy(cuenta.id, now, { forzar: true, periodo: armar })
          : publicar
            ? await publicarCarruselPrecios(cuenta.id, publicar)
            : (await rehacerCarrusel(cuenta.id, rehacer!, now), { ok: true })
      return NextResponse.json({ at: now.toISOString(), cuenta: cuenta.slug, resultado })
    } catch (error) {
      return NextResponse.json({ at: now.toISOString(), error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  }

  const corridas: unknown[] = []
  for (const cuenta of (await todasLasCuentas()).filter((c) => !soloCuenta || c.slug === soloCuenta)) {
    try {
      corridas.push({ cuenta: cuenta.slug, ...(await pasadaPrecios(cuenta.id, now)) })
    } catch (error) {
      corridas.push({ cuenta: cuenta.slug, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ at: now.toISOString(), corridas })
}

export async function POST(request: Request) {
  return handle(request)
}

export async function GET(request: Request) {
  return handle(request)
}
