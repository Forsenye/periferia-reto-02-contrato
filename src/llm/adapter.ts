import { z } from "zod";

export type RolMensaje = "system" | "user" | "assistant" | "tool";

export interface LlamadaHerramientaLLM {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MensajeAgente {
  role: RolMensaje;
  content: string;
  toolCalls?: LlamadaHerramientaLLM[];
  toolCallId?: string;
  toolName?: string;
  rawModelParts?: Array<Record<string, unknown>>;
}

export interface PropiedadJsonSchema {
  type: string;
  description?: string;
  enum?: string[];
  nullable?: boolean;
  properties?: Record<string, PropiedadJsonSchema>;
  required?: string[];
}

export interface EsquemaHerramientaLLM {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, PropiedadJsonSchema>;
    required: string[];
  };
}

export interface RespuestaLLM {
  content: string;
  toolCalls: LlamadaHerramientaLLM[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
  rawModelParts?: Array<Record<string, unknown>>;
}

export interface LLMAdapter {
  readonly providerName: string;
  readonly modelName: string;
  enviar(
    mensajes: MensajeAgente[],
    herramientas: EsquemaHerramientaLLM[]
  ): Promise<RespuestaLLM>;
}

/**
 * Convierte un mapa de argumentos Zod en un JSON Schema estándar compatible con Gemini, OpenAI y Anthropic.
 */
export function convertirZodAJsonSchema(
  argsMap: Record<string, z.ZodTypeAny>
): EsquemaHerramientaLLM["parameters"] {
  const properties: Record<string, PropiedadJsonSchema> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(argsMap)) {
    let current: z.ZodTypeAny = schema;
    let isOptional = false;
    let isNullable = false;
    const description = schema.description;

    // Desenvolver ZodOptional / ZodNullable / ZodDefault
    while (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
        isOptional = true;
        current = current._def.innerType;
      } else if (current instanceof z.ZodNullable) {
        isNullable = true;
        current = current._def.innerType;
      }
    }

    if (!isOptional) {
      required.push(key);
    }

    if (current instanceof z.ZodString) {
      properties[key] = {
        type: "string",
        ...(description ? { description } : {}),
        ...(isNullable ? { nullable: true } : {}),
      };
    } else if (current instanceof z.ZodNumber) {
      properties[key] = {
        type: "number",
        ...(description ? { description } : {}),
        ...(isNullable ? { nullable: true } : {}),
      };
    } else if (current instanceof z.ZodBoolean) {
      properties[key] = {
        type: "boolean",
        ...(description ? { description } : {}),
        ...(isNullable ? { nullable: true } : {}),
      };
    } else if (current instanceof z.ZodEnum) {
      properties[key] = {
        type: "string",
        enum: current._def.values as string[],
        ...(description ? { description } : {}),
        ...(isNullable ? { nullable: true } : {}),
      };
    } else if (current instanceof z.ZodObject) {
      const nested = convertirZodAJsonSchema(
        current.shape as Record<string, z.ZodTypeAny>
      );
      properties[key] = {
        type: "object",
        properties: nested.properties,
        ...(nested.required.length > 0 ? { required: nested.required } : {}),
        ...(description ? { description } : {}),
      };
    } else {
      properties[key] = {
        type: "object",
        ...(description ? { description } : {}),
      };
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

