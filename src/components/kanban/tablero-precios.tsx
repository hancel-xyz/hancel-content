"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  armarPreciosAhora,
  descartarPrecio,
  guardarActivoPrecios,
  guardarHorasPrecios,
  publicarPrecioAhora,
  recuperarPrecio,
  rehacerPrecio,
  type Resultado,
} from "@/app/estudio/precios-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { EtapaPrecios, FichaPrecios, TableroPrecios as Datos } from "@/lib/precios-data"

/**
 * El tablero del pipeline de precios.
 *
 * Tres procesos, sin IA: los datos de Sandia (lo que mas subio y bajo), el
 * carrusel (laminas dibujadas y textos de cada red) y la publicacion a su hora.
 * De lunes a viernes salen los dos diarios; el sabado, los dos semanales.
 */

const COLUMNAS: { id: EtapaPrecios; titulo: string; pista: string }[] = [
  { id: "listo", titulo: "Listos", pista: "Carrusel armado, espera su hora" },
  { id: "publicando", titulo: "Publicando", pista: "Saliendo a Instagram y Facebook" },
  { id: "publicado", titulo: "Publicados", pista: "Ya en las redes" },
  { id: "error", titulo: "Con error", pista: "No salieron: mira el motivo" },
  { id: "descartado", titulo: "Descartados", pista: "No se publican" },
]

type Aviso = { tipo: "error" | "ok"; texto: string } | null

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
}

function pct(p: number): string {
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1).replace(".", ",")}%`
}

export function TableroPrecios({ datos }: { datos: Datos }) {
  const router = useRouter()
  const [aviso, setAviso] = React.useState<Aviso>(null)
  const [abiertaId, setAbiertaId] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()

  // Lo largo (armar, publicar) corre en el motor: el tablero se refresca solo.
  React.useEffect(() => {
    const t = setInterval(() => router.refresh(), 20_000)
    return () => clearInterval(t)
  }, [router])

  const ficha = React.useMemo(() => {
    if (!abiertaId) return null
    for (const lista of Object.values(datos.fichas)) {
      const f = lista.find((x) => x.id === abiertaId)
      if (f) return f
    }
    return null
  }, [abiertaId, datos])

  function correr(accion: () => Promise<Resultado>) {
    setAviso(null)
    start(async () => {
      try {
        const r = await accion()
        setAviso(r.ok ? { tipo: "ok", texto: r.aviso ?? "Hecho." } : { tipo: "error", texto: r.error })
        router.refresh()
      } catch (e) {
        setAviso({ tipo: "error", texto: e instanceof Error && e.message ? e.message : "La acción no respondió." })
      }
    })
  }

  return (
    <>
      <Ajustes datos={datos} pending={pending} correr={correr} />

      {!datos.sandia ? (
        <p className="border-destructive/40 text-destructive bg-destructive/5 rounded-md border px-3 py-2 text-sm">
          Falta la variable <code>SANDIA_API_KEY</code> en el servidor: sin ella no se pueden traer los precios.
        </p>
      ) : null}
      {aviso ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            aviso.tipo === "error" ? "border-destructive/40 text-destructive bg-destructive/5" : "text-muted-foreground"
          }`}
        >
          {aviso.texto}
        </p>
      ) : null}

      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {COLUMNAS.map((c) => (
          <div key={c.id} className="flex w-64 shrink-0 flex-col gap-2">
            <div className="px-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-medium">{c.titulo}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">{datos.fichas[c.id].length}</span>
              </div>
              <p className="text-muted-foreground text-[11px]">{c.pista}</p>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {datos.fichas[c.id].length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-xs">Nada por aquí</p>
              ) : (
                datos.fichas[c.id].map((f) => <Tarjeta key={f.id} f={f} onAbrir={() => setAbiertaId(f.id)} />)
              )}
            </div>
          </div>
        ))}
      </div>

      <Detalle ficha={ficha} onClose={() => setAbiertaId(null)} pending={pending} correr={correr} />
    </>
  )
}

