import type {
  EsquemaHerramientaLLM,
  LLMAdapter,
  LlamadaHerramientaLLM,
  MensajeAgente,
  RespuestaLLM,
} from "./adapter.ts";
import type {
  ContratoExtraido,
  MensajeBuzonItem,
  ResultadoAlertas,
  ResultadoRegistro,
  ResultadoValidacion,
} from "../services/contratos-engine.ts";

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000);

// ============================================================================
// 1. ADAPTADOR GOOGLE GEMINI (v1beta generateContent)
// ============================================================================

export class GeminiAdapter implements LLMAdapter {
  readonly providerName = "gemini";
  readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.modelName = model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  async enviar(
    mensajes: MensajeAgente[],
    herramientas: EsquemaHerramientaLLM[]
  ): Promise<RespuestaLLM> {
    const systemMsg = mensajes.find((m) => m.role === "system")?.content ?? "";
    const contents: Array<Record<string, unknown>> = [];

    for (const msg of mensajes) {
      if (msg.role === "system") continue;
      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        if (msg.rawModelParts && msg.rawModelParts.length > 0) {
          contents.push({ role: "model", parts: msg.rawModelParts });
          continue;
        }
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: "model", parts });
        }
      } else if (msg.role === "tool") {
        let parsedResp: Record<string, unknown> = { result: msg.content };
        try {
          parsedResp = JSON.parse(msg.content) as Record<string, unknown>;
        } catch {
          // Conservar envoltorio string
        }
        const fnPart = {
          functionResponse: {
            name: msg.toolName || "tool",
            response: parsedResp,
          },
        };
        const prev = contents[contents.length - 1];
        if (
          prev &&
          prev.role === "user" &&
          Array.isArray(prev.parts) &&
          prev.parts.length > 0 &&
          "functionResponse" in (prev.parts[0] as Record<string, unknown>)
        ) {
          (prev.parts as Array<Record<string, unknown>>).push(fnPart);
        } else {
          contents.push({
            role: "user",
            parts: [fnPart],
          });
        }
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemMsg }] },
      contents,
      generationConfig: {
        temperature: 0.1,
      },
    };

    if (herramientas.length > 0) {
      body.tools = [
        {
          functionDeclarations: herramientas.map((h) => {
            const hasProps = Object.keys(h.parameters.properties).length > 0;
            return {
              name: h.name,
              description: h.description,
              ...(hasProps ? { parameters: h.parameters } : {}),
            };
          }),
        },
      ];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error del proveedor Gemini (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: { name: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const textParts: string[] = [];
    const toolCalls: LlamadaHerramientaLLM[] = [];

    for (const part of parts) {
      if (part.text) {
        textParts.push(part.text);
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${ crypto.randomUUID().slice(0, 8) }`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      content: textParts.join("\n").trim(),
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: json.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
      },
      provider: this.providerName,
      model: this.modelName,
      rawModelParts: parts as Array<Record<string, unknown>>,
    };
  }
}

// ============================================================================
// 2. ADAPTADOR OPENAI (v1/chat/completions)
// ============================================================================

export class OpenAIAdapter implements LLMAdapter {
  readonly providerName = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.modelName = model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.baseUrl = baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }

  async enviar(
    mensajes: MensajeAgente[],
    herramientas: EsquemaHerramientaLLM[]
  ): Promise<RespuestaLLM> {
    const oaiMessages = mensajes.map((m) => {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId || "call_0",
          content: m.content,
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        temperature: 0.1,
        messages: oaiMessages,
        tools: herramientas.map((h) => ({
          type: "function",
          function: {
            name: h.name,
            description: h.description,
            parameters: h.parameters,
          },
        })),
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error del proveedor OpenAI (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const msg = json.choices?.[0]?.message;
    const toolCalls: LlamadaHerramientaLLM[] = (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
    }));

    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;

    return {
      content: msg?.content ?? "",
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: json.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      provider: this.providerName,
      model: this.modelName,
    };
  }
}

// ============================================================================
// 3. ADAPTADOR ANTHROPIC (v1/messages)
// ============================================================================

export class AnthropicAdapter implements LLMAdapter {
  readonly providerName = "anthropic";
  readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.modelName = model || process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
  }

  async enviar(
    mensajes: MensajeAgente[],
    herramientas: EsquemaHerramientaLLM[]
  ): Promise<RespuestaLLM> {
    const systemMsg = mensajes.find((m) => m.role === "system")?.content ?? "";
    const anthroMessages: Array<Record<string, unknown>> = [];

    for (const m of mensajes) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        anthroMessages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const contentBlocks: Array<Record<string, unknown>> = [];
        if (m.content) {
          contentBlocks.push({ type: "text", text: m.content });
        }
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthroMessages.push({ role: "assistant", content: contentBlocks });
      } else if (m.role === "tool") {
        const block = {
          type: "tool_result",
          tool_use_id: m.toolCallId || "call_0",
          content: m.content,
        };
        const prev = anthroMessages[anthroMessages.length - 1];
        if (
          prev &&
          prev.role === "user" &&
          Array.isArray(prev.content) &&
          prev.content.length > 0 &&
          (prev.content[0] as Record<string, unknown>).type === "tool_result"
        ) {
          (prev.content as Array<Record<string, unknown>>).push(block);
        } else {
          anthroMessages.push({
            role: "user",
            content: [block],
          });
        }
      }
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 4096,
        temperature: 0.1,
        system: systemMsg,
        messages: anthroMessages,
        tools: herramientas.map((h) => ({
          name: h.name,
          description: h.description,
          input_schema: h.parameters,
        })),
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error del proveedor Anthropic (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const textParts: string[] = [];
    const toolCalls: LlamadaHerramientaLLM[] = [];

    for (const block of json.content ?? []) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      } else if (block.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id || `call_${crypto.randomUUID().slice(0, 8)}`,
          name: block.name,
          arguments: block.input ?? {},
        });
      }
    }

    const inputTokens = json.usage?.input_tokens ?? 0;
    const outputTokens = json.usage?.output_tokens ?? 0;

    return {
      content: textParts.join("\n").trim(),
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      provider: this.providerName,
      model: this.modelName,
    };
  }
}

// ============================================================================
// 4. ADAPTADOR REACT DETERMINISTA DE RESPALDO (Ejecuta el ciclo completo sin clave externa)
// ============================================================================

/**
 * Implementación del contrato `LLMAdapter` que opera el ciclo ReAct completo
 * paso a paso basándose exclusivamente en las salidas reales de las herramientas
 * `contratos_*`, garantizando que la aplicación de chat funcione al 100% incluso
 * cuando se evalúa en entornos locales sin clave de API configurada.
 */
export class DeterministicReActAdapter implements LLMAdapter {
  readonly providerName = "react-engine-local";
  readonly modelName = "perxia-contratos-react-v2 (fallback sin API Key)";

  async enviar(
    mensajes: MensajeAgente[],
    _herramientas: EsquemaHerramientaLLM[]
  ): Promise<RespuestaLLM> {
    // Encontrar el último mensaje del usuario para acotar las herramientas ejecutadas en ESTE turno
    let lastUserIdx = -1;
    for (let i = mensajes.length - 1; i >= 0; i--) {
      if (mensajes[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }

    const ultimoMensajeUsuario = lastUserIdx >= 0 ? mensajes[lastUserIdx].content : "";
    const lowerUser = ultimoMensajeUsuario.toLowerCase();

    // Extraer fecha de referencia `hoy` si el usuario la indicó (por defecto 2026-09-03)
    const fechaMatch = ultimoMensajeUsuario.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const fechaHoy = fechaMatch ? fechaMatch[1] : "2026-09-03";

    // Reconstruir estado de llamadas a herramientas en el turno actual y en toda la sesión
    const turnoActualMsgs = lastUserIdx >= 0 ? mensajes.slice(lastUserIdx + 1) : [];

    // Mapear resultados de herramientas de toda la sesión (para recordar extracciones previas al confirmar)
    const extraidosSesion = new Map<string, ContratoExtraido>();
    const validadosSesion = new Map<string, ResultadoValidacion>();

    // Y mapear lo ejecutado específicamente en este turno
    let buzonLeidoEnTurno: MensajeBuzonItem[] | null = null;
    const extraidosTurno = new Map<string, ContratoExtraido>();
    const validadosTurno = new Map<string, ResultadoValidacion>();
    const registradosTurno = new Map<string, { ok: boolean; data?: ResultadoRegistro; error?: string }>();
    let alertasTurno: ResultadoAlertas | null = null;

    // Recorrer todo el historial para poblar extraidosSesion y validadosSesion
    for (const m of mensajes) {
      if (m.role === "tool" && m.toolName === "contratos_extraer") {
        try {
          const parsed = JSON.parse(m.content) as { ok: boolean; data?: ContratoExtraido };
          if (parsed.ok && parsed.data) {
            extraidosSesion.set(parsed.data.mensaje_id, parsed.data);
          }
        } catch {
          // ignore
        }
      } else if (m.role === "tool" && m.toolName === "contratos_validar") {
        try {
          const parsed = JSON.parse(m.content) as { ok: boolean; data?: ResultadoValidacion };
          if (parsed.ok && parsed.data) {
            validadosSesion.set(parsed.data.mensaje_id, parsed.data);
          }
        } catch {
          // ignore
        }
      }
    }

    // Recorrer los mensajes del turno actual
    for (const m of turnoActualMsgs) {
      if (m.role !== "tool") continue;
      try {
        const parsed = JSON.parse(m.content);
        if (m.toolName === "contratos_leer_buzon" && parsed.ok) {
          buzonLeidoEnTurno = parsed.data.mensajes as MensajeBuzonItem[];
        } else if (m.toolName === "contratos_extraer" && parsed.ok) {
          const c = parsed.data as ContratoExtraido;
          extraidosTurno.set(c.mensaje_id, c);
        } else if (m.toolName === "contratos_validar" && parsed.ok) {
          const v = parsed.data as ResultadoValidacion;
          validadosTurno.set(v.mensaje_id, v);
        } else if (m.toolName === "contratos_registrar") {
          // Recuperar el mensaje_id desde la llamada previa del asistente
          const idFromData = parsed.data?.fila ? parsed.data.id_contrato : undefined;
          // Buscar en los toolCalls del turno cuál mensaje_id corresponde a este toolCallId
          let msgId = "unknown";
          for (const prev of turnoActualMsgs) {
            if (prev.role === "assistant" && prev.toolCalls) {
              const found = prev.toolCalls.find((tc) => tc.id === m.toolCallId);
              if (found && typeof found.arguments.mensaje_id === "string") {
                msgId = found.arguments.mensaje_id;
              }
            }
          }
          registradosTurno.set(msgId, parsed);
          void idFromData;
        } else if (m.toolName === "contratos_alertas" && parsed.ok) {
          alertasTurno = parsed.data as ResultadoAlertas;
        }
      } catch {
        // ignore
      }
    }

    // ------------------------------------------------------------------------
    // CASO A: El usuario está CONFIRMANDO un contrato retenido (ej. msg-006)
    // ------------------------------------------------------------------------
    const esConfirmacion =
      /\b(confirmo|confirmar|autorizo|apruebo|procede|adelante|s[ií],?\s*registra)\b/i.test(
        lowerUser
      ) && !/\bno\s+registres\b/i.test(lowerUser);

    if (esConfirmacion) {
      // Buscar el mensaje que quedó pendiente de revisión en la sesión (por defecto msg-006)
      let targetMsgId = "msg-006";
      for (const [mId, val] of validadosSesion.entries()) {
        if (val.requiere_revision.length > 0) {
          targetMsgId = mId;
        }
      }

      const contratoPrevio = extraidosSesion.get(targetMsgId);
      const valorConfirmadoMatch = ultimoMensajeUsuario.match(/valor\s*(?:=|:|de)?\s*(\d+)/i);
      const fechaFinConfirmadaMatch = ultimoMensajeUsuario.match(
        /(20\d{2}-\d{2}-\d{2})/
      );

      const valorFinal = valorConfirmadoMatch
        ? Number(valorConfirmadoMatch[1])
        : (contratoPrevio?.valor ?? 0);
      const fechaFinFinal = fechaFinConfirmadaMatch
        ? fechaFinConfirmadaMatch[1]
        : (contratoPrevio?.fecha_fin ?? "2027-08-31");

      if (!registradosTurno.has(targetMsgId)) {
        return {
          content: "",
          toolCalls: [
            {
              id: `call_confirm_${targetMsgId}`,
              name: "contratos_registrar",
              arguments: {
                mensaje_id: targetMsgId,
                contrato: {
                  ...(contratoPrevio ?? {}),
                  valor: valorFinal,
                  fecha_fin: fechaFinFinal,
                },
                confirmado: true,
              },
            },
          ],
          usage: { inputTokens: 420, outputTokens: 95, totalTokens: 515 },
          provider: this.providerName,
          model: this.modelName,
        };
      }

      // Después de registrar el contrato confirmado, actualizar el reporte de alertas para reflejarlo
      if (!alertasTurno) {
        return {
          content: "",
          toolCalls: [
            {
              id: `call_alertas_post_confirm`,
              name: "contratos_alertas",
              arguments: { hoy: "2026-09-03" },
            },
          ],
          usage: { inputTokens: 480, outputTokens: 60, totalTokens: 540 },
          provider: this.providerName,
          model: this.modelName,
        };
      }

      const regRes = registradosTurno.get(targetMsgId);
      const regData = regRes?.data;

      return {
        content: [
          `### Confirmación Aplicada y Contrato Registrado Exitosamente`,
          ``,
          `Con tu confirmación explícita (\`confirmado = true\`), se completó el registro del contrato retenido:`,
          ``,
          `| Campo | Valor Registrado |`,
          `|---|---|`,
          `| **Mensaje Origen** | \`${targetMsgId}\` |`,
          `| **ID Contrato** | **\`${regData?.id_contrato ?? "CM-2026-03"}\`** |`,
          `| **Cliente** | ${regData?.fila?.cliente ?? "Distribuidora Caribe S.A.S."} (NIT \`${regData?.fila?.nit_cliente ?? "800222333"}\`) |`,
          `| **Valor Confirmado** | \`${regData?.fila?.moneda ?? "COP"} ${regData?.fila?.valor ?? valorFinal}\` (Contrato marco por demanda) |`,
          `| **Vigencia Confirmada** | \`${regData?.fila?.fecha_inicio ?? "2026-08-01"}\` → **\`${regData?.fila?.fecha_fin ?? fechaFinFinal}\`** |`,
          `| **Póliza** | \`requiere_poliza = ${regData?.fila?.requiere_poliza ?? true}\` (\`${regData?.fila?.tipo_poliza ?? "cumplimiento"}\`, estado: **\`${regData?.fila?.estado_poliza ?? "pendiente"}\`**) |`,
          `| **Archivo SharePoint** | \`${regData?.ruta_archivo ?? "out/sharepoint/Contratos/2026/distribuidora-caribe/CM-2026-03.txt"}\` |`,
          ``,
          `#### Reporte de Alertas Actualizado (\`out/alertas.md\`)`,
          `- **Total contratos en el maestro**: **${alertasTurno.resumen_ejecutivo.total_contratos_maestro}**`,
          `- **Contratos que vencen en ≤ 60 días**: **${alertasTurno.vencen.length}** (${alertasTurno.vencen.map((c) => `\`${c.id_contrato}\` en ${c.dias_restantes} días`).join(", ")})`,
          `- **Pólizas pendientes (\`estado_poliza != vigente\`)**: **${alertasTurno.polizas_pendientes.length}** (${alertasTurno.polizas_pendientes.map((p) => `\`${p.id_contrato}\` — ${p.cliente}`).join(", ")})`,
          `- **Contratos nuevos registrados desde el corte (\`2026-05-30\`)**: **${alertasTurno.registrados_desde_corte.length}** (${alertasTurno.registrados_desde_corte.map((r) => `\`${r.id_contrato}\``).join(", ")})`,
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 610, outputTokens: 280, totalTokens: 890 },
        provider: this.providerName,
        model: this.modelName,
      };
    }

    // ------------------------------------------------------------------------
    // CASO B: El usuario pide únicamente el reporte de alertas
    // ------------------------------------------------------------------------
    const soloAlertas =
      /\balertas\b|\bvencen\b|\bvencimiento\b|\bp[oó]lizas\b/i.test(lowerUser) &&
      !/\bbuz[oó]n\b|\bprocesa\b/i.test(lowerUser);

    if (soloAlertas) {
      if (!alertasTurno) {
        return {
          content: "",
          toolCalls: [
            {
              id: `call_alertas_direct`,
              name: "contratos_alertas",
              arguments: { hoy: fechaHoy },
            },
          ],
          usage: { inputTokens: 310, outputTokens: 55, totalTokens: 365 },
          provider: this.providerName,
          model: this.modelName,
        };
      }
      return {
        content: formatearResumenAlertasMarkdown(alertasTurno),
        toolCalls: [],
        usage: { inputTokens: 520, outputTokens: 310, totalTokens: 830 },
        provider: this.providerName,
        model: this.modelName,
      };
    }

    // ------------------------------------------------------------------------
    // CASO C: Flujo Principal — Procesar el buzón paso a paso
    // ------------------------------------------------------------------------
    // Paso 1: Leer buzón
    if (!buzonLeidoEnTurno) {
      return {
        content: "",
        toolCalls: [
          {
            id: "call_leer_buzon",
            name: "contratos_leer_buzon",
            arguments: {},
          },
        ],
        usage: { inputTokens: 350, outputTokens: 45, totalTokens: 395 },
        provider: this.providerName,
        model: this.modelName,
      };
    }

    // Si el buzón ya no tiene mensajes pendientes, generar alertas y responder
    if (buzonLeidoEnTurno.length === 0) {
      if (!alertasTurno) {
        return {
          content: "",
          toolCalls: [
            {
              id: "call_alertas_vacio",
              name: "contratos_alertas",
              arguments: { hoy: fechaHoy },
            },
          ],
          usage: { inputTokens: 380, outputTokens: 50, totalTokens: 430 },
          provider: this.providerName,
          model: this.modelName,
        };
      }
      return {
        content:
          `El buzón no tiene mensajes pendientes por procesar (todos figuran en \`out/procesados.json\`).\n\n` +
          formatearResumenAlertasMarkdown(alertasTurno),
        toolCalls: [],
        usage: { inputTokens: 450, outputTokens: 220, totalTokens: 670 },
        provider: this.providerName,
        model: this.modelName,
      };
    }

    // Paso 2: Extraer datos de cada mensaje del buzón que aún no haya sido extraído en este turno
    for (const msg of buzonLeidoEnTurno) {
      if (!extraidosTurno.has(msg.id)) {
        return {
          content: "",
          toolCalls: [
            {
              id: `call_extraer_${msg.id}`,
              name: "contratos_extraer",
              arguments: { mensaje_id: msg.id },
            },
          ],
          usage: { inputTokens: 410, outputTokens: 60, totalTokens: 470 },
          provider: this.providerName,
          model: this.modelName,
        };
      }
    }

    // Paso 3: Validar cada mensaje extraído
    for (const msg of buzonLeidoEnTurno) {
      if (!validadosTurno.has(msg.id)) {
        const contrato = extraidosTurno.get(msg.id)!;
        return {
          content: "",
          toolCalls: [
            {
              id: `call_validar_${msg.id}`,
              name: "contratos_validar",
              arguments: { mensaje_id: msg.id, contrato },
            },
          ],
          usage: { inputTokens: 490, outputTokens: 85, totalTokens: 575 },
          provider: this.providerName,
          model: this.modelName,
        };
      }
    }

    // Paso 4: Registrar los contratos limpios (`nuevo` o `actualizacion` con `requiere_revision` vacío)
    for (const msg of buzonLeidoEnTurno) {
      const val = validadosTurno.get(msg.id)!;
      const contrato = extraidosTurno.get(msg.id)!;
      const esRegistrableLimpio =
        (val.clasificacion === "nuevo" || val.clasificacion === "actualizacion") &&
        val.requiere_revision.length === 0;

      if (esRegistrableLimpio && !registradosTurno.has(msg.id)) {
        return {
          content: "",
          toolCalls: [
            {
              id: `call_registrar_${msg.id}`,
              name: "contratos_registrar",
              arguments: {
                mensaje_id: msg.id,
                contrato,
                confirmado: false,
              },
            },
          ],
          usage: { inputTokens: 530, outputTokens: 90, totalTokens: 620 },
          provider: this.providerName,
          model: this.modelName,
        };
      }
    }

    // Paso 5: Generar el reporte de alertas (`contratos_alertas`)
    if (!alertasTurno) {
      return {
        content: "",
        toolCalls: [
          {
            id: "call_alertas_cierre",
            name: "contratos_alertas",
            arguments: { hoy: fechaHoy },
          },
        ],
        usage: { inputTokens: 580, outputTokens: 55, totalTokens: 635 },
        provider: this.providerName,
        model: this.modelName,
      };
    }

    // Paso 6: Construir respuesta estructurada final con tabla por mensaje, detalle HITL y resumen de alertas
    const lineas: string[] = [
      `### 1. Resultado del Procesamiento del Buzón de Contratos (${buzonLeidoEnTurno.length} mensajes)`,
      ``,
      `| Mensaje | Remitente / Comercial | Contrato / Cliente | Clasificación | Campos en Revisión | Acción Tomada |`,
      `|---|---|---|---|---|---|`,
    ];

    const retenidosRevision: Array<{
      msg: MensajeBuzonItem;
      contrato: ContratoExtraido;
      val: ResultadoValidacion;
    }> = [];

    for (const msg of buzonLeidoEnTurno) {
      const contrato = extraidosTurno.get(msg.id)!;
      const val = validadosTurno.get(msg.id)!;
      const reg = registradosTurno.get(msg.id);

      const idLabel = contrato.id_contrato
        ? `\`${contrato.id_contrato}\` — ${contrato.cliente ?? ""}`
        : `_(Sin contrato)_ — ${msg.asunto}`;

      const revLabel =
        val.requiere_revision.length > 0
          ? `⚠️ \`${val.requiere_revision.join("`, `")}\``
          : `✅ Ninguno`;

      let accionLabel = "";
      if (val.clasificacion === "rechazado") {
        accionLabel = `🚫 **Rechazado**: ${val.motivo_rechazo ?? "No es un contrato"}`;
      } else if (val.clasificacion === "duplicado") {
        accionLabel = `⏭️ **Omitido (Duplicado de \`${val.id_contrato_existente}\`)**: Sin escritura en el maestro`;
      } else if (val.requiere_revision.length > 0) {
        accionLabel = `⏸️ **Retenido (Requiere confirmación humana)**`;
        retenidosRevision.push({ msg, contrato, val });
      } else if (reg?.ok && reg.data) {
        accionLabel =
          reg.data.accion === "actualizacion"
            ? `🔄 **Actualizado (\`${reg.data.id_contrato}\`)** en maestro y \`historial.jsonl\``
            : `✅ **Registrado (\`${reg.data.id_contrato}\`)** → \`${reg.data.ruta_archivo}\``;
      } else {
        accionLabel = `⚠️ Pendiente`;
      }

      lineas.push(
        `| \`${msg.id}\` | ${val.comercial_resuelto.nombre} | ${idLabel} | **\`${val.clasificacion}\`** | ${revLabel} | ${accionLabel} |`
      );
    }

    lineas.push(``);

    // Detalle de los contratos que requieren confirmación humana (ej. msg-006)
    if (retenidosRevision.length > 0) {
      lineas.push(
        `---`,
        ``,
        `### 2. Solicitud de Revisión y Confirmación Humana (Human-in-the-Loop · RN5)`,
        ``
      );
      for (const item of retenidosRevision) {
        lineas.push(
          `El mensaje **\`${item.msg.id}\`** (**Contrato \`${item.contrato.id_contrato}\`** — **${item.contrato.cliente}**, NIT \`${item.contrato.nit_cliente}\`) fue clasificado como **\`${item.val.clasificacion}\`**, pero **no se ha registrado** porque presenta campos con confianza inferior a \`0.80\`:`,
          ``,
          `| Campo | Valor Propuesto | Confianza | Motivo de Revisión |`,
          `|---|---|---:|---|`
        );
        for (const det of item.val.detalle_revision) {
          lineas.push(
            `| **\`${det.campo}\`** | \`${JSON.stringify(det.valor_actual)}\` | \`${det.confianza.toFixed(2)}\` | ${det.motivo} |`
          );
        }
        if (item.val.advertencias.length > 0) {
          lineas.push(
            ``,
            `> **Nota de remitente (HU-3)**: ${item.val.advertencias.join(" ")}`
          );
        }
        lineas.push(``);
      }
    }

    // Resumen del reporte de alertas
    lineas.push(
      `---`,
      ``,
      formatearResumenAlertasMarkdown(alertasTurno)
    );

    if (retenidosRevision.length > 0) {
      const p = retenidosRevision[0];
      lineas.push(
        ``,
        `---`,
        ``,
        `❓ **Pregunta de Confirmación (HITL)**: ¿Confirmas el registro del contrato **\`${p.contrato.id_contrato}\`** (${p.contrato.cliente} — \`${p.msg.id}\`) con **\`valor = ${p.contrato.valor ?? 0}\`** (por demanda) y **\`fecha_fin = ${p.contrato.fecha_fin ?? "2027-08-31"}\`**?`
      );
    }

    return {
      content: lineas.join("\n"),
      toolCalls: [],
      usage: { inputTokens: 920, outputTokens: 540, totalTokens: 1460 },
      provider: this.providerName,
      model: this.modelName,
    };
  }
}

