# Conector de Pexels para claude.ai

Este conector le da a Claude acceso a Pexels con nuestra clave de la API. Con él, Claude puede buscar y ver fotos y videos, y abrir nuestras colecciones.

El endpoint está en la app (`src/app/api/mcp/pexels/[token]/route.ts`) y la lógica en `src/engine/pexels-mcp.ts`. Se despliega con Vercel al subir a `main`.

## URL del conector

```
https://app.hancel.xyz/api/mcp/pexels/<TOKEN>
```

El token protege la cuota de Pexels porque claude.ai no deja mandar cabeceras propias a un conector. Si no hay `PEXELS_MCP_TOKEN` en Vercel, el token se calcula a partir de la clave de Pexels:

```bash
node -e "const k=require('fs').readFileSync('.env.local','utf8').match(/^PEXELS_API_KEY=(.*)$/m)[1].trim();console.log(require('crypto').createHash('sha256').update('pexels-mcp:'+k).digest('hex').slice(0,32))"
```

Si cambias la clave de Pexels, cambia también la URL. Para fijar un token propio, define `PEXELS_MCP_TOKEN` en Vercel.

## Instalarlo en claude.ai

1. Abre claude.ai y ve a **Configuración → Conectores**.
2. Pulsa **Agregar conector personalizado**.
3. Escribe *Pexels* como nombre, pega la URL de arriba y pulsa **Agregar**.
4. En un chat, actívalo desde el botón **+ → Conectores**.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `buscar_fotos` | Busca fotos por palabra clave, con filtros de orientación, tamaño, color e idioma |
| `fotos_destacadas` | Muestra las fotos curadas por Pexels |
| `obtener_foto` | Trae los datos y los enlaces de descarga de una foto |
| `ver_fotos` | Le muestra a Claude hasta 6 fotos como imagen |
| `buscar_videos` | Busca videos y devuelve los MP4 de cada calidad |
| `videos_populares` | Muestra los videos populares |
| `obtener_video` | Trae los datos de un video |
| `mis_colecciones` | Lista las colecciones de nuestra cuenta de Pexels |
| `colecciones_destacadas` | Lista las colecciones destacadas de Pexels |
| `contenido_coleccion` | Muestra las fotos y videos de una colección |

## Versión local

`server.mjs` es el mismo puente para clientes locales por stdio, como Claude Code o Claude Desktop:

```bash
claude mcp add pexels -- node "<ruta>/mcp/pexels/server.mjs"
```
