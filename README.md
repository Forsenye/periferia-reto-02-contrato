# Perxia 2.0 — Agente de gestión de contratos

Aplicación de demostración en TypeScript con un agente conversacional para la recepción, clasificación y gestión de contratos, validación contra un maestro de SharePoint simulado y generación de alertas de vencimiento.

## Estructura del proyecto

```text
.
├── agent/prompt.md          # Instrucciones del agente
├── src/tools/contratos.ts   # Herramientas para gestionar contratos
├── fixtures/reto-02/        # Casos de prueba y datos de entrada
├── demo.ts                  # Verificación determinista del buzón
└── SOLUCION.md              # Documentación técnica de la solución
```

## Requisitos previos y configuración local

- Bun 1.1 o superior (requerido por los comandos del proyecto). Node.js 20 o superior por sí solo no reemplaza Bun.
- Git para clonar el repositorio.

Instala las dependencias y crea tu archivo local de variables de entorno:

```bash
git clone https://github.com/Forsenye/periferia-reto-02-contrato.git
cd periferia-reto-02-contrato
bun install
cp .env.example .env
```

Edita `.env` si deseas configurar un proveedor LLM. `LLM_PROVIDER=auto` usa la primera clave disponible (`GEMINI_API_KEY`, `OPENAI_API_KEY` o `ANTHROPIC_API_KEY`) y, si no hay ninguna, utiliza el motor determinista local. No compartas ni subas claves al repositorio.

## Ejecución local y verificación determinista

Inicia el servidor de desarrollo y abre <http://localhost:3000> para usar el chat web:

```bash
bun run dev
```

Para procesar y verificar los seis casos del buzón sin consumir llamadas ni tokens de un LLM, ejecuta en otra terminal:

```bash
bun run demo.ts
```

También está disponible el script configurado en `package.json`:

```bash
bun run demo
```

## Guía de despliegue

### Railway (recomendado para el servidor actual)

La aplicación es un servidor Bun persistente y escribe los datos generados en `out/`. Railway permite desplegarla como servicio web mediante Docker y configurar almacenamiento persistente.

1. Añade un `Dockerfile` en la raíz:

   ```dockerfile
   FROM oven/bun:1
   WORKDIR /app
   COPY package.json bun.lock ./
   RUN bun install --frozen-lockfile
   COPY . .
   ENV NODE_ENV=production
   CMD ["bun", "run", "start"]
   ```

2. En Railway, crea un proyecto y despliega este repositorio como servicio, seleccionando la construcción con Docker.
3. Configura las variables de entorno en la sección **Variables** del servicio, no en el código. Como mínimo, establece `LLM_PROVIDER=local` para el motor local; para un proveedor en la nube, configura `LLM_PROVIDER=gemini` y `GEMINI_API_KEY` como secreto, o los nombres correspondientes a OpenAI o Anthropic. `PORT` lo asigna la plataforma. Los límites opcionales son `MAX_ITERATIONS_PER_TURN`, `MAX_TOKENS_PER_SESSION` y `LLM_TIMEOUT_MS`.
4. Si necesitas conservar los datos entre despliegues, monta un volumen persistente en `/app/out`. No montes el volumen sobre `fixtures/`.
5. Configura la comprobación de salud en `/api/health`, despliega y comprueba la URL generada.

### Vercel

El proyecto actualmente utiliza un servidor Bun persistente y almacenamiento en archivos, por lo que no se despliega directamente en Vercel como una función serverless. Para publicarlo allí es necesario adaptar el servidor a funciones compatibles y sustituir el almacenamiento local de `out/` por almacenamiento persistente externo. Para ejecutar el servidor actual sin esa adaptación, usa Railway.

**Seguridad:** antes de exponer la aplicación en una URL pública, implementa autenticación y autorización del lado del servidor, y restringe o deshabilita las rutas administrativas. No publiques una instancia sin protección ni cargues secretos en el repositorio.

---

Referencia: la documentación técnica profunda se encuentra en `SOLUCION.md`.
