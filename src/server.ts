import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { z } from "zod";
import * as contratosTools from "./tools/contratos.ts";
import {
  convertirZodAJsonSchema,
  type EsquemaHerramientaLLM,
  type MensajeAgente,
} from "./llm/adapter.ts";
import {
  configurarLLMRuntime,
  crearAdaptadorLLM,
  DeterministicReActAdapter,
  tieneApiKeyPersonalizada,
  type RuntimeLLMConfig,
} from "./llm/providers.ts";
import {
  asegurarEntornoSalida,
  getRutasProyecto,
  leerMaestroContratos,
  leerProcesados,
  type CorreoRaw,
  type EntradaHistorial,
  type EntradaLog,
} from "./services/contratos-engine.ts";

// ============================================================================
// CONFIGURACIÓN Y REGISTRO DINÁMICO DE HERRAMIENTAS (<archivo>_<export>)
// ============================================================================

const PROJECT_ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const MAX_ITERATIONS_PER_TURN = Number(process.env.MAX_ITERATIONS_PER_TURN || 25);
const MAX_TOKENS_PER_SESSION = Number(process.env.MAX_TOKENS_PER_SESSION || 120000);

interface RegisteredTool {
  fullName: string;
  description: string;
  argsSchema: Record<string, z.ZodTypeAny>;
  execute: (
    args: Record<string, unknown>,
    ctx: { directory: string; sessionId: string }
  ) => Promise<string>;
  llmSchema: EsquemaHerramientaLLM;
}

function cargarHerramientasContratos(): Map<string, RegisteredTool> {
  const map = new Map<string, RegisteredTool>();

  for (const [exportName, toolObj] of Object.entries(contratosTools)) {
    if (
      toolObj &&
      typeof toolObj === "object" &&
      "description" in toolObj &&
      "args" in toolObj &&
      "execute" in toolObj
    ) {
      const fullName = `contratos_${exportName}`;
      const argsSchema = toolObj.args as Record<string, z.ZodTypeAny>;
      const description = String(toolObj.description);
      const execute = toolObj.execute as RegisteredTool["execute"];

      map.set(fullName, {
        fullName,
        description,
        argsSchema,
        execute,
        llmSchema: {
          name: fullName,
          description,
          parameters: convertirZodAJsonSchema(argsSchema),
        },
      });
    }
  }
  return map;
}

const REGISTRO_HERRAMIENTAS = cargarHerramientasContratos();

function cargarSystemPromptCompleto(directory: string): string {
  const promptPath = path.join(directory, "agent", "prompt.md");
  const knowledgePath = path.join(directory, "src", "knowledge", "registro-contratos.md");

  const promptContent = fs.existsSync(promptPath)
    ? fs.readFileSync(promptPath, "utf-8")
    : "Eres el agente de registro de contratos vigentes de Periferia IT Group.";
  const knowledgeContent = fs.existsSync(knowledgePath)
    ? fs.readFileSync(knowledgePath, "utf-8")
    : "";

  return `${promptContent}\n\n---\n\n${knowledgeContent}`;
}

// ============================================================================
// GESTIÓN DE SESIONES Y CICLO DEL AGENTE (CA1 – CA5)
// ============================================================================

export interface RegistroToolCallTurno {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  summary: string;
}

export interface EstadoSesion {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: MensajeAgente[];
  toolCallHistory: RegistroToolCallTurno[];
  totalTokensUsed: number;
  needsConfirmation: boolean;
}

const SESIONES = new Map<string, EstadoSesion>();

function obtenerOCrearSesion(sessionId: string, directory: string): EstadoSesion {
  const existente = SESIONES.get(sessionId);
  if (existente) return existente;

  const nueva: EstadoSesion = {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      {
        role: "system",
        content: cargarSystemPromptCompleto(directory),
      },
    ],
    toolCallHistory: [],
    totalTokensUsed: 0,
    needsConfirmation: false,
  };
  SESIONES.set(sessionId, nueva);
  return nueva;
}

