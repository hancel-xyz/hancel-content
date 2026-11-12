import type { RawNews } from "@/lib/types"

import { leerPagina } from "../redaccion/fuentes"
import { supabaseAdmin } from "../supabase-admin"
import { terminosDeBusqueda } from "./keywords"
import { BancoDeFotos, descargarFotoPexels, pexelsConfigurado } from "./pexels"
import {
  descargarFoto,
  descargarInserto,
  MAX_SLIDES,
  MIN_SLIDES,
  necesitanFoto,
  parseSlides,
  renderSlide,
  repartirVariantes,
} from "./render"
import { estamparCredito } from "./credito"
import { subirCarrusel, subirImagenSuelta } from "./storage"
import type { Slide } from "./templates"
import { ESTILO_POR_DEFECTO, type Estilo } from "./theme"

/**
 * De la respuesta del agente de Instagram al carrusel subido.
 *
 * Igual que con las otras redes, la app es la que materializa: el agente solo
 * escribe su buzon. Aqui ademas hay dos pasos que las otras no tienen —buscar
 * fotos y dibujar— que pueden fallar por motivos ajenos al texto.
 */

export type CarouselPayload = {
  caption: string
  hashtags: string[]
  /** En orden: es el orden del carrusel. */
  images: string[]
  slideCount: number
  /** Si la portada salio sin foto, para poder revisarlo despues. */
  portadaSinFoto: boolean
  /** Con que se buscaron las fotos de banco, para entender por que salieron esas. */
  terminosFoto: string[]
  /** Creditos de Pexels: la licencia no lo exige, pero se agradece. */
  creditos: { autor: string; url: string }[]
  /**
   * La portada redibujada para Facebook, sin numeracion ni "desliza".
   *
   * Facebook publica una sola imagen, asi que reutilizar la del carrusel metia
   * en el feed un "1 / 6" y una invitacion a deslizar que no llevan a ninguna
   * parte. Es la misma lamina y la misma foto, dibujada otra vez sin esos dos
   * elementos: una llamada mas a Satori y ni una a Pexels.
   */
  portadaFacebook?: string
}

/** Lo que el agente deja en `jobs_instagram.respuesta`. */
/**
 * Repone las tildes que el modelo se deja, solo donde no hay duda.
 *
 * Al agente se le pide en el prompt que escriba en español correcto y ahora el
 * prompt entero va acentuado, que era la causa de fondo: leyendo instrucciones
 * sin tildes, imitaba esa forma de escribir. Esto es la red de debajo.
 *
 * Solo entra lo que no puede significar otra cosa. "anos" por "años" no es una
 * falta cualquiera, es otra palabra. "-cion" al final de palabra siempre lleva
 * tilde, y su plural "-ciones" nunca. Lo ambiguo se queda fuera a proposito:
 * "esta" puede ser "está" o el demostrativo, "cayo" puede ser "cayó" o el
 * accidente del terreno, y arreglar a medias es peor que no arreglar.
 */
const CON_TILDE: Record<string, string> = {
  ademas: "además",
  ahi: "ahí",
  alli: "allí",
  ano: "año",
  anos: "años",
  aqui: "aquí",
  asi: "así",
  compania: "compañía",
  credito: "crédito",
  dia: "día",
  dias: "días",
  despues: "después",
  economia: "economía",
  energia: "energía",
  estan: "están",
  habia: "había",
  habian: "habían",
  hectarea: "hectárea",
  hectareas: "hectáreas",
  mananas: "mañanas",
  manana: "mañana",
  mas: "más",
  millon: "millón",
  nino: "niño",
  ninos: "niños",
  numero: "número",
  pais: "país",
  paises: "países",
  pequeno: "pequeño",
  podria: "podría",
  podrian: "podrían",
  proximo: "próximo",
  proxima: "próxima",
  quiza: "quizá",
  segun: "según",
  senal: "señal",
  sera: "será",
  seran: "serán",
  tambien: "también",
  tecnologia: "tecnología",
  ultima: "última",
  ultimo: "último",
  via: "vía",
  vias: "vías",
  agricola: "agrícola",
  agricolas: "agrícolas",
  analisis: "análisis",
  area: "área",
  areas: "áreas",
  basica: "básica",
  basico: "básico",
  deficit: "déficit",
  dificil: "difícil",
  facil: "fácil",
  indice: "índice",
  indices: "índices",
  kilometro: "kilómetro",
  kilometros: "kilómetros",
  logistica: "logística",
  maximo: "máximo",
  minimo: "mínimo",
  politica: "política",
  politicas: "políticas",
  rapido: "rápido",
  tramite: "trámite",
  tramites: "trámites",
  unico: "único",
  unica: "única",
  // Del agro, sin ambigüedad posible.
  acido: "ácido",
  acidos: "ácidos",
  acida: "ácida",
  acidas: "ácidas",
  comun: "común",
  comunes: "comunes",
  criticos: "críticos",
  debil: "débil",
  debiles: "débiles",
  nitrogeno: "nitrógeno",
  pequena: "pequeña",
  pequenas: "pequeñas",
  pequenos: "pequeños",
  arbol: "árbol",
  arboles: "árboles",
  cafe: "café",
  cafes: "cafés",
  fosforo: "fósforo",
  limon: "limón",
  maiz: "maíz",
  organico: "orgánico",
  organica: "orgánica",
  organicos: "orgánicos",
  organicas: "orgánicas",
  platano: "plátano",
  platanos: "plátanos",
  quimico: "químico",
  quimicos: "químicos",
  raiz: "raíz",
  raices: "raíces",
  tecnico: "técnico",
  tecnica: "técnica",
}

