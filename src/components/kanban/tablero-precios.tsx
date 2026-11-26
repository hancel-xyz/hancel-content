"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  armarPreciosAhora,
  descartarPrecio,
  guardarActivoPrecios,
  guardarHoraPrecios,
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
 * Tres procesos, sin IA: los precios de cada central, el carrusel (portada
 * con los que mas subieron, la lista de todos los productos y el cierre) y la
 * publicacion a su hora. Uno por central: de lunes a viernes, el del dia; el
 * sabado, el de la semana.
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

function pct(p: number | null): string {
  if (p === null) return ""
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
  const [horaPrimera, setHoraPrimera] = React.useState(datos.ajustes.hora)
  const cambiada = horaPrimera !== datos.ajustes.hora
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
          <span className="text-muted-foreground">Primera central a las</span>
          <Input value={horaPrimera} onChange={(e) => setHoraPrimera(e.target.value)} className="h-8 w-20" aria-label="Hora de la primera central" />
          <span className="text-muted-foreground">y las demás cada 20 min</span>
          {cambiada ? (
            <Button size="sm" disabled={pending} onClick={() => correr(() => guardarHoraPrecios(horaPrimera))}>
              Guardar hora
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
        Un carrusel por central ({datos.ajustes.centrales.join(", ")}): portada con los 2 que más subieron y los 2 que más bajaron, la lista de todos los productos con su precio por kilo y cuánto subió o bajó, y cierre que invita al portal ({datos.ajustes.link.replace(/^https?:\/\//, "")}: en Instagram, link en la descripción; en Facebook, en el primer comentario). Lunes a viernes, con los precios del mismo día (llegan entre las 11 y las 12); sábado, los de la semana. Fuente: Índice Agro. Sin IA: solo datos.
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
          {f.direccion === "todos" ? (
            <Badge variant="outline" className="font-normal">{`${f.totalProductos} productos`}</Badge>
          ) : (
            <Badge className={f.direccion === "subieron" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}>{f.direccion === "subieron" ? "Subieron" : "Bajaron"}</Badge>
          )}
          {f.instagramId ? <Badge variant="secondary">Instagram</Badge> : null}
          {f.facebookId ? <Badge variant="secondary">Facebook</Badge> : null}
          <EstadoVideo f={f} />
        </div>
        <p className="text-muted-foreground text-xs">{f.etapa === "publicado" && f.publicadoAt ? `Salió ${hora(f.publicadoAt)}` : `Programado: ${hora(f.programadoPara)}`}</p>
        {f.error ? <p className="text-destructive line-clamp-3 text-xs">{f.error}</p> : null}
      </div>
    </button>
  )
}

/** Como van las laminas animadas. */
function EstadoVideo({ f }: { f: FichaPrecios }) {
  if (f.videoEstado === "listo") return <Badge variant="secondary">Animado</Badge>
  if (f.videoEstado === "pendiente") return <Badge variant="outline" className="font-normal">{`Animando ${f.videos.length}/${f.totalLaminas}`}</Badge>
  if (f.videoEstado === "error") return <Badge variant="outline" className="font-normal" title={f.videoError ?? undefined}>Fijo</Badge>
  return null
}

function Detalle({ ficha, onClose, pending, correr }: { ficha: FichaPrecios | null; onClose: () => void; pending: boolean; correr: (a: () => Promise<Resultado>) => void }) {
  const [red, setRed] = React.useState<"instagram" | "facebook">("instagram")
  if (!ficha) return null
  const imagenes = red === "instagram" ? ficha.imagenes : ficha.imagenesFacebook.length ? ficha.imagenesFacebook : ficha.imagenes
  const texto = red === "instagram" ? ficha.textoInstagram : ficha.textoFacebook
  // Con los videos listos se ve lo que va a salir: en Instagram un video por lamina; en Facebook, uno solo.
  const videos = ficha.videoEstado !== "listo" ? [] : red === "instagram" ? ficha.videos : ficha.videoFacebook ? [ficha.videoFacebook] : []
  const editable = ficha.etapa !== "publicado" && ficha.etapa !== "publicando"
  return (
    <Dialog open={!!ficha} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">{ficha.titulo}</DialogTitle>
          <DialogDescription>
            {`${ficha.direccion === "todos" ? `${ficha.totalProductos} productos · en portada: ` : ""}${ficha.productos.map((p) => `${p.nombre} ${pct(p.porcentaje)}`).join(" · ")}`}
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
            {videos.length
              ? videos.map((src) => <video key={src} src={src} className="h-96 w-auto max-w-none shrink-0 rounded-md border" autoPlay muted loop playsInline controls />)
              : imagenes.map((src, i) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Lámina ${i + 1}`} className="h-96 w-auto max-w-none rounded-md border" loading="lazy" />
                  </a>
                ))}
          </div>
          {ficha.videoEstado === "pendiente" ? (
            <p className="text-muted-foreground text-xs">{`Armando las láminas animadas: ${ficha.videos.length} de ${ficha.totalLaminas}. Si a la hora no están, sale con las láminas fijas.`}</p>
          ) : null}
          {ficha.videoEstado === "error" && ficha.videoError ? <p className="text-muted-foreground text-xs">{`Sale con láminas fijas: ${ficha.videoError}`}</p> : null}
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