function resumirResultadoHerramienta(toolName: string, parsed: Record<string, unknown>): string {
  if (!parsed.ok) {
    return `Error/Retenido: ${String(parsed.error ?? "Operación detenida")}`;
  }
  const data = parsed.data as Record<string, unknown> | undefined;
  if (!data) return "Ejecutado correctamente";

  if (toolName === "contratos_leer_buzon") {
    const msgs = Array.isArray(data.mensajes) ? data.mensajes.length : 0;
    return `${msgs} mensajes pendientes en buzón`;
  }
  if (toolName === "contratos_extraer") {
    if (data.tiene_contrato === false) {
      return `Sin contrato (${String(data.adjunto_origen ?? "adjunto")})`;
    }
    return `${String(data.id_contrato ?? "ID")} · ${String(data.cliente ?? "")}`;
  }
  if (toolName === "contratos_validar") {
    const rev = Array.isArray(data.requiere_revision) ? data.requiere_revision : [];
    return `Clasificación: ${String(data.clasificacion)} | Revisión: [${rev.join(", ")}]`;
  }
  if (toolName === "contratos_registrar") {
    return `${String(data.accion).toUpperCase()}: ${String(data.id_contrato)} → ${String(data.ruta_archivo)}`;
  }
  if (toolName === "contratos_alertas") {
    const vencen = Array.isArray(data.vencen) ? data.vencen.length : 0;
    const polizas = Array.isArray(data.polizas_pendientes) ? data.polizas_pendientes.length : 0;
    return `Alertas generadas (${vencen} por vencer, ${polizas} pólizas pendientes)`;
  }
  return "OK";
}

