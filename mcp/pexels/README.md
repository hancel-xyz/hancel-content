# MCP de Pexels

Puente entre Claude y la API de Pexels: buscar, ver y descargar fotos y videos, y abrir tus colecciones.

Funciona solo con Node 18 o superior. No usa dependencias, así que no necesitas `npm install`.

## Clave

El servidor busca `PEXELS_API_KEY` en este orden:

1. La variable de entorno `PEXELS_API_KEY`.
2. El archivo `.env.local` (o `.env`) en la raíz de este repo.

## Conectarlo

**Claude Code, dentro de este repo:** ya viene registrado en `.mcp.json`. La primera vez Claude te pregunta si apruebas el servidor `pexels`; dile que sí.

**Claude Code, en cualquier carpeta:**

```bash
claude mcp add pexels --scope user -- node "C:/Users/setr7/Documents/engine-hancel/mcp/pexels/server.mjs"
```

**Claude Desktop:** agrega esto a `%APPDATA%\Claude\claude_desktop_config.json` y reinicia la app:

```json
{
  "mcpServers": {
    "pexels": {
      "command": "node",
      "args": ["C:/Users/setr7/Documents/engine-hancel/mcp/pexels/server.mjs"]
    }
  }
}
```

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `buscar_fotos` | Busca fotos por palabra clave, con filtros de orientación, tamaño, color e idioma |
| `fotos_destacadas` | Fotos curadas por Pexels |
| `obtener_foto` | Datos de una foto por su id |
| `ver_fotos` | Le muestra a Claude hasta 6 fotos como imagen para que pueda elegir |
| `descargar_foto` | Guarda una foto en disco (por defecto en `~/Downloads/pexels`) |
| `buscar_videos` | Busca videos y devuelve los MP4 de cada calidad |
| `videos_populares` | Videos populares, con filtros de tamaño y duración |
| `obtener_video` | Datos de un video por su id |
| `mis_colecciones` | Las colecciones de tu cuenta de Pexels |
| `colecciones_destacadas` | Colecciones destacadas de Pexels |
| `contenido_coleccion` | Las fotos y videos de una colección |

## Prueba rápida

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/pexels/server.mjs
```