/** Conserva la mayuscula inicial de la palabra original. */
function comoEstaba(original: string, corregida: string): string {
  return original[0] === original[0].toUpperCase()
    ? corregida[0].toUpperCase() + corregida.slice(1)
    : corregida
}

export function arreglarOrtografia(texto: string): string {
  return (
    texto
      // Palabras de la lista cerrada.
      .replace(/[a-zA-ZáéíóúñÁÉÍÓÚÑ]+/g, (palabra) => {
        const fijada = CON_TILDE[palabra.toLowerCase()]
        return fijada ? comoEstaba(palabra, fijada) : palabra
      })
      // "-cion" final siempre lleva tilde; "-ciones" nunca. Igual "-sion". El
      // lookahead exige final de palabra: sin el, la regla tambien entraria en el
      // plural y escribiria "decisiónes". La o se pone en la caja que traia,
      // para que "PRODUCCION" no salga "PRODUCción".
      .replace(/([a-záéíóúñ])([cs]i)(o)(n)(?![a-záéíóúñ])/gi, (_m, antes, ci, o, n) =>
        `${antes}${ci}${o === "O" ? "Ó" : "ó"}${n}`
      )
  )
}

export function parseInstagramResponse(respuesta: unknown): {
  caption: string
  hashtags: string[]
  slides: Slide[]
  /** Las busquedas de foto que eligio quien escribio el carrusel. */
  fotos: string[]
  /** La cosa concreta que va recortada en la portada. Vacio = sin elemento. */
  elemento: string
  /** La categoria de la noticia que va sobre el titular ("Dólar", "Banano Costa Rica"). Vacio = la del segmento. */
  etiqueta: string
} {
  const raiz = (respuesta ?? {}) as Record<string, unknown>

  const slides = parseSlides(raiz.slides).map((slide) =>
    slide.type === "photo_hook"
      ? { ...slide, hook: slide.hook ? arreglarOrtografia(slide.hook) : slide.hook }
      : {
          ...slide,
          title: slide.title ? arreglarOrtografia(slide.title) : slide.title,
          body: slide.body ? arreglarOrtografia(slide.body) : slide.body,
          lead: slide.lead ? arreglarOrtografia(slide.lead) : slide.lead,
          items: slide.items ? slide.items.map(arreglarOrtografia) : slide.items,
        }
  )
  if (slides.length < MIN_SLIDES) {
    throw new Error(
      `El agente de Instagram devolvio ${slides.length} slides utiles y hacen falta al menos ` +
        `${MIN_SLIDES}. Se esperaba {"caption":"...","hashtags":[...],"slides":[{"n":1,` +
        `"type":"photo_hook","hook":"..."},{"n":2,"type":"text","title":"...","body":"..."}]}.`
    )
  }

  const caption = typeof raiz.caption === "string" ? arreglarOrtografia(raiz.caption.trim()) : ""
  const hashtags = Array.isArray(raiz.hashtags)
    ? raiz.hashtags
        .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
        .map((h) => (h.trim().startsWith("#") ? h.trim() : `#${h.trim()}`))
    : []

  // Las busquedas de foto las decide quien escribe el carrusel: es el unico
  // que sabe de que va cada lamina. Antes salian de las palabras del titular,
  // y eso daba montañas para una noticia de cannabis o un puesto de fruta para
  // una de leche, porque el titular casi nunca nombra lo que hay que fotografiar.
  const fotos = Array.isArray(raiz.fotos)
    ? raiz.fotos
        .filter((f): f is string => typeof f === "string" && f.trim().length > 2)
        .map((f) => f.trim().toLowerCase())
        .slice(0, 8)
    : []

  const elemento =
    typeof raiz.elemento === "string" && raiz.elemento.trim().length > 2
      ? raiz.elemento.trim()
      : ""

  // La etiqueta la escribe quien redacta, porque la del segmento a veces no
  // corresponde ("PRECIO CAFÉ COLOMBIA" en una noticia del dolar).
  const etiqueta =
    typeof raiz.etiqueta === "string" && raiz.etiqueta.trim().length > 1 ? arreglarOrtografia(raiz.etiqueta.trim()).slice(0, 34) : ""

  return { caption, hashtags, slides, fotos, elemento, etiqueta }
}

/**
 * Dibuja y sube el carrusel entero.
 *
 * Las imagenes se generan en serie y no en paralelo: son hasta diez PNG de
 * 1080x1350 y hacerlas a la vez dispara la memoria de la funcion sin ganar gran
 * cosa, porque el cuello es el propio render.
 */
