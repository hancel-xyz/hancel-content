import Link from "next/link"

import { DashboardShell } from "@/components/dashboard-shell"
import { Metricas } from "@/components/metricas/metricas"
import { MetricasPortal } from "@/components/metricas/metricas-portal"
import { getMetricas } from "@/lib/metricas-data"
import { getMetricasPortal } from "@/lib/metricas-portal-data"

export const dynamic = "force-dynamic"

export const metadata = { title: "Métricas · Engine Hancel" }

const PESTANAS = [
  { id: "redes", nombre: "Redes sociales" },
  { id: "portal", nombre: "Portal" },
] as const

/**
 * Metricas: lo publicado desde Hancel en Instagram y Facebook (pestaña Redes sociales) y el
 * portal de la empresa (pestaña Portal). Las dos las trae el tick de metricas cada hora.
 */
export default async function MetricasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pestana = (await searchParams).vista === "portal" ? "portal" : "redes"
  return (
    <DashboardShell title="Métricas">
      <div className="flex flex-col gap-4">
        <nav className="border-b" aria-label="Métricas">
          <ul className="-mb-px flex gap-4">
            {PESTANAS.map((p) => (
              <li key={p.id}>
                <Link
                  href={p.id === "redes" ? "/metricas" : "/metricas?vista=portal"}
                  aria-current={pestana === p.id ? "page" : undefined}
                  className={`inline-block border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                    pestana === p.id ? "border-foreground text-foreground" : "text-muted-foreground hover:text-foreground border-transparent"
                  }`}
                >
                  {p.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {pestana === "portal" ? <MetricasPortal vista={await getMetricasPortal()} /> : <Metricas vista={await getMetricas()} />}
      </div>
    </DashboardShell>
  )
}