export async function ejecutarTurnoAgente(
  sessionId: string,
  userMessage: string,
  directory = PROJECT_ROOT,
  llmOverride?: RuntimeLLMConfig
): Promise<{
  ok: boolean;
  reply: string;
  toolCalls: RegistroToolCallTurno[];
  needsConfirmation: boolean;
  iterations: number;
  usage: { turnTokens: number; sessionTokens: number };
  provider: string;
  model: string;
  error?: string;
}> {
  asegurarEntornoSalida(directory);
  const sesion = obtenerOCrearSesion(sessionId, directory);

  // Verificar tope de tokens por sesión (Sección 8: Control de Costos)
  if (sesion.totalTokensUsed >= MAX_TOKENS_PER_SESSION) {
    return {
      ok: false,
      reply: `Se alcanzó el límite máximo de tokens configurado para esta sesión (${MAX_TOKENS_PER_SESSION} tokens). Inicia una nueva sesión o reinicia la demo para continuar.`,
      toolCalls: [],
      needsConfirmation: false,
      iterations: 0,
      usage: { turnTokens: 0, sessionTokens: sesion.totalTokensUsed },
      provider: "limit-guard",
      model: "none",
      error: "Límite de tokens por sesión alcanzado.",
    };
  }

  sesion.messages.push({
    role: "user",
    content: userMessage,
  });
  sesion.updatedAt = new Date().toISOString();

  let adaptador = crearAdaptadorLLM(llmOverride);
  const esquemasHerramientas = Array.from(REGISTRO_HERRAMIENTAS.values()).map(
    (t) => t.llmSchema
  );

  const toolCallsTurno: RegistroToolCallTurno[] = [];
  let iteraciones = 0;
  let tokensTurno = 0;
  let respuestaFinal = "";
  let huboRevisionPendiente = false;
  let seConfirmoEnTurno = false;
  let avisoFallbackProveedor = "";

  while (iteraciones < MAX_ITERATIONS_PER_TURN) {
    iteraciones++;

    let respuestaLLM;
    try {
      respuestaLLM = await adaptador.enviar(sesion.messages, esquemasHerramientas);
    } catch (err) {
      const msgError = err instanceof Error ? err.message : String(err);
      // CA5: Si falla el proveedor externo (ej. clave inválida o timeout), informar claramente y usar el motor ReAct determinista local para que la sesión no muera
      if (!(adaptador instanceof DeterministicReActAdapter)) {
        avisoFallbackProveedor = `> ⚠️ **Aviso del Proveedor LLM (${adaptador.providerName} · ${adaptador.modelName})**: ${msgError}\n> _Para garantizar la continuidad de la sesión (Regla CA5), el turno fue completado por el motor ReAct local._\n\n`;
        adaptador = new DeterministicReActAdapter();
        respuestaLLM = await adaptador.enviar(sesion.messages, esquemasHerramientas);
      } else {
        return {
          ok: false,
          reply: `Error al invocar el proveedor de lenguaje: ${msgError}`,
          toolCalls: toolCallsTurno,
          needsConfirmation: false,
          iterations: iteraciones,
          usage: { turnTokens: tokensTurno, sessionTokens: sesion.totalTokensUsed },
          provider: adaptador.providerName,
          model: adaptador.modelName,
          error: msgError,
        };
      }
    }

    tokensTurno += respuestaLLM.usage.totalTokens;
    sesion.totalTokensUsed += respuestaLLM.usage.totalTokens;

    // Si el modelo no solicita más herramientas, hemos llegado a la respuesta final del turno
    if (!respuestaLLM.toolCalls || respuestaLLM.toolCalls.length === 0) {
      respuestaFinal = avisoFallbackProveedor + respuestaLLM.content;
      sesion.messages.push({
        role: "assistant",
        content: respuestaFinal,
        ...(respuestaLLM.rawModelParts ? { rawModelParts: respuestaLLM.rawModelParts } : {}),
      });
      break;
    }

    // Registrar mensaje del asistente con las llamadas a herramientas solicitadas
    sesion.messages.push({
      role: "assistant",
      content: respuestaLLM.content || "",
      toolCalls: respuestaLLM.toolCalls,
      ...(respuestaLLM.rawModelParts ? { rawModelParts: respuestaLLM.rawModelParts } : {}),
    });

    // Ejecutar cada herramienta validando sus argumentos con Zod antes de ejecutar (Sección 6.2)
    for (const tc of respuestaLLM.toolCalls) {
      const toolDef = REGISTRO_HERRAMIENTAS.get(tc.name);
      let rawOutput: string;

      if (!toolDef) {
        rawOutput = JSON.stringify({
          ok: false,
          error: `La herramienta '${tc.name}' no existe. Herramientas válidas: ${Array.from(
            REGISTRO_HERRAMIENTAS.keys()
          ).join(", ")}`,
        });
      } else {
        const zodObj = z.object(toolDef.argsSchema);
        const validacionArgs = zodObj.safeParse(tc.arguments ?? {});
        if (!validacionArgs.success) {
          rawOutput = JSON.stringify({
            ok: false,
            error: `Argumentos inválidos para ${tc.name}: ${validacionArgs.error.message}`,
          });
        } else {
          rawOutput = await toolDef.execute(
            validacionArgs.data as Record<string, unknown>,
            { directory, sessionId }
          );
        }
      }

      let parsedResult: Record<string, unknown> = { ok: false, error: rawOutput };
      try {
        parsedResult = JSON.parse(rawOutput) as Record<string, unknown>;
      } catch {
        // conservar objeto por defecto
      }

      // Detectar si una validación reportó campos en requiere_revision (RN5 / CA3)
      if (tc.name === "contratos_validar" && parsedResult.ok && parsedResult.data) {
        const valData = parsedResult.data as { requiere_revision?: string[] };
        if (Array.isArray(valData.requiere_revision) && valData.requiere_revision.length > 0) {
          huboRevisionPendiente = true;
        }
      }
      if (
        tc.name === "contratos_registrar" &&
        parsedResult.ok &&
        tc.arguments?.confirmado === true
      ) {
        seConfirmoEnTurno = true;
      }

      const registroTc: RegistroToolCallTurno = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        result: parsedResult,
        ok: Boolean(parsedResult.ok),
        summary: resumirResultadoHerramienta(tc.name, parsedResult),
      };

      toolCallsTurno.push(registroTc);
      sesion.toolCallHistory.push(registroTc);

      sesion.messages.push({
        role: "tool",
        toolCallId: tc.id,
        toolName: tc.name,
        content: rawOutput,
      });
    }
  }

  // CA1: Si se alcanzó el tope de iteraciones sin respuesta final de texto, devolver lo procesado hasta el momento
  if (!respuestaFinal && iteraciones >= MAX_ITERATIONS_PER_TURN) {
    respuestaFinal = `Se alcanzó el tope máximo de ${MAX_ITERATIONS_PER_TURN} iteraciones por turno (Regla CA1). Se ejecutaron ${toolCallsTurno.length} llamadas a herramientas. Por favor envía un mensaje de continuación para completar las operaciones restantes.`;
    sesion.messages.push({
      role: "assistant",
      content: respuestaFinal,
    });
  }

  const needsConfirmation =
    !seConfirmoEnTurno &&
    (huboRevisionPendiente ||
      /confirmas\s+el\s+registro|requiere\s+confirmaci[oó]n/i.test(respuestaFinal));

  sesion.needsConfirmation = needsConfirmation;
  sesion.updatedAt = new Date().toISOString();

  return {
    ok: true,
    reply: respuestaFinal,
    toolCalls: toolCallsTurno,
    needsConfirmation,
    iterations: iteraciones,
    usage: {
      turnTokens: tokensTurno,
      sessionTokens: sesion.totalTokensUsed,
    },
    provider: adaptador.providerName,
    model: adaptador.modelName,
  };
}