export async function generarCarrusel(
  pieceKey: string,
  respuesta: unknown,
  news: RawNews | null,
  estilo: Estilo = ESTILO_POR_DEFECTO,
  nichos: string[] = [],
  /** Dibuja ademas la portada suelta que usa Facebook. */
  conPortadaFacebook = false
): Promise<CarouselPayload> {
  const { caption, hashtags, slides, fotos, elemento, etiqueta } = parseInstagramResponse(respuesta)

  // Plogy tiene su propia estructura de laminas, no la clasica recoloreada.
  if (estilo.plantilla === "plogy") {
    return generarCarruselPlogy(pieceKey, { caption, hashtags, slides, fotos, elemento, etiqueta }, news, estilo, nichos, conPortadaFacebook)
  }
  if (estilo.plantilla === "editorial" || estilo.plantilla === "impacto" || estilo.plantilla === "periodico") {
    return generarCarruselAlterno(pieceKey, { caption, hashtags, slides, fotos, elemento, etiqueta }, news, estilo, nichos, conPortadaFacebook)
  }

  // El cierre es una lamina de marca, no del guion: se añade aqui y no se le
  // pide al agente. Va siempre, porque la llamada a seguir la cuenta es lo
  // unico que convierte un carrusel en algo que deja audiencia detras, y
  // dejarla al criterio de cada generacion era garantizar que faltara. Si el
  // guion ya llega al tope de Instagram se recorta una lamina para hacerle
  // sitio, en vez de pasarse.
  if (slides.length >= MAX_SLIDES) slides.length = MAX_SLIDES - 1

  const variantes = repartirVariantes(slides, estilo.usarFotos && pexelsConfigurado())
  slides.push({
    n: slides.length + 1,
    type: "text",
    title: estilo.cierre.titulo,
    body: estilo.cierre.texto,
  })
  variantes.push("cierre")

  // El logo y la captura se descargan una vez: Satori necesita los bytes, no
  // una URL. La captura solo si el cierre la va a usar.
  const logo = await descargarFoto(estilo.logo)
  const perfil =
    estilo.cierre.estilo === "perfil" ? await descargarFoto(estilo.perfil) : null

  // El elemento de la portada: la cosa concreta de la que habla la noticia,
  // buscada en internet y no en el banco de fotos. Es opcional de verdad: si no
  // aparece nada utilizable la portada sale como siempre, sin hueco raro.
  const hallado = news?.account_id ? await buscarInserto(elemento, news.account_id) : null
  const inserto = hallado?.imagen ?? null
  // Un logo apaisado recortado a cuadro pierde las puntas y deja de leerse:
  // "Asocolflores" salia como "socolflore". Lo cuadrado se rellena, que luce
  // mejor; lo que no lo es se encaja entero aunque queden margenes.
  // Se rellena siempre que el recorte no se coma lo importante. El margen es
  // amplio a proposito: encajar deja la imagen flotando pequeña dentro del
  // circulo, y eso se ve peor que un recorte leve por los lados.
  const insertoAjuste =
    hallado && hallado.proporcion > 0.62 && hallado.proporcion < 1.6 ? "llenar" : "encajar"
  const insertoPos = Math.floor(Math.random() * 4)
  // La forma tambien se sortea: dos formas evitan que una serie de posts se lea
  // como una plantilla, y las dos funcionan igual de bien.
  const insertoForma = Math.random() < 0.5 ? "circulo" : "cuadrado"
  const conFoto = necesitanFoto(variantes)

  // Lo que pidio el agente manda; el rastreo del titular queda de respaldo por
  // si la respuesta viene sin busquedas.
  const terminos =
    fotos.length > 0 ? fotos : terminosDeBusqueda(news, nichos, estilo.fotosLiterales)
  const banco = new BancoDeFotos(terminos)
  const creditos: { autor: string; url: string }[] = []

  /** Una foto nueva del banco, o `null` si ya no queda ninguna sin usar. */
  const delBanco = async (): Promise<string | null> => {
    if (!estilo.usarFotos || !pexelsConfigurado()) return null

    // `siguiente()` no repite dentro del mismo post: lleva la cuenta de lo ya
    // servido y va agotando terminos antes que reutilizar una foto.
    const elegida = await banco.siguiente()
    if (!elegida) return null

    const descargada = await descargarFotoPexels(elegida)
    if (descargada && elegida.autor) {
      creditos.push({ autor: elegida.autor, url: elegida.autorUrl })
    }
    return descargada
  }

  // La portada se resuelve antes que nada y con red de seguridad, porque es la
  // unica lamina que no puede salir sin foto: es lo que frena el pulgar en el
  // feed, y una portada de solo texto sobre negro es un post que nadie abre.
  //
  // Primero la foto del hecho (la misma de la nota del portal, ver
  // `fotoDelHecho`); si no hay una grande, el banco; y como ultimo recurso la
  // miniatura de la extraccion, que se ve blanda pero no deja la portada vacia.
  const hecho = await fotoDelHecho(news)
  const fotoPortada = hecho?.foto ?? (await delBanco()) ?? (await descargarFoto(news?.image_url))
  const sinFotoPortada = fotoPortada === null

  // El antetitulo situa el post antes de que nadie lea el titular. Sale del tema
  // del segmento, que es lo mas concreto que la noticia trae siempre, salvo que
  // el redactor haya escrito una que corresponda mejor.
  const antetitulo = (etiqueta || news?.tema || news?.niche || "").trim() || null

  const imagenes: Buffer[] = []

  for (const [indice, slide] of slides.entries()) {
    const foto =
      indice === 0
        ? fotoPortada
        : conFoto[indice] || variantes[indice] === "cierre"
          ? await delBanco()
          : null

    imagenes.push(
      await renderSlide(
        {
          slide,
          variante: variantes[indice],
          foto,
          etiqueta: antetitulo,
          logo,
          inserto: indice === 0 ? inserto : null,
          insertoPos,
          insertoForma,
          insertoAjuste,
          perfil,
        },
        slides.length,
        estilo
      )
    )
  }

  // La foto de prensa lleva su credito; la de banco no lo necesita.
  if (hecho && imagenes[0]) imagenes[0] = await estamparCredito(imagenes[0], hecho.medio, estilo)
  const images = await subirCarrusel(pieceKey, imagenes)

  // La de Facebook se dibuja aparte y con la misma foto: total 1 y sin
  // paginacion, que es lo que quita el "1 / 6" y el "desliza".
  let portadaFacebook: string | undefined
  if (conPortadaFacebook && slides[0]) {
    const png = await renderSlide(
      {
        slide: slides[0],
        variante: variantes[0],
        foto: fotoPortada,
        etiqueta: antetitulo,
        // La misma portada, con lo mismo encima. Se dibuja aparte solo para
        // quitarle la numeracion y el "desliza", que en una imagen suelta
        // invitan a un gesto que no existe; todo lo demas tiene que venir
        // igual, y el elemento se quedaba fuera por no pasarlo aqui.
        inserto,
        insertoPos,
        insertoForma,
        insertoAjuste,
      },
      1,
      { ...estilo, mostrarPaginacion: false }
    )
    portadaFacebook = await subirImagenSuelta(pieceKey, "facebook", hecho ? await estamparCredito(png, hecho.medio, estilo) : png)
  }

  return {
    caption,
    hashtags,
    images,
    ...(portadaFacebook ? { portadaFacebook } : {}),
    slideCount: slides.length,
    portadaSinFoto: sinFotoPortada,
    terminosFoto: terminos.slice(0, 6),
    creditos,
  }
}

