"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import type { MetricasVista, PostMetrica } from "@/lib/metricas-data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Red = "instagram" | "facebook"
type Periodo = 7 | 30 | 60 | 0
type Columna = "publicado_at" | "vistas" | "alcance" | "me_gusta" | "comentarios" | "compartidos" | "guardados" | "interacciones" | "tasa"
type Orden = { col: Columna; desc: boolean }

const REDES: Red[] = ["instagram", "facebook"]
const NOMBRE_RED: Record<Red, string> = { instagram: "Instagram", facebook: "Facebook" }
/** Cada red tiene su color en toda la pantalla; se definen como variables en la raiz (claro y oscuro). */
const COLOR: Record<Red, string> = { instagram: "var(--serie-ig)", facebook: "var(--serie-fb)" }

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 7, nombre: "7 días" },
  { id: 30, nombre: "30 días" },
  { id: 60, nombre: "60 días" },
  { id: 0, nombre: "Todo" },
]

export const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })
export const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })
export const compacto = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 })

export const fmt = (n: number | null | undefined) => (n == null ? "—" : numero.format(n))
const pct = (n: number | null) => (n == null ? "—" : `${decimal.format(n * 100)} %`)
export const suma = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)

function tasa(p: Pick<PostMetrica, "interacciones" | "alcance">): number | null {
  return p.alcance && p.interacciones != null ? p.interacciones / p.alcance : null
}

