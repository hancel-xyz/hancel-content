import { DashboardShell } from "@/components/dashboard-shell"
import { Metricas } from "@/components/metricas/metricas"
import { getMetricas } from "@/lib/metricas-data"

export const dynamic = "force-dynamic"

export const metadata = { title: "Métricas · Engine Hancel" }

/**
 * Las metricas de cada post publicado desde Hancel en Instagram y Facebook, y
 * el promedio por post de la cuenta. Las trae el tick de metricas cada hora.
 */
export default async function MetricasPage() {
  const vista = await getMetricas()
  return (
    <DashboardShell title="Métricas">
      <Metricas vista={vista} />
    </DashboardShell>
  )
}