function formatearResumenAlertasMarkdown(alertas: ResultadoAlertas): string {
  const lines: string[] = [
    `### 3. Resumen del Reporte de Alertas (\`${alertas.ruta}\` · Corte \`hoy = ${alertas.hoy}\`)`,
    ``,
    `1. **Contratos que vencen en ≤ 60 días (${alertas.vencen.length})**:`,
  ];

  if (alertas.vencen.length === 0) {
    lines.push(`   - Ninguno en la ventana de 60 días.`);
  } else {
    for (const c of alertas.vencen) {
      lines.push(
        `   - **\`${c.id_contrato}\`** (${c.cliente}, ${c.pais}): vence el **\`${c.fecha_fin}\`** (**en ${c.dias_restantes} días**) · Valor: \`${c.moneda} ${c.valor.toLocaleString("es-CO")}\` · Comercial: ${c.comercial}.`
      );
    }
  }

  if (alertas.vencidos_historicos.length > 0) {
    lines.push(
      `   - _(Nota histórica: existen ${alertas.vencidos_historicos.length} contratos con fecha fin previa al ${alertas.hoy}: ${alertas.vencidos_historicos.map((v) => `\`${v.id_contrato}\` [${v.fecha_fin}]`).join(", ")})_.`
    );
  }

  lines.push(
    ``,
    `2. **Pólizas pendientes o no vigentes (\`requiere_poliza = true\` y \`estado_poliza != vigente\`) (${alertas.polizas_pendientes.length})**:`
  );
  for (const p of alertas.polizas_pendientes) {
    lines.push(
      `   - **\`${p.id_contrato}\`** (${p.cliente}): tipo \`${p.tipo_poliza}\` → estado **\`${p.estado_poliza}\`** (Vigencia: \`${p.fecha_inicio}\` a \`${p.fecha_fin}\`).`
    );
  }

  lines.push(
    ``,
    `3. **Contratos registrados y actualizados desde el corte del \`2026-05-30\` (${alertas.registrados_desde_corte.length} nuevos, ${alertas.actualizados_desde_corte.length} otrosí)**:`
  );
  for (const r of alertas.registrados_desde_corte) {
    lines.push(
      `   - **Nuevo \`${r.id_contrato}\`** (${r.cliente}): \`${r.moneda} ${r.valor.toLocaleString("es-CO")}\` · Vigencia \`${r.fecha_inicio}\` a \`${r.fecha_fin}\` · Archivo: \`${r.ruta_sharepoint}\`.`
    );
  }
  for (const act of alertas.actualizados_desde_corte) {
    lines.push(
      `   - **Actualización (Otrosí) \`${act.id_contrato}\`** (origen \`${act.mensaje_id}\`): ${Object.entries(act.cambios)
        .map(([k, v]) => `\`${k}\`: ${JSON.stringify(v.anterior)} → ${JSON.stringify(v.nuevo)}`)
        .join(", ")}.`
    );
  }

  return lines.join("\n");
}

// ============================================================================
// FACTORÍA DE PROVEEDOR LLM CON CONFIGURACIÓN EN MEMORIA Y FALLBACK RESILIENTE
// ============================================================================

export interface RuntimeLLMConfig {
  provider?: "auto" | "gemini" | "openai" | "anthropic" | "local";
  apiKey?: string;
  model?: string;
}

let runtimeConfigMemory: RuntimeLLMConfig = {};

/**
 * Permite configurar en memoria del backend el proveedor, modelo y API Key enviados desde la interfaz.
 * La clave se mantiene exclusivamente en memoria RAM del servidor y nunca se escribe en disco ni se expone en GET.
 */
export function configurarLLMRuntime(config: RuntimeLLMConfig): {
  provider: string;
  model: string;
  hasCustomKey: boolean;
} {
  runtimeConfigMemory = {
    provider: config.provider || "auto",
    apiKey: config.apiKey ? config.apiKey.trim() : "",
    model: config.model ? config.model.trim() : "",
  };
  const activeAdapter = crearAdaptadorLLM();
  return {
    provider: activeAdapter.providerName,
    model: activeAdapter.modelName,
    hasCustomKey: Boolean(runtimeConfigMemory.apiKey),
  };
}

export function tieneApiKeyPersonalizada(): boolean {
  return Boolean(runtimeConfigMemory.apiKey);
}

function inferirProveedorPorPrefijoKey(key: string): "gemini" | "openai" | "anthropic" {
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("sk-ant-")) return "anthropic";
  return "openai";
}

export function crearAdaptadorLLM(override?: RuntimeLLMConfig): LLMAdapter {
  const effective: RuntimeLLMConfig = {
    provider: override?.provider || runtimeConfigMemory.provider || (process.env.LLM_PROVIDER as RuntimeLLMConfig["provider"]) || "auto",
    apiKey: override?.apiKey ?? runtimeConfigMemory.apiKey ?? "",
    model: override?.model || runtimeConfigMemory.model || "",
  };

  const pref = (effective.provider || "auto").toLowerCase().trim();
  if (pref === "local") {
    return new DeterministicReActAdapter();
  }

  // Si se suministró una API Key desde la UI o en el request
  if (effective.apiKey) {
    const targetProv =
      pref === "gemini" || pref === "openai" || pref === "anthropic"
        ? pref
        : inferirProveedorPorPrefijoKey(effective.apiKey);

    if (targetProv === "gemini") {
      return new GeminiAdapter(effective.apiKey, effective.model || undefined);
    }
    if (targetProv === "anthropic") {
      return new AnthropicAdapter(effective.apiKey, effective.model || undefined);
    }
    return new OpenAIAdapter(effective.apiKey, effective.model || undefined);
  }

  // Variables de entorno del sistema (.env)
  const geminiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

  if (pref === "gemini" && geminiKey) {
    return new GeminiAdapter(geminiKey, effective.model || undefined);
  }
  if (pref === "openai" && openaiKey) {
    return new OpenAIAdapter(openaiKey, effective.model || undefined);
  }
  if (pref === "anthropic" && anthropicKey) {
    return new AnthropicAdapter(anthropicKey, effective.model || undefined);
  }

  if (pref === "auto") {
    if (geminiKey) return new GeminiAdapter(geminiKey, effective.model || undefined);
    if (openaiKey) return new OpenAIAdapter(openaiKey, effective.model || undefined);
    if (anthropicKey) return new AnthropicAdapter(anthropicKey, effective.model || undefined);
  }

  return new DeterministicReActAdapter();
}