function Ajustes({ datos, pending, correr }: { datos: Datos; pending: boolean; correr: (a: () => Promise<Resultado>) => void }) {
  const [bajaron, setBajaron] = React.useState(datos.ajustes.horaBajaron)
  const [subieron, setSubieron] = React.useState(datos.ajustes.horaSubieron)
  const cambiadas = bajaron !== datos.ajustes.horaBajaron || subieron !== datos.ajustes.horaSubieron
  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2">
          <Switch checked={datos.ajustes.activo} disabled={pending} onCheckedChange={(v) => correr(() => guardarActivoPrecios(v))} aria-label="Publicación automática de precios" />
          <span className="font-medium">
            {datos.ajustes.activo ? (datos.ajustes.desde && datos.ajustes.desde > new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) ? `Automática desde el ${datos.ajustes.desde}` : "Publicación automática activa") : "Publicación automática pausada"}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Bajaron a las</span>
          <Input value={bajaron} onChange={(e) => setBajaron(e.target.value)} className="h-8 w-20" aria-label="Hora de los que bajaron" />
          <span className="text-muted-foreground">y subieron a las</span>
          <Input value={subieron} onChange={(e) => setSubieron(e.target.value)} className="h-8 w-20" aria-label="Hora de los que subieron" />
          {cambiadas ? (
            <Button size="sm" disabled={pending} onClick={() => correr(() => guardarHorasPrecios(bajaron, subieron))}>
              Guardar horas
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => armarPreciosAhora("dia"))}>
            Armar diarios ahora
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => armarPreciosAhora("semana"))}>
            Armar semanales ahora
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Lunes a viernes: los 5 que más bajaron y los 5 que más subieron, con los precios del mismo día (Sandia los carga entre las 11 y las 12). Sábado: los de la semana de lunes a viernes. Instagram lleva el link de {datos.ajustes.link.replace(/^https?:\/\//, "")} en la descripción; Facebook, en el primer comentario. Sin IA: solo datos.
      </p>
    </div>
  )
}

function Tarjeta({ f, onAbrir }: { f: FichaPrecios; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className="hover:bg-accent/50 flex flex-col gap-2 overflow-hidden rounded-lg border bg-card text-left transition-colors">
      {f.imagenes[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.imagenes[0]} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
      ) : null}
      <div className="flex flex-col gap-2 p-3 pt-0">
        <p className="text-sm leading-snug font-medium">{f.titulo}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            {f.periodo === "dia" ? "Diario" : "Semanal"}
          </Badge>
          <Badge className={f.direccion === "subieron" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}>{f.direccion === "subieron" ? "Subieron" : "Bajaron"}</Badge>
          {f.instagramId ? <Badge variant="secondary">Instagram</Badge> : null}
          {f.facebookId ? <Badge variant="secondary">Facebook</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">{f.etapa === "publicado" && f.publicadoAt ? `Salió ${hora(f.publicadoAt)}` : `Programado: ${hora(f.programadoPara)}`}</p>
        {f.error ? <p className="text-destructive line-clamp-3 text-xs">{f.error}</p> : null}
      </div>
    </button>
  )
}

function Detalle({ ficha, onClose, pending, correr }: { ficha: FichaPrecios | null; onClose: () => void; pending: boolean; correr: (a: () => Promise<Resultado>) => void }) {
  const [red, setRed] = React.useState<"instagram" | "facebook">("instagram")
  if (!ficha) return null
  const imagenes = red === "instagram" ? ficha.imagenes : ficha.imagenesFacebook.length ? ficha.imagenesFacebook : ficha.imagenes
  const texto = red === "instagram" ? ficha.textoInstagram : ficha.textoFacebook
  const editable = ficha.etapa !== "publicado" && ficha.etapa !== "publicando"
  return (
    <Dialog open={!!ficha} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">{ficha.titulo}</DialogTitle>
          <DialogDescription>
            {ficha.productos.map((p) => `${p.nombre} ${pct(p.porcentaje)}`).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 text-sm">
          {(["instagram", "facebook"] as const).map((r) => (
            <Button key={r} size="sm" variant={red === r ? "default" : "ghost"} onClick={() => setRed(r)}>
              {r === "instagram" ? "Instagram" : "Facebook"}
            </Button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {/* shrink-0: sin el, la fila se encogia dentro del dialogo y recortaba las laminas. */}
          <div className="flex shrink-0 gap-3 overflow-x-auto pb-2">
            {imagenes.map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Lámina ${i + 1}`} className="h-96 w-auto max-w-none rounded-md border" loading="lazy" />
              </a>
            ))}
          </div>
          <pre className="bg-muted/50 rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap">{texto}</pre>
          {ficha.error ? <p className="text-destructive text-sm">{ficha.error}</p> : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {ficha.etapa === "descartado" || ficha.etapa === "error" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => recuperarPrecio(ficha.id))}>
              Volver a Listos
            </Button>
          ) : null}
          {editable ? (
            <>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => correr(() => descartarPrecio(ficha.id))}>
                Descartar
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => correr(() => rehacerPrecio(ficha.id))}>
                Rehacer con datos frescos
              </Button>
              <Button size="sm" disabled={pending} onClick={() => correr(() => publicarPrecioAhora(ficha.id))}>
                Publicar ahora
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
