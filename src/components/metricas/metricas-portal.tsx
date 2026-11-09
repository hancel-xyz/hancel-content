"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import type { NoticiaDiaPortal, PortalVista } from "@/lib/metricas-portal-data"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { compacto, Dato, decimal, etiquetaDia, fmt, mayuscula, moverDia, Segmentos, suma } from "./metricas"

type Periodo = 7 | 30 | 60 | 0

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 7, nombre: "7 días" },
  { id: 30, nombre: "30 días" },
  { id: 60, nombre: "60 días" },
  { id: 0, nombre: "Todo" },
]

/**
 * Los canales, en el orden fijo de la paleta (no por tamaño: un canal conserva su color aunque
 * cambie el periodo). Facebook e Instagram llevan los mismos colores que en Redes sociales.
 */
const CANALES = [
  { id: "facebook", nombre: "Facebook", color: "var(--canal-1)" },
  { id: "instagram", nombre: "Instagram", color: "var(--canal-2)" },
  { id: "google", nombre: "Google", color: "var(--canal-3)" },
  { id: "directo", nombre: "Directo", color: "var(--canal-4)" },
  { id: "whatsapp", nombre: "WhatsApp", color: "var(--canal-5)" },
  { id: "sandia", nombre: "Sandia (precios)", color: "var(--canal-6)" },
  { id: "otros", nombre: "Otros", color: "var(--canal-7)" },
] as const
type IdCanal = (typeof CANALES)[number]["id"]

const AGRUPAR: Record<string, IdCanal> = { x: "otros", buscadores: "otros", referidos: "otros", interno: "otros" }
const grupo = (canal: string): IdCanal => AGRUPAR[canal] ?? ((CANALES.some((c) => c.id === canal) ? canal : "otros") as IdCanal)
const NOMBRE_CANAL = Object.fromEntries(CANALES.map((c) => [c.id, c.nombre])) as Record<IdCanal, string>
const COLOR_CANAL = Object.fromEntries(CANALES.map((c) => [c.id, c.color])) as Record<IdCanal, string>

const PALETA =
  "[--canal-1:#2a78d6] [--canal-2:#eb6834] [--canal-3:#1baf7a] [--canal-4:#eda100] [--canal-5:#e87ba4] [--canal-6:#008300] [--canal-7:#6250d6] " +
  "dark:[--canal-1:#3987e5] dark:[--canal-2:#d95926] dark:[--canal-3:#199e70] dark:[--canal-4:#c98500] dark:[--canal-5:#d55181] dark:[--canal-6:#008300] dark:[--canal-7:#9085e9]"

function duracion(s: number | null | undefined): string {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return m ? `${m} min ${r.toString().padStart(2, "0")} s` : `${r} s`
}

const pct = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : `${decimal.format(n * 100)} %`)