function promedio(posts: PostMetrica[], campo: keyof PostMetrica): number | null {
  const vals = posts.map((p) => p[campo]).filter((v): v is number => typeof v === "number")
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** La tasa de la cuenta: interacciones sobre alcance de todos los posts, no el promedio de tasas. */
function tasaGlobal(posts: PostMetrica[]): number | null {
  const conAlcance = posts.filter((p) => p.alcance && p.interacciones != null)
  const alcance = suma(conAlcance.map((p) => p.alcance))
  return alcance ? suma(conAlcance.map((p) => p.interacciones)) / alcance : null
}

/** "2026-11-08" -> el dia siguiente o anterior. */
export function moverDia(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const etiquetaDia = (dia: string, largo = false) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short", ...(largo ? { weekday: "long" } : {}) }).format(new Date(`${dia}T12:00:00Z`))

export const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// ------------------------------------------------------------ piezas chicas

export function Segmentos<T extends string | number>({ opciones, valor, onChange }: { opciones: { id: T; nombre: string }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="bg-muted inline-flex rounded-lg p-[3px]">
      {opciones.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1 text-sm transition-colors ${
            valor === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  )
}

function Punto({ red }: { red: Red }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: COLOR[red] }} />
}

/** Un numero grande con el desglose por red debajo. */
function Cifra({ titulo, total, porRed, redes, nota }: { titulo: string; total: number; porRed: Record<Red, number>; redes: Red[]; nota?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <span className="text-muted-foreground text-sm">{titulo}</span>
        <span className="text-3xl font-semibold tracking-tight">{fmt(total)}</span>
        {redes.length > 1 ? (
          <div className="flex flex-col gap-1">
            <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
              {redes.map((r) =>
                total > 0 && porRed[r] > 0 ? <div key={r} style={{ width: `${(porRed[r] / total) * 100}%`, background: COLOR[r] }} className="h-full" /> : null
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
              {redes.map((r) => (
                <span key={r} className="inline-flex items-center gap-1.5">
                  <Punto red={r} />
                  {NOMBRE_RED[r]} <span className="text-foreground font-medium">{fmt(porRed[r])}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {nota ? <span className="text-muted-foreground text-xs">{nota}</span> : null}
      </CardContent>
    </Card>
  )
}

export function Dato({ etiqueta, valor, ayuda }: { etiqueta: string; valor: string; ayuda?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={ayuda}>
      <span className="text-muted-foreground text-xs">{etiqueta}</span>
      <span className="text-xl font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

function Miniatura({ src }: { src: string | null }) {
  const [roto, setRoto] = React.useState(false)
  if (!src || roto) return <div className="bg-muted size-10 shrink-0 rounded" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setRoto(true)} className="size-10 shrink-0 rounded object-cover" />
}

function Cabecera({ col, orden, onOrden, children, className = "" }: { col: Columna; orden: Orden; onOrden: (o: Orden) => void; children: React.ReactNode; className?: string }) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onOrden({ col, desc: orden.col === col ? !orden.desc : true })}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {children}
        {orden.col === col ? orden.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" /> : null}
      </button>
    </TableHead>
  )
}

// ----------------------------------------------------------------- grafica

type FilaDia = { dia: string } & Record<string, number | string>

type EntradaTooltip = { dataKey?: string | number; value?: number; payload?: FilaDia }

function TooltipDia({ active, payload, redes, clave }: { active?: boolean; payload?: EntradaTooltip[]; redes: Red[]; clave: string }) {
  if (!active || !payload?.length) return null
  const fila = payload[0].payload
  if (!fila) return null
  const valores = redes.map((r) => ({ r, v: Number(fila[`${clave}_${r}`] ?? 0) }))
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{mayuscula(etiquetaDia(fila.dia, true))}</div>
      {valores.map(({ r, v }) => (
        <div key={r} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5">
            <Punto red={r} />
            {NOMBRE_RED[r]}
          </span>
          <span className="tabular-nums">{fmt(v)}</span>
        </div>
      ))}
      {redes.length > 1 ? (
        <div className="mt-1 flex justify-between gap-4 border-t pt-1 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{fmt(suma(valores.map((x) => x.v)))}</span>
        </div>
      ) : null}
      <div className="text-muted-foreground mt-1">Clic para ver ese día</div>
    </div>
  )
}

/**
 * Barras por dia, apiladas por red. Una sola escala: cada medida va en su
 * propia grafica. Clic en una barra elige ese dia.
 */
function GraficaDiaria({
  titulo,
  descripcion,
  datos,
  clave,
  redes,
  seleccionado,
  onElegir,
}: {
  titulo: string
  descripcion: string
  datos: FilaDia[]
  clave: string
  redes: Red[]
  seleccionado: string
  onElegir: (dia: string) => void
}) {
  const totalDe = (d: FilaDia) => suma(redes.map((r) => Number(d[`${clave}_${r}`] ?? 0)))
  const total = suma(datos.map(totalDe))
  // Se resalta el dia elegido solo si en esta grafica tiene algo; si no, todas las barras a color pleno.
  const resaltar = datos.some((d) => d.dia === seleccionado && totalDe(d) > 0)
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{titulo}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{descripcion}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {redes.map((r) => (
              <span key={r} className="text-muted-foreground inline-flex items-center gap-1.5">
                <Punto red={r} />
                {NOMBRE_RED[r]}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">Sin datos en este periodo.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datos} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="dia"
                  tickFormatter={(d: string) => etiquetaDia(d)}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  minTickGap={18}
                />
                <YAxis
                  tickFormatter={(v: number) => compacto.format(v)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  width={44}
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<TooltipDia redes={redes} clave={clave} />} />
                {redes.map((r, i) => (
                  <Bar
                    key={r}
                    dataKey={`${clave}_${r}`}
                    stackId="a"
                    fill={COLOR[r]}
                    stroke="var(--card)"
                    strokeWidth={1}
                    radius={i === redes.length - 1 ? [4, 4, 0, 0] : 0}
                    className="cursor-pointer"
                    onClick={(e: { payload?: FilaDia }) => e.payload && onElegir(e.payload.dia)}
                    isAnimationActive={false}
                  >
                    {datos.map((d) => (
                      <Cell key={d.dia} fillOpacity={!resaltar || d.dia === seleccionado ? 1 : 0.4} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- promedios

function Promedios({ red, posts }: { red: Red; posts: PostMetrica[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Punto red={red} />
          {NOMBRE_RED[red]}
          <span className="text-muted-foreground text-sm font-normal">· promedio por post ({fmt(posts.length)} posts)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin posts en este periodo.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Vistas" valor={fmt(promedio(posts, "vistas"))} />
            <Dato
              etiqueta={red === "facebook" ? "Espectadores únicos" : "Alcance"}
              valor={fmt(promedio(posts, "alcance"))}
              ayuda={red === "facebook" ? "Facebook ya no da el alcance por post: es el número de personas distintas que vieron el post." : "Cuentas distintas que vieron el post."}
            />
            <Dato etiqueta="Interacciones" valor={decimal.format(promedio(posts, "interacciones") ?? 0)} />
            <Dato etiqueta="Tasa de interacción" valor={pct(tasaGlobal(posts))} ayuda="Interacciones sobre alcance, sumando todos los posts del periodo." />
            <Dato etiqueta={red === "facebook" ? "Reacciones" : "Me gusta"} valor={decimal.format(promedio(posts, "me_gusta") ?? 0)} />
            <Dato etiqueta="Comentarios" valor={decimal.format(promedio(posts, "comentarios") ?? 0)} />
            <Dato etiqueta="Compartidos" valor={decimal.format(promedio(posts, "compartidos") ?? 0)} />
            {red === "instagram" ? <Dato etiqueta="Guardados" valor={decimal.format(promedio(posts, "guardados") ?? 0)} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- pantalla

export function Metricas({ vista }: { vista: MetricasVista }) {
  const [periodo, setPeriodo] = React.useState<Periodo>(30)
  const [filtroRed, setFiltroRed] = React.useState<Red | "todas">("todas")
  const [orden, setOrden] = React.useState<Orden>({ col: "publicado_at", desc: true })
  // El momento de abrir la pagina: los periodos y "hoy" se cuentan desde ahi.
  const [ahora] = React.useState(() => Date.now())

  const diaDe = React.useMemo(() => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: vista.timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    return (iso: string | number) => f.format(new Date(iso))
  }, [vista.timezone])
  const hoy = diaDe(ahora)
  // Hoy, o el ultimo dia con posts si hoy aun no se publico nada.
  const [dia, setDia] = React.useState(() => (vista.posts.length ? diaDe(vista.posts[0].publicado_at) : hoy))
  const [todosLosPosts, setTodosLosPosts] = React.useState(false)

  const redes = REDES.filter((r) => filtroRed === "todas" || filtroRed === r)

  // Los dias del periodo, de corrido (tambien los que no hubo posts).
  const masViejo = vista.posts.length ? diaDe(vista.posts[vista.posts.length - 1].publicado_at) : hoy
  const primerDia = periodo ? moverDia(hoy, -(periodo - 1)) : masViejo < hoy ? masViejo : hoy
  const dias: string[] = []
  for (let d = primerDia; d <= hoy; d = moverDia(d, 1)) dias.push(d)

  const posts = vista.posts.filter((p) => redes.includes(p.red) && diaDe(p.publicado_at) >= primerDia)
  const delRed = (r: Red) => posts.filter((p) => p.red === r)

  const datos: FilaDia[] = dias.map((d) => {
    const fila: FilaDia = { dia: d }
    for (const r of REDES) {
      fila[`vistas_${r}`] = 0
      fila[`inter_${r}`] = 0
      fila[`posts_${r}`] = 0
      fila[`toques_${r}`] = 0
    }
    return fila
  })
  const indice = new Map(datos.map((f, i) => [f.dia, i]))
  for (const p of posts) {
    const f = datos[indice.get(diaDe(p.publicado_at)) ?? -1]
    if (!f) continue
    f[`vistas_${p.red}`] = Number(f[`vistas_${p.red}`]) + (p.vistas ?? 0)
    f[`inter_${p.red}`] = Number(f[`inter_${p.red}`]) + (p.interacciones ?? 0)
    f[`posts_${p.red}`] = Number(f[`posts_${p.red}`]) + 1
  }
  for (const d of vista.dias) {
    const f = datos[indice.get(d.dia) ?? -1]
    if (f) f[`toques_${d.red}`] = d.toques_link ?? 0
  }

  const totalPorRed = (clave: string) =>
    Object.fromEntries(REDES.map((r) => [r, redes.includes(r) ? suma(datos.map((d) => Number(d[`${clave}_${r}`]))) : 0])) as Record<Red, number>
  const vistas = totalPorRed("vistas")
  const inter = totalPorRed("inter")
  const cuantos = totalPorRed("posts")
  const toques = totalPorRed("toques")
  const total = (x: Record<Red, number>) => suma(redes.map((r) => x[r]))

  // El dia elegido: sus cifras y sus posts.
  const filaDia = datos[indice.get(dia) ?? -1]
  const postsDelDia = posts.filter((p) => diaDe(p.publicado_at) === dia)
  const enTabla = todosLosPosts ? posts : postsDelDia

  const valorDe = (p: PostMetrica, col: Columna): number => {
    if (col === "publicado_at") return Date.parse(p.publicado_at)
    const v = col === "tasa" ? tasa(p) : p[col]
    return v ?? -1
  }
  const ordenados = [...enTabla].sort((a, b) => (orden.desc ? valorDe(b, orden.col) - valorDe(a, orden.col) : valorDe(a, orden.col) - valorDe(b, orden.col)))

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: vista.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
  const hora = (iso: string) => new Intl.DateTimeFormat("es-CO", { timeZone: vista.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso))

  const elegir = (d: string) => {
    setDia(d)
    setTodosLosPosts(false)
  }

  if (vista.posts.length === 0) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="text-muted-foreground py-8 text-sm">
          Aún no hay métricas. Se traen de Instagram y Facebook cada hora, de los posts publicados desde Hancel; si la
          empresa tiene las redes conectadas (Configuración → Conexiones), aparecerán en la próxima pasada.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 [--serie-fb:#2a78d6] [--serie-ig:#eb6834] dark:[--serie-fb:#3987e5] dark:[--serie-ig:#d95926]">
      <div className="flex flex-wrap items-center gap-3">
        <Segmentos opciones={PERIODOS} valor={periodo} onChange={setPeriodo} />
        <Segmentos
          opciones={[
            { id: "todas" as const, nombre: "Todas" },
            { id: "instagram" as const, nombre: "Instagram" },
            { id: "facebook" as const, nombre: "Facebook" },
          ]}
          valor={filtroRed}
          onChange={setFiltroRed}
        />
        {vista.actualizado ? <span className="text-muted-foreground ml-auto text-xs">Actualizado {fecha(vista.actualizado)} · se refresca cada hora</span> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra titulo="Vistas" total={total(vistas)} porRed={vistas} redes={redes} nota="Suma de las vistas de todos los posts del periodo." />
        <Cifra titulo="Interacciones" total={total(inter)} porRed={inter} redes={redes} nota="Me gusta, comentarios, compartidos y guardados." />
        <Cifra titulo="Posts publicados" total={total(cuantos)} porRed={cuantos} redes={redes} />
        <Cifra
          titulo="Toques al enlace"
          total={total(toques)}
          porRed={toques}
          redes={redes}
          nota="Instagram: link de la bio. Facebook: botón y datos de contacto de la página."
        />
      </div>

      <GraficaDiaria
        titulo="Vistas por día"
        descripcion="Vistas sumadas de los posts publicados cada día."
        datos={datos}
        clave="vistas"
        redes={redes}
        seleccionado={dia}
        onElegir={elegir}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <GraficaDiaria
          titulo="Interacciones por día"
          descripcion="Interacciones sumadas de los posts publicados cada día."
          datos={datos}
          clave="inter"
          redes={redes}
          seleccionado={dia}
          onElegir={elegir}
        />
        <GraficaDiaria
          titulo="Toques al enlace por día"
          descripcion="Instagram: link de la bio. Facebook: botón y contacto de la página (el link del comentario no lo mide Meta)."
          datos={datos}
          clave="toques"
          redes={redes}
          seleccionado={dia}
          onElegir={elegir}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" aria-label="Día anterior" onClick={() => elegir(moverDia(dia, -1))}>
                <ChevronLeftIcon />
              </Button>
              <CardTitle className="text-base">{dia === hoy ? `Hoy, ${etiquetaDia(dia)}` : mayuscula(etiquetaDia(dia, true))}</CardTitle>
              <Button variant="ghost" size="icon" aria-label="Día siguiente" disabled={dia >= hoy} onClick={() => elegir(moverDia(dia, 1))}>
                <ChevronRightIcon />
              </Button>
              {dia !== hoy ? (
                <Button variant="outline" size="sm" className="ml-1" onClick={() => elegir(hoy)}>
                  Hoy
                </Button>
              ) : null}
            </div>
            <span className="text-muted-foreground text-xs">Elige un día con las flechas o con clic en una barra.</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {redes.map((r) => (
              <Dato key={`v${r}`} etiqueta={`Vistas ${NOMBRE_RED[r]}`} valor={fmt(Number(filaDia?.[`vistas_${r}`] ?? 0))} />
            ))}
            <Dato etiqueta="Interacciones" valor={fmt(suma(redes.map((r) => Number(filaDia?.[`inter_${r}`] ?? 0))))} />
            <Dato etiqueta="Posts" valor={fmt(postsDelDia.length)} />
            {redes.map((r) => (
              <Dato key={`t${r}`} etiqueta={`Toques al enlace ${NOMBRE_RED[r]}`} valor={fmt(Number(filaDia?.[`toques_${r}`] ?? 0))} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {redes.map((r) => (
          <Promedios key={r} red={r} posts={delRed(r)} />
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {todosLosPosts ? `Todos los posts del periodo (${fmt(ordenados.length)})` : `Posts del ${etiquetaDia(dia)} (${fmt(ordenados.length)})`}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setTodosLosPosts((v) => !v)}>
              {todosLosPosts ? "Ver solo el día elegido" : "Ver todos los del periodo"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ordenados.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Ese día no se publicó nada desde Hancel.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Post</TableHead>
                  <Cabecera orden={orden} onOrden={setOrden} col="publicado_at">Publicado</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="vistas" className="text-right">Vistas</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="alcance" className="text-right">Alcance</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="interacciones" className="text-right">Interacc.</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="tasa" className="text-right">Tasa</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="me_gusta" className="text-right">Me gusta</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="comentarios" className="text-right">Coment.</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="compartidos" className="text-right">Compart.</Cabecera>
                  <Cabecera orden={orden} onOrden={setOrden} col="guardados" className="text-right">Guard.</Cabecera>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenados.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-md">
                      <div className="flex items-center gap-3">
                        <Miniatura src={p.imagen} />
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-sm" title={p.texto ?? ""}>{p.texto ?? "Sin texto"}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="gap-1.5">
                              <Punto red={p.red} />
                              {NOMBRE_RED[p.red]}
                            </Badge>
                            <Badge variant="secondary">{p.origen === "noticia" ? "Noticia" : p.origen === "precios" ? "Precios" : "Estudio"}</Badge>
                            {p.enlace ? (
                              <a href={p.enlace} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Abrir el post">
                                <ExternalLinkIcon className="size-3.5" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-sm">{todosLosPosts ? fecha(p.publicado_at) : hora(p.publicado_at)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmt(p.vistas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.alcance)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmt(p.interacciones)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(tasa(p))}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.me_gusta)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.comentarios)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.compartidos)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(p.guardados)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
