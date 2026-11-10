# Perxia 2.0 — Agente Conversacional de Registro de Contratos Vigentes (Reto 02)

Solución end-to-end para el **Reto Técnico 02 de Periferia IT Group**: un agente conversacional en TypeScript que procesa mensajes y documentos de contratos, extrae campos estructurados con niveles de confianza, valida la información contra un maestro de contratos y genera alertas de vencimiento y pólizas. Incluye motor determinista, integración opcional con proveedores LLM, confirmación humana (HITL), API HTTP e interfaz web.

> **Importante:** este proyecto es una solución de demostración. No publiques una instancia accesible desde Internet sin implementar autenticación y controles de acceso. Varias rutas permiten consultar información contractual, cambiar la configuración del LLM o borrar el estado generado.

---

## 1. Requisitos previos

- **Bun >= 1.1** (recomendado y requerido para los comandos del proyecto).
- **Docker** si vas a desplegar mediante contenedor.
- Una clave de API de Gemini, OpenAI o Anthropic solo si deseas usar un LLM en la nube. El motor local determinista funciona sin clave.

---

## 2. Ejecutar localmente

Desde la raíz del repositorio:

```bash
bun install
bun run typecheck
bun test
bun run demo.ts
bun run dev
```

Abre <http://localhost:3000>. Para usar un proveedor LLM, copia `.env.example` a `.env` y configura la clave correspondiente. No subas `.env` ni claves al repositorio.

---

## 3. Variables de entorno

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `LLM_PROVIDER` | `auto`, `gemini`, `openai`, `anthropic` o `local` | `auto` |
| `GEMINI_API_KEY` | Clave de Google Gemini | Vacía |
| `OPENAI_API_KEY` | Clave de OpenAI | Vacía |
| `ANTHROPIC_API_KEY` | Clave de Anthropic | Vacía |
| `GEMINI_MODEL` | Modelo Gemini | `gemini-2.5-flash` |
| `OPENAI_MODEL` | Modelo OpenAI | `gpt-4o-mini` |
| `ANTHROPIC_MODEL` | Modelo Anthropic | `claude-3-5-haiku-latest` |
| `MAX_ITERATIONS_PER_TURN` | Máximo de iteraciones del agente por turno | `25` |
| `MAX_TOKENS_PER_SESSION` | Límite de tokens por sesión | `120000` |
| `LLM_TIMEOUT_MS` | Tiempo máximo de espera al proveedor LLM | `30000` |
| `PORT` | Puerto HTTP | `3000` local; la plataforma suele asignarlo en despliegue |

Con `LLM_PROVIDER=auto`, la aplicación intenta usar la primera clave LLM disponible; sin claves, usa el motor ReAct local. Para una demo sin llamadas a servicios externos se puede indicar `LLM_PROVIDER=local`.

---

## 4. Pruebas y verificación

```bash
# Ejecuta el recorrido determinista de demostración sin consumir tokens LLM
bun run demo.ts

# Suite automatizada
bun test

# Verificación estricta de tipos TypeScript
bun run typecheck
```

---

## 5. Despliegue con Docker (Railway, Render o VPS)

El repositorio no incluye una configuración de despliegue ya creada. Este procedimiento construye una imagen Docker y puede adaptarse a una plataforma que admita Docker. Los nombres de opciones de la consola pueden variar según la plataforma.

### 5.1 Agrega un `Dockerfile` en la raíz

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
```

La aplicación necesita que estén disponibles dentro de la imagen `src/`, `agent/` y `fixtures/`. Este Dockerfile copia el repositorio completo; asegúrate de no tener secretos ni archivos `.env` versionados. El archivo `.gitignore` debe excluir `.env` y los artefactos generados.

### 5.2 Verifica la imagen en local

Desde la raíz del proyecto:

```bash
docker build -t perxia-contratos .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e LLM_PROVIDER=local \
  perxia-contratos