/** La noticia de la que salio el angulo, para la foto de portada. */
export async function noticiaDelAngulo(angleId: string): Promise<RawNews | null> {
  const supabase = supabaseAdmin()

  const { data: angle } = await supabase
    .from("content_angles")
    .select("raw_news_id")
    .eq("id", angleId)
    .maybeSingle()

  const rawNewsId = (angle as { raw_news_id: string } | null)?.raw_news_id
  if (!rawNewsId) return null

  const { data } = await supabase.from("raw_news").select("*").eq("id", rawNewsId).maybeSingle()
  return (data as RawNews) ?? null
}

/** Los slugs de categoria, que son lo implicito y no deben buscarse en el banco. */
export async function nichosConocidos(accountId: string): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from("engine_categories")
    .select("slug")
    .eq("account_id", accountId)
  return ((data ?? []) as { slug: string }[]).map((row) => row.slug)
}

export { MAX_SLIDES, MIN_SLIDES }


/**
 * El elemento recortado de la portada, ya descargado.
 *
 * Se piden varias candidatas y se prueban en orden: la primera que se pueda
 * descargar de verdad gana. Muchas imagenes de resultados vienen de sitios que
 * bloquean la descarga directa o sirven HTML en vez de la imagen, asi que
 * quedarse con la primera sin comprobarla dejaria la portada sin elemento la
 * mitad de las veces.
 *
 * Se prueban las mas cuadradas primero: el hueco es cuadrado, y cuanto mas se
 * aleje la imagen de esa forma peor queda, se recorte o se encaje.
 */
