import { llamarClaude, parsearJSONDeClaude } from "../claude/messages"

/**
 * El puntaje de redes: de 1 a 10, cuanto alcance e interaccion se espera de una
 * nota del portal publicada como carrusel.
 *
 * No es el score del analisis: ese mide si la noticia es relevante para el
 * sector (y decide que se redacta). Este mide si en Instagram y Facebook la gente
 * del campo se va a detener, comentar, guardar o compartir. Con el puntaje
 * minimo de la cuenta, el portal sigue publicando todas las notas y a redes solo
 * salen las mejores: menos carruseles al dia, que no se reparten el alcance.
 *
 * El criterio salio de comparar los carruseles de Indice Agro con sus metricas
 * reales (noviembre de 2026). Predice poco cada post por separado (el algoritmo
 * pesa mas que el tema), pero los de puntaje alto rinden mejor en conjunto.
 * Revisarlo contra las metricas de vez en cuando.
 */

const MODELO = "claude-sonnet-5-5"

const SISTEMA = `Eres el editor de redes sociales de un medio de noticias del agro latinoamericano en Instagram y Facebook. Su audiencia son productores, ganaderos, técnicos, comerciantes y gente del campo, sobre todo de Colombia pero también del resto de Latinoamérica, y lee en el celular.

Tu trabajo: calificar de 1 a 10 qué tanto alcance e interacción va a tener una noticia publicada como carrusel. No calificas si la noticia es importante o está bien escrita: calificas si la gente del campo se va a detener, leerla, comentarla, guardarla o compartirla.

## Lo que hace que un carrusel funcione (de más a menos peso)

1. **Le toca el bolsillo o la producción al productor, ya.** El precio de lo que vende (café, leche, arroz, ganado, cacao, papa, plátano, frutas), el costo de lo que compra (insumos, fertilizantes, crédito, impuestos), lo que le pagan, lo que pierde. Mientras más directo y concreto, más alto.
2. **Le sirve para hacer algo.** Una oportunidad gratis o un apoyo (curso, convocatoria, crédito, subsidio), un requisito o trámite nuevo con fecha, un plazo, una alerta con qué hacer. La gente guarda y comparte lo útil.
3. **Trae una cifra fuerte y fácil de entender.** "Bajó de dos millones por primera vez", "cayó 22 %", "el nivel más bajo en 75 años". Un umbral psicológico, un récord, un "por primera vez".
4. **Es cercano.** Colombia primero, y mejor si nombra una región o un cultivo masivo. Otro país de Latinoamérica también funciona si el hecho es concreto y le interesa a un productor de la región (precios, plagas, clima, un cultivo que también se siembra aquí). Lo de fuera de la región solo cuenta si afecta a los precios o mercados de aquí.
5. **Sorprende o despierta curiosidad.** Un dato inesperado, algo que contradice lo que la gente cree, un descubrimiento.

Las decisiones de los gremios grandes (Federación de Cafeteros, Fedegán, Fedearroz…) y del Gobierno cuentan como "bolsillo" cuando cambian algo concreto para miles de productores (un contrato de los fondos, un precio de sustentación, un crédito, un impuesto).

## Lo que hunde un carrusel

- Lo institucional sin efecto inmediato: un proyecto que pasa un debate, un plan aprobado sin dinero concreto para el productor, una cumbre, un foro, una reunión, una firma protocolaria.
- Declaraciones de funcionarios sin un dato o una consecuencia concreta.
- Temas que no son del campo aunque se crucen con él (energía, minería, océanos, política general, inflación urbana).
- Lo técnico de nicho que solo entiende un especialista.
- Un tema muy repetido esos días (por ejemplo, otra nota genérica de El Niño sin un dato nuevo y concreto para un cultivo o región).
- Noticias que ya se resolvieron o se cancelaron (una marcha desconvocada, un problema ya arreglado).
- Ayuda humanitaria, presupuestos o programas de otro país sin efecto para el productor del común.

## Escala

- **9-10**: excepcional. Golpea directo al bolsillo de muchos productores con una cifra contundente o una oportunidad clara (ej.: el precio del café o de la leche cruza un umbral; un apoyo gratis para miles). Menos de 1 de cada 20 noticias.
- **7-8**: fuerte. Cumple con claridad al menos dos de los cinco puntos.
- **5-6**: normal. Interesante para el sector pero sin gancho fuerte para redes.
- **3-4**: débil. Cae en lo que hunde un carrusel, aunque tenga algo de valor.
- **1-2**: no debería salir en redes.

Sé exigente y reparte la escala: la mayoría de noticias de un día normal quedan entre 3 y 6.

## Respuesta

Solo JSON, sin texto alrededor: {"puntaje": <1-10>, "razon": "<una frase corta>"}`

export type PuntajeRedes = { puntaje: number; razon: string }

/** Califica una nota para redes. Lanza si Claude no responde o no da un numero valido. */
export async function puntuarParaRedes(
  accountId: string,
  nota: { titular: string; resumen: string | null; tema: string | null; texto: string }
): Promise<PuntajeRedes> {
  const prompt = [
    `Titular: ${nota.titular}`,
    nota.resumen ? `Resumen: ${nota.resumen}` : "",
    nota.tema ? `Tema: ${nota.tema}` : "",
    `Nota:\n${nota.texto.slice(0, 2500)}`,
  ]
    .filter(Boolean)
    .join("\n")
  const r = await llamarClaude({ accountId, model: MODELO, system: SISTEMA, prompt, maxTokens: 300, timeoutMs: 60_000 })
  if (!r.ok) throw new Error(`Puntaje de redes: ${r.error}`)
  const x = parsearJSONDeClaude(r.texto) as Partial<PuntajeRedes> | null
  const puntaje = Math.round(Number(x?.puntaje))
  if (!Number.isFinite(puntaje) || puntaje < 1 || puntaje > 10) throw new Error(`Puntaje de redes invalido: ${r.texto.slice(0, 120)}`)
  return { puntaje, razon: String(x?.razon ?? "").slice(0, 300) }
}