```

Luego comprueba <http://localhost:3000/api/health> y abre <http://localhost:3000> para verificar la interfaz. Para probar un proveedor remoto, configura su clave con `-e GEMINI_API_KEY=...` (o la variable del proveedor elegido); evita escribir claves en el historial del shell o en archivos versionados.

### 5.3 Publica el servicio

1. Sube el `Dockerfile` al repositorio.
2. En Railway, Render u otra plataforma compatible, crea un servicio web desde el repositorio y selecciona la construcción mediante Docker.
3. Configura las variables de entorno en el panel seguro de la plataforma, no en el código. Por ejemplo:

   ```text
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=<configúrala como secreto en la plataforma>
   GEMINI_MODEL=gemini-2.5-flash
   MAX_ITERATIONS_PER_TURN=25
   MAX_TOKENS_PER_SESSION=120000
   ```

   Si no quieres usar un LLM externo, configura `LLM_PROVIDER=local` y no agregues una clave.
4. Permite que la plataforma asigne el puerto mediante `PORT`. La aplicación escucha ese puerto; no fijes un puerto distinto en el código.
5. Si la plataforma admite comprobación de salud, configura la ruta `GET /api/health`.
6. Despliega y revisa los registros de inicio y la respuesta de `/api/health`. No deben aparecer claves API en los registros.

### 5.4 Persistencia de los datos generados

La aplicación escribe los resultados en el directorio `out/` (por ejemplo, el maestro de contratos, archivos archivados, historial, logs y alertas). Configura un disco o volumen persistente montado en **`/app/out`** dentro del contenedor. Sin almacenamiento persistente, estos archivos pueden desaparecer cuando la plataforma reemplaza la instancia o reconstruye el contenedor.

El directorio `fixtures/` contiene datos de entrada y debe conservarse como datos iniciales; no lo montes sobre `out/`. Haz respaldos de `out/` y prueba el procedimiento de recuperación antes de usar información importante. El almacenamiento local de un contenedor no sustituye una base de datos ni ofrece por sí solo copias de seguridad o escrituras concurrentes seguras.

### 5.5 Seguridad antes de exponerlo públicamente

**No es seguro publicar la aplicación tal como está sin una capa de protección.** En el código actual:

- No se observa autenticación para `/api/chat`, `/api/state` ni `/api/sessions/:id`; pueden exponer información y permitir uso no autorizado.
- `POST /api/reset` elimina `out/` y reinicia los datos de trabajo.
- `POST /api/llm-config` permite modificar la configuración del proveedor LLM en memoria.
- CORS está configurado para aceptar cualquier origen (`*`).

Antes de un despliegue público, añade autenticación y autorización del lado del servidor, restringe o deshabilita las rutas administrativas (`/api/reset` y `/api/llm-config`), protege los datos de estado y sesiones, limita CORS a los orígenes permitidos y considera límites de solicitudes. No confíes en ocultar botones en el frontend como medida de seguridad. Para una demostración, usa una instancia privada o restringida y datos no sensibles.

---

## 6. API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Recibe `{ sessionId, message }` y ejecuta un turno del agente. |
| `GET` | `/api/sessions/:id` | Devuelve el historial y las llamadas a herramientas de una sesión. |
| `GET` | `/api/health` | Estado del servicio, proveedor, límites y herramientas registradas; no devuelve la clave API. |
| `GET` | `/api/state` | Estado del maestro, buzón, alertas, historial y logs. Protege esta ruta si el servicio es accesible por terceros. |
| `POST` | `/api/llm-config` | Configura proveedor/modelo/clave en memoria del proceso. Restringir a administradores; preferir secretos gestionados por la plataforma. |
| `POST` | `/api/reset` | Borra `out/` y reinicia las sesiones en memoria. Restringir a administradores o deshabilitar en producción. |

---

## 7. Estructura del repositorio

```text
.
├── agent/prompt.md                 # Instrucciones del agente
├── src/
│   ├── server.ts                   # Servidor HTTP y ciclo ReAct
│   ├── app/index.html              # Interfaz web
│   ├── services/contratos-engine.ts # Motor determinista y reglas de negocio
│   ├── tools/contratos.ts          # Herramientas tipadas con Zod
│   ├── llm/                        # Adaptadores de proveedores y modo local
│   └── knowledge/                  # Reglas y conocimiento del dominio
├── modulo/                         # Módulo reutilizable (bonus)
├── tests/                          # Pruebas automatizadas
├── fixtures/reto-02/               # Datos de entrada
├── demo.ts                         # Demo determinista
├── .env.example                    # Plantilla de configuración, sin secretos
├── Dockerfile                      # Añadir para despliegue con Docker
├── README.md
└── SOLUCION.md                     # Documentación técnica de la solución
```

---

## 8. Compartir el repositorio

**Enlace para compartir:** https://github.com/Forsenye/periferia-reto-02-contrato

Puedes compartir esta descripción:

> **Perxia 2.0** es un agente conversacional en TypeScript para apoyar la recepción y gestión de contratos. Extrae información estructurada con niveles de confianza, valida contratos frente a un maestro, identifica duplicados y actualizaciones, solicita confirmación humana cuando hay incertidumbre y genera alertas de vencimientos y pólizas. Incluye una interfaz web, API HTTP, pruebas automatizadas y un modo determinista que permite ejecutar la demo sin una clave LLM. Consulta el README para instalación, pruebas y despliegue.

El enlace anterior comparte el **código fuente**. Para compartir una aplicación en funcionamiento, primero despliega el servicio siguiendo la sección 5 y comparte la URL pública que te entregue la plataforma solo después de protegerlo; esa URL será distinta a la del repositorio.