export async function buscarInserto(
  consulta: string,
  accountId: string,
  /** La foto de fondo de la portada: el elemento no puede repetir lo que ya se ve en ella. */
  fotoPrincipal: string | null = null
): Promise<{ imagen: string; proporcion: number } | null> {
  if (!consulta) return null

  try {
    const { searchImage } = await import("../serper")
    const candidatas = await searchImage(accountId, consulta)
    if (candidatas.length === 0) return null

    // Primero las que parecen ser lo buscado (su titulo nombra lo que se pidio)
    // y, entre iguales, las mas cuadradas: el hueco es cuadrado.
    const claves = palabrasClave(consulta)
    const relevancia = (titulo: string) => {
      const t = sinTildes(titulo.toLowerCase())
      return claves.filter((c) => t.includes(c)).length
    }
    const forma = (c: { ancho: number; alto: number }) => Math.abs(Math.log(c.ancho / c.alto))
    const ordenadas = [...candidatas].sort((x, y) => relevancia(y.titulo) - relevancia(x.titulo) || forma(x) - forma(y))

    // Se bajan las primeras que se dejen (muchas bloquean la descarga o vienen vacias).
    const bajadas: { imagen: string; proporcion: number; titulo: string }[] = []
    for (const c of ordenadas.slice(0, 9)) {
      if (bajadas.length >= 5) break
      const imagen = await descargarInserto(c.url)
      if (imagen) bajadas.push({ imagen, proporcion: c.ancho / c.alto, titulo: c.titulo })
    }
    if (bajadas.length === 0) return null

    // Un modelo mira las candidatas y la foto de la portada y elige la que es de
    // verdad lo buscado. Antes se cogia una al azar entre las mas cuadradas, y
    // asi salio el escudo de un club de futbol turco para Asocaña, o el mismo
    // logo que ya aparecia en la foto. Si ninguna sirve, mejor sin elemento.
    const elegida = await elegirInserto(accountId, consulta, bajadas.map((b) => b.imagen), fotoPrincipal)
    if (elegida === null) {
      // Sin respuesta del modelo: solo se arriesga con una cuyo titulo nombre lo buscado.
      const segura = bajadas.find((b) => relevancia(b.titulo) >= Math.min(2, claves.length))
      return segura ? { imagen: segura.imagen, proporcion: segura.proporcion } : null
    }
    if (elegida === 0) return null
    const b = bajadas[elegida - 1]
    return b ? { imagen: b.imagen, proporcion: b.proporcion } : null
  } catch {
    // Una busqueda caida no puede tumbar el carrusel: es un adorno, no el post.
  }

  return null
}

const RELLENO = new Set(["logo", "de", "del", "la", "el", "los", "las", "y", "en", "para", "con", "colombia", "colombiano", "colombiana"])

function sinTildes(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/** Las palabras que identifican lo buscado: "logo Asocaña Colombia" -> ["asocana"]. */
function palabrasClave(consulta: string): string[] {
  return sinTildes(consulta.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2 && !RELLENO.has(p))
}

/** Achica una imagen para mostrarsela al modelo: menos tokens, la misma decision. */
async function miniatura(dataUri: string, lado: number): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default
    const buf = Buffer.from(dataUri.split(",")[1] ?? "", "base64")
    const jpg = await sharp(buf).flatten({ background: "#ffffff" }).resize(lado, lado, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer()
    return `data:image/jpeg;base64,${jpg.toString("base64")}`
  } catch {
    return null
  }
}

/**
 * Si la foto principal ya muestra lo buscado (el logo en la cola de un avion, en
 * un letrero, en un empaque). Es una pregunta sola y simple a proposito: mezclada
 * con la eleccion de candidatas, el modelo la contestaba distinto cada vez.
 */
async function yaEnLaFoto(accountId: string, consulta: string, principal: string): Promise<boolean> {
  const { llamarClaude, parsearJSONDeClaude } = await import("../claude/messages")
  const que = consulta.replace(/^logo\s+/i, "")
  const r = await llamarClaude({
    accountId,
    model: "claude-sonnet-5-5",
    system: "Miras una foto y respondes solo JSON.",
    prompt: `¿En esta foto se ve, en cualquier parte y aunque sea pequeño (un letrero, la cola o el fuselaje de un avión, un camión, un empaque, una pancarta, ropa, un banner, una esquina), el logo, el símbolo o el nombre de «${que}»? Si se busca un objeto, ¿la foto ya lo muestra?
Responde SOLO: {"se_ve": <true|false>}`,
    imagenes: [principal],
    maxTokens: 30,
    timeoutMs: 30_000,
  })
  if (!r.ok) return false
  return (parsearJSONDeClaude(r.texto) as { se_ve?: unknown } | null)?.se_ve === true
}

/**
 * Le pregunta a un modelo cual de las candidatas es lo buscado. Devuelve el
 * numero (desde 1), 0 si ninguna sirve (o si la foto ya lo muestra), o null si
 * no se pudo preguntar.
 */
