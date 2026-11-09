import { NextResponse } from "next/server"

import { todasLasCuentas } from "@/engine/accounts"
import { sincronizarMetricas, VENTANA_CORTA } from "@/engine/metricas"
import { getSettings, hourIn } from "@/engine/schedule"
import { redesMetaListas } from "@/engine/publish/meta"
import { traerMetricasPortal } from "@/engine/web/metricas-portal"
import { authorizeEngineRequest } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/** La pasada diaria de 60 dias tarda unos cuatro minutos. */
export const maxDuration = 300

/**
 * El tick de metricas: trae de Meta las cifras de los posts publicados desde
 * Hancel y las metricas diarias de la cuenta. Lo llama el cron de Postgres cada
 * hora (fire_metricas_tick). Tambien lee el resumen del portal de cada empresa
 * con portal conectado. Lo de Meta, solo las empresas con Instagram o Facebook
 * conectados. Cada hora, los posts de los ultimos dias; a las 4 de la mañana
 * (hora de la empresa), los de los ultimos 60. `?cuenta=<slug>` corre una sola
 * y `?dias=N` fuerza la ventana.
 */
async function handle(request: Request) {
  const denied = authorizeEngineRequest(request)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })

  const params = new URL(request.url).searchParams
  const soloCuenta = params.get("cuenta")
  const forzados = Number(params.get("dias")) || null
  const corridas: unknown[] = []
  for (const cuenta of (await todasLasCuentas()).filter((c) => !soloCuenta || c.slug === soloCuenta)) {
    try {
      // El portal primero: es una sola peticion y no depende de Meta.
      const portal = await traerMetricasPortal(cuenta.id)
      const redes = await redesMetaListas(cuenta.id)
      if (!redes.instagram && !redes.facebook) {
        if (portal) corridas.push({ cuenta: cuenta.slug, portal })
        continue
      }
      const { timezone } = await getSettings(cuenta.id)
      const dias = forzados ?? (hourIn(timezone, new Date()) === 4 ? 60 : VENTANA_CORTA)
      corridas.push({ cuenta: cuenta.slug, portal, ventana: dias, ...(await sincronizarMetricas(cuenta.id, redes, dias)) })
    } catch (error) {
      corridas.push({ cuenta: cuenta.slug, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ corridas })
}

export const GET = handle
export const POST = handle
