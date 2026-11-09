"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon } from "lucide-react"

import type { MetricasVista, PostMetrica } from "@/lib/metricas-data"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Red = "instagram" | "facebook"
type Periodo = 7 | 30 | 60 | 0
type Columna = "publicado_at" | "vistas" | "alcance" | "me_gusta" | "comentarios" | "compartidos" | "guardados" | "interacciones" | "tasa"

const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 7, nombre: "7 días" },
  { id: 30, nombre: "30 días" },
  { id: 60, nombre: "60 días" },
  { id: 0, nombre: "Todo" },
]

const NOMBRE_RED: Record<Red, string> = { instagram: "Instagram", facebook: "Facebook" }

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })

const fmt = (n: number | null | undefined) => (n == null ? "—" : numero.format(n))
const pct = (n: number | null) => (n == null ? "—" : `${decimal.format(n * 100)} %`)

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
  const alcance = conAlcance.reduce((a, p) => a + (p.alcance ?? 0), 0)
  return alcance ? conAlcance.reduce((a, p) => a + (p.interacciones ?? 0), 0) / alcance : null
}

function Segmentos<T extends string | number>({ opciones, valor, onChange }: { opciones: { id: T; nombre: string }[]; valor: T; onChange: (v: T) => void }) {
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

function Dato({ etiqueta, valor, ayuda }: { etiqueta: string; valor: string; ayuda?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={ayuda}>
      <span className="text-muted-foreground text-xs">{etiqueta}</span>
      <span className="text-xl font-semibold tabular-nums">{valor}</span>
    </div>
  )
}

function Promedios({ red, posts }: { red: Red; posts: PostMetrica[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {NOMBRE_RED[red]}
          <span className="text-muted-foreground text-sm font-normal">· promedio por post de {fmt(posts.length)} posts</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin posts en este periodo.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
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

function Miniatura({ src }: { src: string | null }) {
  const [roto, setRoto] = React.useState(false)
  if (!src || roto) return <div className="bg-muted size-10 shrink-0 rounded" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" onError={() => setRoto(true)} className="size-10 shrink-0 rounded object-cover" />
}

type Orden = { col: Columna; desc: boolean }

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

export function Metricas({ vista }: { vista: MetricasVista }) {
  const [periodo, setPeriodo] = React.useState<Periodo>(30)
  const [red, setRed] = React.useState<Red | "todas">("todas")
  const [orden, setOrden] = React.useState<Orden>({ col: "publicado_at", desc: true })
  // El momento de abrir la pagina: los periodos se cuentan desde ahi.
  const [ahora] = React.useState(() => Date.now())

  const desde = periodo ? ahora - periodo * 86_400_000 : 0
  const delPeriodo = vista.posts.filter((p) => Date.parse(p.publicado_at) >= desde)
  const visibles = delPeriodo.filter((p) => red === "todas" || p.red === red)

  const valorDe = (p: PostMetrica, col: Columna): number => {
    if (col === "publicado_at") return Date.parse(p.publicado_at)
    const v = col === "tasa" ? tasa(p) : p[col]
    return v ?? -1
  }
  const ordenados = [...visibles].sort((a, b) => (orden.desc ? valorDe(b, orden.col) - valorDe(a, orden.col) : valorDe(a, orden.col) - valorDe(b, orden.col)))

  const hoy = new Date(ahora).toISOString().slice(0, 10)
  const diasDelPeriodo = vista.dias.filter((d) => !periodo || d.dia >= new Date(desde).toISOString().slice(0, 10))
  const toques = diasDelPeriodo.reduce((a, d) => a + (d.toques_link ?? 0), 0)
  const visitas = diasDelPeriodo.reduce((a, d) => a + (d.visitas_perfil ?? 0), 0)
  const diasConDatos = diasDelPeriodo.filter((d) => d.toques_link != null).length

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: vista.timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso))

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmentos opciones={PERIODOS} valor={periodo} onChange={setPeriodo} />
        <Segmentos
          opciones={[
            { id: "todas" as const, nombre: "Todas" },
            { id: "instagram" as const, nombre: "Instagram" },
            { id: "facebook" as const, nombre: "Facebook" },
          ]}
          valor={red}
          onChange={setRed}
        />
        {vista.actualizado ? <span className="text-muted-foreground ml-auto text-xs">Actualizado {fecha(vista.actualizado)} · se refresca cada hora</span> : null}
      </div>

      {(["instagram", "facebook"] as Red[])
        .filter((r) => red === "todas" || red === r)
        .map((r) => (
          <Promedios key={r} red={r} posts={delPeriodo.filter((p) => p.red === r)} />
        ))}

      {red !== "facebook" && vista.dias.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cuenta de Instagram</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              Instagram da estas cifras por día para toda la cuenta, no por post: no dice de qué post vino cada toque al link.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Dato etiqueta="Toques al link de la bio" valor={fmt(toques)} />
              <Dato etiqueta="Toques por día" valor={diasConDatos ? decimal.format(toques / diasConDatos) : "—"} />
              <Dato etiqueta="Visitas al perfil" valor={fmt(visitas)} />
              <Dato etiqueta="Visitas por día" valor={diasConDatos ? decimal.format(visitas / diasConDatos) : "—"} />
            </div>
            {periodo === 0 || periodo > 28 ? (
              <p className="text-muted-foreground mt-3 text-xs">
                Desde el {diasDelPeriodo.at(-1)?.dia ?? hoy}: Hancel guarda estas cifras desde que se empezaron a medir.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Posts ({fmt(ordenados.length)})</CardTitle>
        </CardHeader>
        <CardContent>
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
                          <Badge variant="outline">{NOMBRE_RED[p.red]}</Badge>
                          <Badge variant="secondary">{p.origen === "noticia" ? "Noticia" : "Estudio"}</Badge>
                          {p.enlace ? (
                            <a href={p.enlace} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Abrir el post">
                              <ExternalLinkIcon className="size-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-sm">{fecha(p.publicado_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.vistas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.alcance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.interacciones)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(tasa(p))}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.me_gusta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.comentarios)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.compartidos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(p.guardados)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
