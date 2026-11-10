# Perxia 2.0 — Agente Conversacional de Registro de Contratos Vigentes (Reto 02)

Solución completa end-to-end para el **Reto Técnico 02 de Periferia IT Group**: un agente conversacional en TypeScript que actúa como punto único de recepción para leer el buzón de contratos, extraer datos estructurados con niveles de confianza, detectar duplicados y actualizaciones (otrosíes), requerir confirmación humana (*Human-in-the-Loop*) cuando la confianza es $< 0.80$, archivar en estructura SharePoint y generar el reporte ejecutivo de alertas de vencimiento y pólizas.

---

## 1. Requisitos Previos

- **Bun** `>= 1.1` (recomendado) o **Node.js** `>= 20`.

---

## 2. Levantar en Local (Un Comando)

```bash
# 1. Instalar dependencias y ejecutar la verificación determinista sin modelo (demo.ts)
bun install && bun run demo.ts

# 2. Levantar servidor Backend + Frontend interactivo en http://localhost:3000
bun run dev
```

Abre en tu navegador: **`http://localhost:3000`**

---

## 3. Variables de Entorno (`.env`)

Copia `.env.example` a `.env` si deseas conectar un proveedor LLM en la nube (la clave **nunca** se expone en el frontend ni en los logs):

```bash
cp .env.example .env
```

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `LLM_PROVIDER` | `"auto"` \| `"gemini"` \| `"openai"` \| `"anthropic"` | `"auto"` (usa la primera clave disponible o el motor ReAct determinista local si no hay clave configurada) |
| `GEMINI_API_KEY` | Clave de API de Google Gemini | *(vacío)* |
| `OPENAI_API_KEY` | Clave de API de OpenAI | *(vacío)* |
| `ANTHROPIC_API_KEY` | Clave de API de Anthropic | *(vacío)* |
| `MAX_ITERATIONS_PER_TURN` | Tope de iteraciones herramienta $\rightarrow$ modelo por turno (CA1) | `25` |
| `MAX_TOKENS_PER_SESSION` | Presupuesto máximo de tokens por sesión (Sección 8) | `120000` |
| `PORT` | Puerto HTTP de la aplicación | `3000` |

---

## 4. Ejecutar Verificación sin Modelo (`demo.ts`) y Suite de Tests

```bash
# Ejecuta las herramientas directamente sobre los 6 mensajes del buzón (sin consumir LLM)
bun run demo.ts

# Ejecuta la suite completa de pruebas automatizadas (62 aserciones: motor, HITL, API HTTP y módulo bonus)
bun test

# Verificación estricta de tipos TypeScript (sin any)
bun run typecheck
```

---

## 5. API HTTP Documentada (Sección 6.4 del PRD)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Recibe `{ sessionId, message }` y devuelve `{ ok, reply, toolCalls[], needsConfirmation, iterations, usage }`. |
| `GET` | `/api/sessions/:id` | Devuelve el historial completo de mensajes y llamadas a herramientas de la sesión. |
| `GET` | `/api/health` | Devuelve `{ ok: true, provider, model, maxIterationsPerTurn, maxTokensPerSession, toolsRegistered }` sin exponer claves. |
| `GET` | `/api/state` | Devuelve el estado en vivo de `out/sharepoint/maestro-contratos.csv`, `buzon`, `alertas.md`, `historial.jsonl` y `log.jsonl`. |
| `POST` | `/api/reset` | Limpia `out/` y reinicia el maestro al corte original del `2026-05-30` para repetir demostraciones en vivo. |

---

## 6. Estructura del Repositorio

```text
reto-02/
├── agent/
│   └── prompt.md                        # System prompt del agente (comportamiento)
├── src/
│   ├── server.ts                        # Servidor HTTP y ciclo ReAct del agente (CA1-CA5)
│   ├── app/
│   │   └── index.html                   # Interfaz web: Chat + Tool Calls + HITL + Inspector SharePoint
│   ├── services/
│   │   └── contratos-engine.ts          # Motor determinista puro (extracción, validación RN1-RN5, alertas)
│   ├── tools/
│   │   └── contratos.ts                 # Herramientas tipadas con Zod (contratos_<export>)
│   ├── llm/
│   │   ├── adapter.ts                   # Interfaz desacoplada LLMAdapter y conversor Zod -> JSON Schema
│   │   └── providers.ts                 # Implementaciones Gemini, OpenAI, Anthropic y ReAct Local
│   └── knowledge/
│       └── registro-contratos.md        # Conocimiento de reglas de negocio y normalización
├── modulo/                              # Bonus Sección 9.4: Agente empaquetado como módulo reutilizable
│   ├── agent.md
│   ├── tools/contratos.ts
│   └── skill/registro-contratos/SKILL.md
├── tests/
│   └── contratos.test.ts                # Suite de pruebas end-to-end (bun test)
├── fixtures/reto-02/                    # Insumos originales de Periferia (intactos, solo lectura)
├── demo.ts                              # Script de verificación determinista sin LLM
├── .env.example                         # Plantilla de variables de entorno
├── README.md                            # Guía de arranque y referencia de API
└── SOLUCION.md                          # Documentación técnica, costos y regla de gobierno
```