function Punto({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-1.5 px-4">
        <span className="text-muted-foreground text-sm">{titulo}</span>
        <span className="text-3xl font-semibold tracking-tight">{valor}</span>
        {nota ? <span className="text-muted-foreground text-xs">{nota}</span> : null}
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------- graficas

type Fila = { dia: string } & Record<string, number | string>
type Serie = { clave: string; nombre: string; color: string }
type EntradaTooltip = { payload?: Fila }

function TooltipSeries({ active, payload, series, formato }: { active?: boolean; payload?: EntradaTooltip[]; series: Serie[]; formato: (n: number) => string }) {
  const fila = active ? payload?.[0]?.payload : undefined
  if (!fila) return null
  const valores = series.map((s) => ({ ...s, v: Number(fila[s.clave] ?? 0) })).filter((s) => s.v > 0 || series.length === 1)
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{mayuscula(etiquetaDia(fila.dia, true))}</div>
      {valores.length === 0 ? <div className="text-muted-foreground">Sin datos</div> : null}
      {valores.map((s) => (
        <div key={s.clave} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5">
            <Punto color={s.color} />
            {s.nombre}
          </span>
          <span className="tabular-nums">{formato(s.v)}</span>
        </div>
      ))}
      {series.length > 1 && valores.length > 1 ? (
        <div className="mt-1 flex justify-between gap-4 border-t pt-1 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formato(suma(valores.map((s) => s.v)))}</span>
        </div>
      ) : null}
    </div>
  )
}

function Barras({ datos, series, formato = (n) => fmt(n), eje = (n) => compacto.format(n), alto = "h-56" }: { datos: Fila[]; series: Serie[]; formato?: (n: number) => string; eje?: (n: number) => string; alto?: string }) {
  const hay = datos.some((d) => series.some((s) => Number(d[s.clave] ?? 0) > 0))
  if (!hay) return <p className="text-muted-foreground py-10 text-center text-sm">Sin datos en este periodo.</p>
  return (
    <div className={`${alto} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="dia" tickFormatter={(d: string) => etiquetaDia(d)} tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={18} />
          <YAxis tickFormatter={eje} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={48} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<TooltipSeries series={series} formato={formato} />} />
          {series.map((s, i) => (
            <Bar key={s.clave} dataKey={s.clave} stackId="a" fill={s.color} stroke="var(--card)" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Leyenda({ series }: { series: Serie[] }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {series.map((s) => (
        <span key={s.clave} className="inline-flex items-center gap-1.5">
          <Punto color={s.color} />
          {s.nombre}
        </span>
      ))}
    </div>
  )
}

/** Una lista de barras horizontales: nombre, barra proporcional, cifra y porcentaje. */
function Ranking({ filas, total }: { filas: { nombre: string; valor: number; color?: string }[]; total: number }) {
  const max = Math.max(1, ...filas.map((f) => f.valor))
  if (!filas.length) return <p className="text-muted-foreground text-sm">Sin datos en este periodo.</p>
  return (
    <ul className="flex flex-col gap-2.5">
      {filas.map((f) => (
        <li key={f.nombre} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              {f.color ? <Punto color={f.color} /> : null}
              {f.nombre}
            </span>
            <span className="tabular-nums">
              {fmt(f.valor)} <span className="text-muted-foreground text-xs">· {pct(total ? f.valor / total : null)}</span>
            </span>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="h-full rounded-full" style={{ width: `${(f.valor / max) * 100}%`, background: f.color ?? "var(--muted-foreground)" }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

// --------------------------------------------------------------- noticias

type Columna = "visitantes" | "vistas" | "segundos" | "scroll" | "lecturas" | "desde_enlaces" | "clics_portada" | "compartidos"
type Orden = { col: Columna; desc: boolean }

type NoticiaPeriodo = {
  id: string
  titular: string
  slug: string | null
  visitantes: number
  vistas: number
  segundos: number
  scroll: number
  lecturas: number
  desde_enlaces: number
  clics_portada: number
  compartidos: number
  canal: IdCanal | null
}

function Cabecera({ col, orden, onOrden, children }: { col: Columna; orden: Orden; onOrden: (o: Orden) => void; children: React.ReactNode }) {
  return (
    <TableHead className="text-right">
      <button type="button" onClick={() => onOrden({ col, desc: orden.col === col ? !orden.desc : true })} className="hover:text-foreground inline-flex items-center gap-1">
        {children}
        {orden.col === col ? orden.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" /> : null}
      </button>
    </TableHead>
  )
}

// ---------------------------------------------------------------- pantalla

export function MetricasPortal({ vista }: { vista: PortalVista }) {
  const [periodo, setPeriodo] = React.useState<Periodo>(30)
  const [orden, setOrden] = React.useState<Orden>({ col: "visitantes", desc: true })
  const [ahora] = React.useState(() => Date.now())

  if (!vista.conectado) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="text-muted-foreground py-8 text-sm">
          Esta empresa no tiene un portal conectado. Se conecta en Configuración → Conexiones (webhook del portal).
        </CardContent>
      </Card>
    )
  }

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: vista.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ahora))
  const masViejo = vista.dias.length ? vista.dias[vista.dias.length - 1].dia : hoy
  const primerDia = periodo ? moverDia(hoy, -(periodo - 1)) : masViejo < hoy ? masViejo : hoy
  const dias: string[] = []
  for (let d = primerDia; d <= hoy; d = moverDia(d, 1)) dias.push(d)

  const porDia = new Map(vista.dias.map((d) => [d.dia, d]))
  const delPeriodo = vista.dias.filter((d) => d.dia >= primerDia)

  // Personas distintas en el periodo: el portal las cuenta en ventanas que terminan hoy.
  const personas = vista.ventana[periodo ? String(periodo) : "todo"] ?? suma(delPeriodo.map((d) => d.visitantes))
  const nuevos = suma(delPeriodo.map((d) => d.nuevos))
  const vistas = suma(delPeriodo.map((d) => d.vistas))
  const sesiones = suma(delPeriodo.map((d) => d.sesiones))

  const filasNoticia = vista.noticias.filter((n) => n.dia >= primerDia)
  const vistasNoticia = suma(filasNoticia.map((n) => n.vistas))
  const lectura = vistasNoticia ? suma(filasNoticia.map((n) => n.segundos_promedio * n.vistas)) / vistasNoticia : 0

  const enlaces = {
    visitas: suma(delPeriodo.map((d) => d.enlaces?.vistas)),
    personas: suma(delPeriodo.map((d) => d.enlaces?.visitantes)),
    clics: suma(delPeriodo.map((d) => d.enlaces?.clics_portadas)),
    personasClic: suma(delPeriodo.map((d) => d.enlaces?.visitantes_portadas)),
    alertas: suma(delPeriodo.map((d) => d.enlaces?.clics_alertas)),
    personasAlertas: suma(delPeriodo.map((d) => d.enlaces?.visitantes_alertas)),
  }

  // Personas por dia y canal.
  const seriesCanal: Serie[] = CANALES.map((c) => ({ clave: c.id, nombre: c.nombre, color: c.color }))
  const datosCanal: Fila[] = dias.map((dia) => {
    const fila: Fila = { dia }
    for (const c of CANALES) fila[c.id] = 0
    for (const [canal, v] of Object.entries(porDia.get(dia)?.canales ?? {})) {
      const g = grupo(canal)
      fila[g] = Number(fila[g]) + (v?.visitantes ?? 0)
    }
    return fila
  })
  const totalCanal = Object.fromEntries(CANALES.map((c) => [c.id, suma(datosCanal.map((d) => Number(d[c.id])))])) as Record<IdCanal, number>
  const sumaCanales = suma(Object.values(totalCanal))
  const seriesConDatos = seriesCanal.filter((s) => totalCanal[s.clave as IdCanal] > 0)

  const datosLectura: Fila[] = dias.map((dia) => ({ dia, lectura: porDia.get(dia)?.segundos_lectura ?? 0 }))
  const datosEnlaces: Fila[] = dias.map((dia) => ({
    dia,
    portadas: porDia.get(dia)?.enlaces?.clics_portadas ?? 0,
    alertas: porDia.get(dia)?.enlaces?.clics_alertas ?? 0,
  }))

  const dispositivos: Record<string, number> = {}
  const ciudades: Record<string, number> = {}
  for (const d of delPeriodo) {
    for (const [k, v] of Object.entries(d.dispositivos ?? {})) dispositivos[k] = (dispositivos[k] ?? 0) + v
    for (const [k, v] of Object.entries(d.ciudades ?? {})) ciudades[k] = (ciudades[k] ?? 0) + v
  }
  const NOMBRE_DISP: Record<string, string> = { movil: "Celular", escritorio: "Computador", tableta: "Tableta", otro: "Otro" }

  // Noticias del periodo. Con "Todo", las personas salen del acumulado (exacto); en un periodo
  // se suman las de cada dia, y quien volvio otro dia cuenta dos veces.
  const meta = new Map(vista.acumulado.map((a) => [a.noticia_id, a]))
  const agrupadas = new Map<string, NoticiaDiaPortal[]>()
  for (const n of filasNoticia) agrupadas.set(n.noticia_id, [...(agrupadas.get(n.noticia_id) ?? []), n])
  const noticias: NoticiaPeriodo[] = [...agrupadas].map(([id, filas]) => {
    const a = meta.get(id)
    const v = suma(filas.map((f) => f.vistas))
    const canales: Record<string, number> = {}
    for (const f of filas) for (const [k, n] of Object.entries(f.canales ?? {})) canales[grupo(k)] = (canales[grupo(k)] ?? 0) + n
    const principal = Object.entries(canales).sort((x, y) => y[1] - x[1])[0]?.[0] as IdCanal | undefined
    return {
      id,
      titular: a?.titular ?? "Noticia sin título",
      slug: a?.slug ?? null,
      visitantes: periodo === 0 && a ? a.visitantes : suma(filas.map((f) => f.visitantes)),
      vistas: v,
      segundos: v ? suma(filas.map((f) => f.segundos_promedio * f.vistas)) / v : 0,
      scroll: v ? suma(filas.map((f) => f.scroll_promedio * f.vistas)) / v : 0,
      lecturas: suma(filas.map((f) => f.lecturas)),
      desde_enlaces: periodo === 0 && a ? a.desde_enlaces : suma(filas.map((f) => f.desde_enlaces)),
      clics_portada: suma(filas.map((f) => f.clics_portada)),
      compartidos: suma(filas.map((f) => f.compartidos)),
      canal: principal ?? null,
    }
  })
  const ordenadas = [...noticias].sort((x, y) => (orden.desc ? y[orden.col] - x[orden.col] : x[orden.col] - y[orden.col]))

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: vista.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))

  return (
    <div className={`flex flex-col gap-4 ${PALETA}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Segmentos opciones={PERIODOS} valor={periodo} onChange={setPeriodo} />
        <span className="text-muted-foreground ml-auto text-xs">
          {vista.error ? <span className="text-destructive">Última lectura con error: {vista.error.slice(0, 120)} · </span> : null}
          {vista.leidoAt ? `Actualizado ${fecha(vista.leidoAt)} · se refresca cada hora` : "Aún no se ha leído el portal"}
        </span>
      </div>

      {vista.dias.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-sm">
            El portal mide desde el 9 de noviembre de 2026. Las cifras aparecen en la próxima lectura, cada hora.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra
          titulo="Personas"
          valor={fmt(personas)}
          nota={`Estimado de personas distintas (un navegador = una persona). ${fmt(nuevos)} llegaron por primera vez.`}
        />
        <Cifra titulo="Páginas vistas" valor={fmt(vistas)} nota={`${fmt(sesiones)} visitas · ${decimal.format(sesiones ? vistas / sesiones : 0)} páginas por visita`} />
        <Cifra titulo="Tiempo de lectura" valor={duracion(lectura)} nota="Promedio por noticia abierta, solo con la página a la vista y en uso." />
        <Cifra
          titulo="Desde la página de enlaces"
          valor={fmt(enlaces.personasClic)}
          nota={`Personas que tocaron una portada (${fmt(enlaces.clics)} clics). ${fmt(enlaces.alertas)} clics en alertas de precios.`}
        />
      </div>

      <Card>
        <CardHeader className="pb-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Personas por día y canal</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">De dónde llegó cada visita: el canal es el de su primera página.</p>
            </div>
            <Leyenda series={seriesConDatos.length ? seriesConDatos : seriesCanal} />
          </div>
        </CardHeader>
        <CardContent>
          <Barras datos={datosCanal} series={seriesCanal} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">De dónde vienen</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">Personas por canal en el periodo.</p>
          </CardHeader>
          <CardContent>
            <Ranking
              total={sumaCanales}
              filas={CANALES.filter((c) => totalCanal[c.id] > 0)
                .map((c) => ({ nombre: c.nombre, valor: totalCanal[c.id], color: c.color }))
                .sort((x, y) => y.valor - x.valor)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Página de enlaces</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">La del link de la bio: cuánta gente entra y cuánta sigue a una noticia o a las alertas.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Dato etiqueta="Personas que entraron" valor={fmt(enlaces.personas)} />
              <Dato etiqueta="Tocaron una portada" valor={fmt(enlaces.personasClic)} />
              <Dato etiqueta="Tasa de clic" valor={pct(enlaces.personas ? enlaces.personasClic / enlaces.personas : null)} ayuda="Personas que tocaron alguna portada sobre personas que entraron." />
              <Dato etiqueta="Clics en portadas" valor={fmt(enlaces.clics)} />
              <Dato etiqueta="Clics en alertas" valor={fmt(enlaces.alertas)} />
              <Dato etiqueta="Personas a alertas" valor={fmt(enlaces.personasAlertas)} />
            </div>
            <Leyenda
              series={[
                { clave: "portadas", nombre: "Clics en portadas", color: "var(--canal-2)" },
                { clave: "alertas", nombre: "Clics en alertas", color: "var(--canal-6)" },
              ]}
            />
            <Barras
              alto="h-36"
              datos={datosEnlaces}
              series={[
                { clave: "portadas", nombre: "Clics en portadas", color: "var(--canal-2)" },
                { clave: "alertas", nombre: "Clics en alertas", color: "var(--canal-6)" },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Noticias ({fmt(ordenadas.length)})</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {periodo === 0
              ? "Personas distintas por noticia desde que se mide."
              : "Personas sumadas día a día: quien volvió otro día cuenta otra vez. En «Todo» son personas distintas."}{" "}
            Lecturas completas: bajó al 75 % o se quedó un minuto o más.
          </p>
        </CardHeader>
        <CardContent>
          {ordenadas.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Ninguna noticia recibió visitas en este periodo.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Noticia</TableHead>
                  <Cabecera orden={orden} onOrden={setOrden} col="visitantes">Personas</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="vistas">Vistas</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="segundos">Tiempo</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="scroll">Scroll</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="lecturas">Lecturas</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="desde_enlaces">Desde enlaces</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="compartidos">Compart.</Cabecera>
                  <TableHead>Canal principal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenadas.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="max-w-md">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm" title={n.titular}>
                          {n.titular}
                        </span>
                        {n.slug && vista.urlPortal ? (
                          <a href={`${vista.urlPortal}/noticias/${n.slug}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Abrir la noticia">
                            <ExternalLinkIcon className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmt(n.visitantes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(n.vistas)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{duracion(n.segundos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.scroll ? `${Math.round(n.scroll)} %` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(n.vistas ? n.lecturas / n.vistas : null)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(n.desde_enlaces)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(n.compartidos)}</TableCell>
                    <TableCell>
                      {n.canal ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Punto color={COLOR_CANAL[n.canal]} />
                          {NOMBRE_CANAL[n.canal]}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tiempo de lectura por día</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">Promedio por noticia abierta.</p>
          </CardHeader>
          <CardContent>
            <Barras
              alto="h-40"
              datos={datosLectura}
              series={[{ clave: "lectura", nombre: "Tiempo de lectura", color: "var(--canal-7)" }]}
              formato={duracion}
              eje={(n) => `${Math.round(n)} s`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dispositivos</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">Personas por tipo de dispositivo.</p>
          </CardHeader>
          <CardContent>
            <Ranking
              total={suma(Object.values(dispositivos))}
              filas={Object.entries(dispositivos)
                .map(([k, v]) => ({ nombre: NOMBRE_DISP[k] ?? k, valor: v }))
                .sort((x, y) => y.valor - x.valor)}
            />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Dato
                etiqueta="Rebote"
                valor={pct(sesiones ? suma(delPeriodo.map((d) => d.rebote * d.sesiones)) / sesiones : null)}
                ayuda="Visitas que vieron una sola página y se fueron."
              />
              <Dato etiqueta="Nuevas personas" valor={fmt(nuevos)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ciudades</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">Personas por ciudad (aproximada por la conexión).</p>
          </CardHeader>
          <CardContent>
            <Ranking
              total={suma(Object.values(ciudades))}
              filas={Object.entries(ciudades)
                .map(([k, v]) => ({ nombre: k, valor: v }))
                .sort((x, y) => y.valor - x.valor)
                .slice(0, 8)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