async function elegirInserto(accountId: string, consulta: string, candidatas: string[], fotoPrincipal: string | null): Promise<number | null> {
  try {
    const { llamarClaude, parsearJSONDeClaude } = await import("../claude/messages")
    // La principal va grande: un logo en la cola de un avion o en un letrero es pequeño.
    const principal = fotoPrincipal ? await miniatura(fotoPrincipal, 1280) : null
    if (principal && (await yaEnLaFoto(accountId, consulta, principal))) return 0
    const minis: string[] = []
    for (const c of candidatas) {
      const m = await miniatura(c, 384)
      if (!m) return null
      minis.push(m)
    }
    const r = await llamarClaude({
      accountId,
      // Sonnet y no Haiku: Haiku aceptaba simbolos sueltos y banners con fotos dentro.
      model: "claude-sonnet-5-5",
      system: "Eliges la imagen pequeña que acompaña la portada de una noticia. Respondes solo JSON.",
      prompt: `Las imágenes son las candidatas, numeradas desde 1.

Se buscó: «${consulta}».

Elige la candidata que muestre EXACTAMENTE eso. Descarta una candidata si:
- no es lo buscado (otro logo, otra entidad, otra marca, otro producto, un escudo o logo de algo que no tiene que ver);
- es un logo y no se lee el NOMBRE de la entidad buscada (un símbolo solo no sirve), o es una versión deformada o de otra entidad con nombre parecido;
- es un logo y no está limpio y solo: trae una foto, un avión, un paisaje, un banner, o el logo de otra marca u organización al lado;
- tiene marca de agua, texto de otro sitio web, o es una captura de pantalla;
- está borrosa, vacía o casi en blanco.

Si varias sirven, elige la más nítida y limpia. Si ninguna sirve, responde 0.
Responde SOLO: {"elegida": <número de la candidata o 0>}`,
      imagenes: minis,
      maxTokens: 30,
      timeoutMs: 40_000,
    })
    if (!r.ok) return null
    const n = Number((parsearJSONDeClaude(r.texto) as { elegida?: unknown } | null)?.elegida)
    return Number.isInteger(n) && n >= 0 && n <= candidatas.length ? n : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------- plogy

/**
 * El carrusel con la estructura de Plogy (ver `plogy.tsx`): las laminas del
 * guion con su composicion y su fondo alternado, y el cierre de marca.
 */
async function generarCarruselPlogy(
  pieceKey: string,
  guion: ReturnType<typeof parseInstagramResponse>,
  news: RawNews | null,
  estilo: Estilo,
  nichos: string[],
  conPortadaFacebook: boolean
): Promise<CarouselPayload> {
  const { renderPlogy, fotoEnByN, repartirPlogy } = await import("./plogy")
  const { caption, hashtags, fotos, elemento } = guion
  const slides = guion.slides.slice(0, MAX_SLIDES - 1)

  const terminos = fotos.length > 0 ? fotos : terminosDeBusqueda(news, nichos, estilo.fotosLiterales)
  const banco = new BancoDeFotos(terminos)
  const creditos: { autor: string; url: string }[] = []
  const delBanco = async (): Promise<string | null> => {
    if (!estilo.usarFotos || !pexelsConfigurado()) return null
    const elegida = await banco.siguiente()
    if (!elegida) return null
    const descargada = await descargarFotoPexels(elegida)
    if (descargada && elegida.autor) creditos.push({ autor: elegida.autor, url: elegida.autorUrl })
    return descargada
  }

  const [logoClaro, logoOscuro] = await Promise.all([descargarFoto(estilo.logoClaro), descargarFoto(estilo.logoOscuro)])
  const hallado = news?.account_id ? await buscarInserto(elemento, news.account_id) : null
  const tema = [news?.niche, news?.tema].filter(Boolean).join(" + ")
  const reparto = repartirPlogy(slides.map((s) => ({ items: s.type === "text" ? s.items : null })))
  const total = slides.length + 1
  const titularDe = (s: Slide) => (s.type === "photo_hook" ? (s.hook ?? "") : (s.title ?? ""))

  const imagenes: Buffer[] = []
  let fotoPortada: string | null = null
  const hecho = await fotoDelHecho(news)
  for (const [i, slide] of slides.entries()) {
    const { composicion, fondo } = reparto[i]
    const necesitaFoto = composicion === "portada" || composicion === "foto"
    const foto = necesitaFoto ? await fotoEnByN((i === 0 ? hecho?.foto : null) ?? (await delBanco()) ?? (i === 0 ? await descargarFoto(news?.image_url) : null)) : null
    if (i === 0) fotoPortada = foto
    imagenes.push(
      await renderPlogy({
        composicion,
        fondo,
        titular: titularDe(slide),
        cuerpo: slide.type === "text" ? slide.body : null,
        lead: slide.type === "text" ? slide.lead : null,
        items: slide.type === "text" ? (slide.items ?? undefined) : undefined,
        foto,
        inserto: i === 0 ? (hallado?.imagen ?? null) : null,
        n: i + 1,
        total,
        tema,
        handle: estilo.marca,
        logoClaro,
        logoOscuro,
      })
    )
  }

  // El cierre: la marca y una sola accion, en el fondo que le toque.
  imagenes.push(
    await renderPlogy({
      composicion: "cierre",
      fondo: slides.length % 2 === 0 ? "tinta" : "papel",
      titular: estilo.cierre.titulo,
      cuerpo: estilo.cierre.texto,
      n: total,
      total,
      tema,
      handle: estilo.marca,
      logoClaro,
      logoOscuro,
    })
  )

  // La foto de prensa lleva su credito; la de banco no lo necesita.
  if (hecho && imagenes[0]) imagenes[0] = await estamparCredito(imagenes[0], hecho.medio, estilo)
  const images = await subirCarrusel(pieceKey, imagenes)
  let portadaFacebook: string | undefined
  if (conPortadaFacebook && slides[0]) {
    const png = await renderPlogy({
      composicion: "portada",
      fondo: "tinta",
      titular: titularDe(slides[0]),
      foto: fotoPortada,
      inserto: hallado?.imagen ?? null,
      n: 1,
      total: 1,
      tema,
      handle: estilo.marca,
      logoClaro,
      logoOscuro,
    })
    portadaFacebook = await subirImagenSuelta(pieceKey, "facebook", hecho ? await estamparCredito(png, hecho.medio, estilo) : png)
  }

  return {
    caption,
    hashtags,
    images,
    ...(portadaFacebook ? { portadaFacebook } : {}),
    slideCount: total,
    portadaSinFoto: fotoPortada === null,
    terminosFoto: terminos.slice(0, 6),
    creditos,
  }
}

// --------------------------------------------------------- editorial / impacto

/**
 * El carrusel en uno de los dos estilos alternativos (ver `estilos-noticia.tsx`):
 * la portada con el titular y el nicho, las laminas del guion alternando foto
 * y tipografia, y el cierre de marca.
 */
async function generarCarruselAlterno(
  pieceKey: string,
  guion: ReturnType<typeof parseInstagramResponse>,
  news: RawNews | null,
  estilo: Estilo,
  nichos: string[],
  conPortadaFacebook: boolean
): Promise<CarouselPayload> {
  const { renderNoticia, repartirNoticia } = await import("./estilos-noticia")
  const plantilla = estilo.plantilla === "impacto" || estilo.plantilla === "periodico" ? estilo.plantilla : "editorial"
  const { caption, hashtags, fotos, elemento } = guion
  const slides = guion.slides.slice(0, MAX_SLIDES - 1)

  const terminos = fotos.length > 0 ? fotos : terminosDeBusqueda(news, nichos, estilo.fotosLiterales)
  const banco = new BancoDeFotos(terminos)
  const creditos: { autor: string; url: string }[] = []
  // Cada lamina con foto pide la suya a SU busqueda (la portada a la primera,
  // la lamina 2 a la segunda...), como le promete el prompt al modelo.
  const delBanco = async (lamina: number): Promise<string | null> => {
    if (!estilo.usarFotos || !pexelsConfigurado()) return null
    const elegida = await banco.paraLamina(lamina)
    if (!elegida) return null
    const descargada = await descargarFotoPexels(elegida)
    if (descargada && elegida.autor) creditos.push({ autor: elegida.autor, url: elegida.autorUrl })
    return descargada
  }

  const [logoClaro, logoOscuro] = await Promise.all([descargarFoto(estilo.logoClaro), descargarFoto(estilo.logoOscuro)])
  // El elemento recortado de la portada ("impacto" y "periodico"), con los
  // mismos criterios que la clasica: forma y esquina a suertes, y llenar solo
  // si la imagen es casi cuadrada.
  const hecho = await fotoDelHecho(news)
  const fotoPortada = hecho?.foto ?? (await delBanco(0)) ?? (await descargarFoto(news?.image_url))
  // Se busca despues de tener la foto: el elemento no puede repetir lo que ya se ve en ella.
  const hallado = plantilla !== "editorial" && news?.account_id ? await buscarInserto(elemento, news.account_id, fotoPortada) : null
  const insertoForma = Math.random() < 0.5 ? ("circulo" as const) : ("cuadrado" as const)
  const insertoAjuste = hallado && hallado.proporcion > 0.62 && hallado.proporcion < 1.6 ? ("llenar" as const) : ("encajar" as const)
  const insertoPos = Math.floor(Math.random() * 4)
  // El indicador del nicho, igual que en la clasica: el tema del segmento.
  // La que escribio el redactor manda: el segmento no siempre corresponde.
  const nicho = (guion.etiqueta || news?.tema || news?.niche || "").trim()
  const total = slides.length + 1
  const titularDe = (s: Slide) => (s.type === "photo_hook" ? (s.hook ?? "") : (s.title ?? ""))
  const reparto = repartirNoticia(Math.max(0, slides.length - 1), estilo.usarFotos && pexelsConfigurado())
  // La fecha de la noticia, para el pie del estilo periodico ("28 de octubre de 2026").
  const fecha = new Date(news?.created_at ?? Date.now()).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" })
  const comun = { plantilla, nicho, fecha, total, logoClaro, logoOscuro, estilo, insertoForma, insertoAjuste, insertoPos } as const
  const imagenes: Buffer[] = []
  for (const [i, slide] of slides.entries()) {
    const composicion = i === 0 ? "portada" : reparto[i - 1]
    imagenes.push(
      await renderNoticia({
        ...comun,
        composicion,
        titular: titularDe(slide),
        cuerpo: slide.type === "text" ? slide.body : null,
        // La lamina 2 repite la foto real de la noticia, sin el elemento: quien
        // llega en frio a ella ve la misma imagen que la nota del portal. La 3
        // lleva una de banco, de su propia busqueda.
        foto: i <= 1 && fotoPortada ? fotoPortada : composicion === "foto" ? await delBanco(i - 1) : null,
        inserto: i === 0 ? (hallado?.imagen ?? null) : null,
        n: i + 1,
      })
    )
  }
  // Si la noticia tiene nota en el portal, el cierre ya no pide seguir la
  // cuenta: invita a leer la nota en el link del perfil, en grande (Instagram no
  // deja links en el texto). Sin nota, queda el cierre de marca de siempre.
  const { linkDeLaNota } = await import("../content/desde-portal")
  const leerNota = Boolean(news?.id && (await linkDeLaNota(news.id)))
  imagenes.push(await renderNoticia({ ...comun, composicion: "cierre", titular: estilo.cierre.titulo, cuerpo: estilo.cierre.texto, leerNota, n: total }))

  // La foto de prensa lleva su credito, en la portada y en la lamina 2 que la
  // repite; la de banco no lo necesita.
  if (hecho && imagenes[0]) imagenes[0] = await estamparCredito(imagenes[0], hecho.medio, estilo)
  // En el periodico la foto de una lamina interior termina en y=706: el credito va justo debajo.
  if (hecho && imagenes[1] && plantilla === "periodico" && reparto[0] === "foto") imagenes[1] = await estamparCredito(imagenes[1], hecho.medio, estilo, 710)
  const images = await subirCarrusel(pieceKey, imagenes)
  let portadaFacebook: string | undefined
  if (conPortadaFacebook && slides[0]) {
    const png = await renderNoticia({ ...comun, composicion: "portada", titular: titularDe(slides[0]), foto: fotoPortada, inserto: hallado?.imagen ?? null, n: 1, total: 1 })
    portadaFacebook = await subirImagenSuelta(pieceKey, "facebook", hecho ? await estamparCredito(png, hecho.medio, estilo) : png)
  }

  return {
    caption,
    hashtags,
    images,
    ...(portadaFacebook ? { portadaFacebook } : {}),
    slideCount: total,
    portadaSinFoto: fotoPortada === null,
    terminosFoto: terminos.slice(0, 6),
    creditos,
  }
}

/**
 * La foto del hecho para la portada: la misma que lleva la nota del portal.
 *
 * Al investigar la noticia para el portal se consigue la imagen principal del
 * articulo original, que muestra lo que paso de verdad; una de banco solo lo
 * sugiere. Se busca en este orden: la que ya guardo la redaccion, la que se leyo
 * de la pagina de la noticia y, si la redaccion aun no ha llegado, la pagina
 * misma (su og:image, que es lo que la redaccion va a usar). Tiene que ser
 * grande: una miniatura estirada a 1080 se ve peor que una foto de banco.
 */
export async function fotoDelHecho(news: RawNews | null): Promise<{ foto: string; medio: string | null } | null> {
  if (!news?.id) return null
  try {
    const s = supabaseAdmin()
    const [{ data: redaccion }, { data: fuente }] = await Promise.all([
      s.from("news_redacciones").select("imagen_url, imagen_credito").eq("raw_news_id", news.id).maybeSingle(),
      s.from("news_sources").select("imagen, medio").eq("raw_news_id", news.id).eq("origen", "noticia").limit(1).maybeSingle(),
    ])
    const r = redaccion as { imagen_url?: string; imagen_credito?: { medio?: string | null } | null } | null
    const f = fuente as { imagen?: string | null; medio?: string | null } | null
    const vistas = new Set<string>()
    const probar = async (url: unknown, medio: string | null | undefined, minimo = 600) => {
      if (typeof url !== "string" || vistas.has(url)) return null
      vistas.add(url)
      const foto = await fotoGrande(url, minimo)
      return foto ? { foto, medio: medio || f?.medio || news.source || null } : null
    }
    // La foto de la nota del portal va SIEMPRE, mida lo que mida: el carrusel
    // tiene que mostrar la misma foto que la persona encuentra al abrir la nota.
    // Una de 560 px se descartaba por pequeña y la portada salia con una de banco.
    const deRedaccion = await probar(r?.imagen_url, r?.imagen_credito?.medio, 0)
    if (deRedaccion) return deRedaccion
    const deFuente = await probar(f?.imagen, f?.medio)
    if (deFuente || !news.link) return deFuente
    const pagina = await leerPagina(news.link)
    return await probar(pagina?.imagen, pagina?.medio)
  } catch {
    return null
  }
}

/** Baja una foto y la deja en JPEG si mide al menos 600 px de ancho. */
async function fotoGrande(url: string, minimo = 600): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36", Accept: "image/*" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const sharp = (await import("sharp")).default
    const img = sharp(Buffer.from(await res.arrayBuffer()))
    const info = await img.metadata()
    if (!info.width || info.width < minimo) return null
    // Las pequeñas se agrandan a 1080, el ancho de la lamina, para que no se vean borrosas de mas.
    const jpg = await img.rotate().resize({ width: Math.max(1080, Math.min(info.width, 1600)) }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer()
    return `data:image/jpeg;base64,${jpg.toString("base64")}`
  } catch {
    return null
  }
}