// ============================================================================
// ESTADO EN VIVO PARA EL INSPECTOR DEL FRONTEND
// ============================================================================

function obtenerEstadoInspeccion(directory: string) {
  asegurarEntornoSalida(directory);
  const rutas = getRutasProyecto(directory);
  const maestro = leerMaestroContratos(directory);
  const procesados = leerProcesados(directory);

  const buzonTodos: CorreoRaw[] = [];
  if (fs.existsSync(rutas.buzonDir)) {
    const dirs = fs
      .readdirSync(rutas.buzonDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const d of dirs) {
      const p = path.join(rutas.buzonDir, d, "correo.json");
      if (fs.existsSync(p)) {
        buzonTodos.push(JSON.parse(fs.readFileSync(p, "utf-8")) as CorreoRaw);
      }
    }
  }

  const alertasMarkdown = fs.existsSync(rutas.alertasPath)
    ? fs.readFileSync(rutas.alertasPath, "utf-8")
    : "";

  const historial: EntradaHistorial[] = [];
  if (fs.existsSync(rutas.historialPath)) {
    for (const line of fs.readFileSync(rutas.historialPath, "utf-8").split(/\r?\n/)) {
      if (line.trim()) {
        try {
          historial.push(JSON.parse(line) as EntradaHistorial);
        } catch {
          // ignore
        }
      }
    }
  }

  const logs: EntradaLog[] = [];
  if (fs.existsSync(rutas.logPath)) {
    for (const line of fs.readFileSync(rutas.logPath, "utf-8").split(/\r?\n/)) {
      if (line.trim()) {
        try {
          logs.push(JSON.parse(line) as EntradaLog);
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    ok: true,
    maestro,
    procesados,
    buzonTodos,
    alertasMarkdown,
    historial,
    logs,
  };
}

// ============================================================================
// HANDLER WEB STANDARD (Request -> Response) Y SERVIDOR HTTP
// ============================================================================

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function handleRequest(
  req: Request,
  directory = PROJECT_ROOT
): Promise<Response> {
  try {
    const method = req.method || "GET";
    const parsedUrl = new URL(req.url);
    const pathname = parsedUrl.pathname;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 1. GET /api/health (Sección 6.4: sin exponer claves)
    if (method === "GET" && pathname === "/api/health") {
      const adaptador = crearAdaptadorLLM();
      return jsonResponse({
        ok: true,
        provider: adaptador.providerName,
        model: adaptador.modelName,
        hasCustomKey: tieneApiKeyPersonalizada(),
        maxIterationsPerTurn: MAX_ITERATIONS_PER_TURN,
        maxTokensPerSession: MAX_TOKENS_PER_SESSION,
        toolsRegistered: Array.from(REGISTRO_HERRAMIENTAS.keys()),
      });
    }

    // 1b. POST /api/llm-config (Configurar proveedor, modelo y API Key en memoria del servidor sin exponer la clave)
    if (method === "POST" && pathname === "/api/llm-config") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const providerRaw = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "auto";
      const validProviders = ["auto", "gemini", "openai", "anthropic", "local"] as const;
      const provider = (validProviders.includes(providerRaw as typeof validProviders[number])
        ? providerRaw
        : "auto") as RuntimeLLMConfig["provider"];
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      const model = typeof body.model === "string" ? body.model.trim() : "";

      const status = configurarLLMRuntime({ provider, apiKey, model });
      return jsonResponse({
        ok: true,
        provider: status.provider,
        model: status.model,
        hasCustomKey: status.hasCustomKey,
      });
    }

    // 2. GET /api/sessions/:id (Sección 6.4: historial completo de la sesión)
    if (method === "GET" && pathname.startsWith("/api/sessions/")) {
      const sessionId = decodeURIComponent(pathname.replace("/api/sessions/", ""));
      const sesion = SESIONES.get(sessionId);
      if (!sesion) {
        return jsonResponse(
          {
            ok: false,
            error: `La sesión '${sessionId}' no existe o fue reiniciada.`,
          },
          404
        );
      }
      return jsonResponse({
        ok: true,
        session: {
          sessionId: sesion.sessionId,
          createdAt: sesion.createdAt,
          updatedAt: sesion.updatedAt,
          needsConfirmation: sesion.needsConfirmation,
          totalTokensUsed: sesion.totalTokensUsed,
          messages: sesion.messages.filter((m) => m.role !== "system"),
          toolCalls: sesion.toolCallHistory,
        },
      });
    }

    // 3. POST /api/chat (Sección 6.4: ejecuta turno del agente)
    if (method === "POST" && pathname === "/api/chat") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const sessionId =
        typeof body.sessionId === "string" && body.sessionId.trim()
          ? body.sessionId.trim()
          : "default-session";
      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      if (!message) {
        return jsonResponse(
          {
            ok: false,
            error: "El campo 'message' es obligatorio.",
          },
          400
        );
      }

      const llmOverride =
        body.llmConfig && typeof body.llmConfig === "object"
          ? (body.llmConfig as RuntimeLLMConfig)
          : undefined;

      const resultado = await ejecutarTurnoAgente(
        sessionId,
        message,
        directory,
        llmOverride
      );
      return jsonResponse(resultado, 200);
    }

    // 4. GET /api/state (Estado en tiempo real para el panel derecho del front)
    if (method === "GET" && pathname === "/api/state") {
      return jsonResponse(obtenerEstadoInspeccion(directory));
    }

    // 5. POST /api/reset (Reinicia out/ y las sesiones en memoria para repetir la demo)
    if (method === "POST" && pathname === "/api/reset") {
      const { outDir } = getRutasProyecto(directory);
      if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
      SESIONES.clear();
      asegurarEntornoSalida(directory);
      return jsonResponse({
        ok: true,
        message: "Directorio out/ y sesiones reiniciados al corte del 2026-05-30.",
      });
    }

    // 6. Servir interfaz de chat (GET / o GET /index.html)
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const htmlPath = path.join(directory, "src", "app", "index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return jsonResponse({ ok: false, error: `Ruta no encontrada: ${pathname}` }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: `Error interno del servidor: ${msg}` }, 500);
  }
}

export function crearServidorHttp(directory = PROJECT_ROOT): http.Server {
  return http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      const url = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
      const method = req.method || "GET";
      const webReq = new Request(url, {
        method,
        headers: req.headers as Record<string, string>,
        body: method !== "GET" && method !== "HEAD" && rawBody.length > 0 ? rawBody : undefined,
      });
      const webRes = await handleRequest(webReq, directory);
      const resHeaders: Record<string, string> = {};
      webRes.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      res.writeHead(webRes.status, resHeaders);
      const text = await webRes.text();
      res.end(text);
    });
  });
}

// Iniciar servidor solo si es ejecutado directamente (`bun run dev` / `bun run src/server.ts`)
if (import.meta.main) {
  asegurarEntornoSalida(PROJECT_ROOT);
  const server = crearServidorHttp(PROJECT_ROOT);
  server.listen(PORT, () => {
    const adaptador = crearAdaptadorLLM();
    console.log("================================================================================");
    console.log("  PERXIA 2.0 · SERVIDOR AGENTE DE CONTRATOS VIGENTES (Reto 02)");
    console.log("================================================================================");
    console.log(`  URL Interfaz Web : http://localhost:${PORT}`);
    console.log(`  API Health Check : http://localhost:${PORT}/api/health`);
    console.log(`  Proveedor activo : ${adaptador.providerName} (${adaptador.modelName})`);
    console.log(`  Herramientas     : ${Array.from(REGISTRO_HERRAMIENTAS.keys()).join(", ")}`);
    console.log("================================================================================");
  });
}
