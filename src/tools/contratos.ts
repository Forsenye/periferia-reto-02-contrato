import { z } from "zod";
import {
  type ContratoExtraido,
  ejecutarExtraerContrato,
  ejecutarGenerarAlertas,
  ejecutarLeerBuzon,
  ejecutarLeerDocumento,
  ejecutarRegistrarContrato,
  ejecutarValidarContrato,
  registrarLogHerramienta,
} from "../services/contratos-engine.ts";

export interface ToolContext {
  directory: string;
  sessionId: string;
}

export interface ToolDefinition<TArgs extends Record<string, z.ZodTypeAny>> {
  description: string;
  args: TArgs;
  execute: (
    rawArgs: z.infer<z.ZodObject<TArgs>>,
    ctx: ToolContext
  ) => Promise<string>;
}

const ContratoInputSchema = z
  .object({
    id_contrato: z
      .string()
      .nullable()
      .optional()
      .describe("Identificador del contrato (ej. CT-2026-015 o CM-2026-03)."),
    cliente: z
      .string()
      .nullable()
      .optional()
      .describe("Razón social de la entidad contratante."),
    nit_cliente: z
      .string()
      .nullable()
      .optional()
      .describe("NIT o RUC del cliente sin puntos ni dígito de verificación."),
    pais: z
      .enum(["CO", "EC", "PE", "PA", "HN"])
      .nullable()
      .optional()
      .describe("Código ISO de país (CO, EC, PE, PA, HN)."),
    objeto: z
      .string()
      .nullable()
      .optional()
      .describe("Resumen del objeto contractual (máximo 200 caracteres)."),
    valor: z
      .number()
      .nullable()
      .optional()
      .describe("Valor total numérico sin separadores, o 0 si es contrato marco por demanda."),
    moneda: z
      .enum(["COP", "USD", "PEN", "PAB", "HNL"])
      .nullable()
      .optional()
      .describe("Moneda del contrato (COP, USD, PEN, PAB, HNL)."),
    fecha_inicio: z
      .string()
      .nullable()
      .optional()
      .describe("Fecha de inicio de vigencia en formato YYYY-MM-DD."),
    fecha_fin: z
      .string()
      .nullable()
      .optional()
      .describe("Fecha de finalización de vigencia en formato YYYY-MM-DD."),
    requiere_poliza: z
      .boolean()
      .nullable()
      .optional()
      .describe("Indica si el contrato exige constituir pólizas o garantías."),
    tipo_poliza: z
      .string()
      .optional()
      .describe("Tipos de póliza requeridos separados por punto y coma (;)."),
    estado_poliza: z
      .enum(["vigente", "pendiente", "vencida", "no_aplica"])
      .nullable()
      .optional()
      .describe("Estado de la póliza (pendiente para nuevos contratos con garantía)."),
    comercial: z
      .string()
      .nullable()
      .optional()
      .describe("Nombre del comercial resuelto contra comerciales.json."),
  })
  .passthrough()
  .describe("Datos estructurados del contrato extraídos o confirmados por el analista.");

/**
 * HU-1: Lista todos los mensajes pendientes en `fixtures/reto-02/buzon/` no incluidos en `out/procesados.json`.
 */
export const leer_buzon: ToolDefinition<Record<string, never>> = {
  description:
    "Lista todos los mensajes pendientes del buzón de contratos indicando remitente, asunto, fecha, adjuntos y si contienen un contrato procesable.",
  args: {},
  async execute(_args, ctx) {
    try {
      const data = ejecutarLeerBuzon(ctx.directory);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_leer_buzon",
        null,
        true,
        `Se listaron ${data.mensajes.length} mensajes pendientes en el buzón.`
      );
      return JSON.stringify({ ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_leer_buzon",
        null,
        false,
        `Error al leer buzón: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

/**
 * HU-2: Extrae los datos estructurados del contrato u otrosí adjunto con puntajes de confianza por campo en [0, 1].
 */
export const extraer = {
  description:
    "Extrae de forma determinista los campos estructurados y niveles de confianza [0, 1] del contrato u otrosí adjunto en un mensaje del buzón.",
  args: {
    mensaje_id: z
      .string()
      .min(1)
      .describe("Identificador del mensaje en el buzón (ej. msg-001)."),
  },
  async execute(rawArgs: { mensaje_id: string }, ctx: ToolContext): Promise<string> {
    try {
      const parsed = z.object(extraer.args).safeParse(rawArgs);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Argumentos inválidos en contratos_extraer: ${parsed.error.message}`,
        });
      }
      const { mensaje_id } = parsed.data;
      const contrato = ejecutarExtraerContrato(ctx.directory, mensaje_id);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_extraer",
        mensaje_id,
        true,
        contrato.tiene_contrato
          ? `Extraído contrato ${contrato.id_contrato ?? "SIN-ID"} (${contrato.cliente ?? "SIN-CLIENTE"})`
          : `Mensaje ${mensaje_id} sin contrato válido (${contrato.motivo_sin_contrato})`
      );
      return JSON.stringify({ ok: true, data: contrato });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_extraer",
        rawArgs?.mensaje_id ?? null,
        false,
        `Error en extracción: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

/**
 * HU-3: Clasifica el contrato en nuevo, actualizacion, duplicado o rechazado (RN1-RN4) y reporta requiere_revision (RN5).
 */
export const validar = {
  description:
    "Valida un contrato extraído contra el maestro y las reglas RN1-RN5, clasificándolo en nuevo, actualizacion, duplicado o rechazado y listando los campos con confianza menor a 0.8 en requiere_revision.",
  args: {
    mensaje_id: z
      .string()
      .min(1)
      .describe("Identificador del mensaje en el buzón (ej. msg-001)."),
    contrato: ContratoInputSchema.optional()
      .default({})
      .describe(
        "Objeto con los datos del contrato devueltos por contratos_extraer."
      ),
  },
  async execute(
    rawArgs: { mensaje_id: string; contrato?: Partial<ContratoExtraido> },
    ctx: ToolContext
  ): Promise<string> {
    try {
      const parsed = z.object(validar.args).safeParse(rawArgs);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Argumentos inválidos en contratos_validar: ${parsed.error.message}`,
        });
      }
      const { mensaje_id, contrato } = parsed.data;
      const resultado = ejecutarValidarContrato(
        ctx.directory,
        mensaje_id,
        contrato as Partial<ContratoExtraido>
      );
      registrarLogHerramienta(
        ctx.directory,
        "contratos_validar",
        mensaje_id,
        true,
        `Clasificación: ${resultado.clasificacion} | requiere_revision: [${resultado.requiere_revision.join(", ")}]`
      );
      return JSON.stringify({ ok: true, data: resultado });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_validar",
        rawArgs?.mensaje_id ?? null,
        false,
        `Error en validación: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

/**
 * HU-4: Registra o actualiza el contrato en `out/sharepoint/maestro-contratos.csv`, archiva el documento y escribe en `historial.jsonl`.
 */
export const registrar = {
  description:
    "Registra o actualiza un contrato validado en el maestro de SharePoint y archiva el documento adjunto; detiene la operación si existen campos en requiere_revision a menos que confirmado sea true.",
  args: {
    mensaje_id: z
      .string()
      .min(1)
      .describe("Identificador del mensaje del buzón a registrar (ej. msg-001)."),
    contrato: ContratoInputSchema.optional()
      .default({})
      .describe(
        "Datos estructurados del contrato (con valores confirmados si aplica)."
      ),
    confirmado: z
      .boolean()
      .optional()
      .describe(
        "True únicamente cuando el usuario humano ha confirmado explícitamente los campos con confianza < 0.8."
      ),
  },
  async execute(
    rawArgs: {
      mensaje_id: string;
      contrato?: Partial<ContratoExtraido>;
      confirmado?: boolean;
    },
    ctx: ToolContext
  ): Promise<string> {
    try {
      const parsed = z.object(registrar.args).safeParse(rawArgs);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Argumentos inválidos en contratos_registrar: ${parsed.error.message}`,
        });
      }
      const { mensaje_id, contrato, confirmado } = parsed.data;
      const res = ejecutarRegistrarContrato(
        ctx.directory,
        mensaje_id,
        contrato as Partial<ContratoExtraido>,
        Boolean(confirmado)
      );

      registrarLogHerramienta(
        ctx.directory,
        "contratos_registrar",
        mensaje_id,
        res.ok,
        res.ok
          ? `Contrato ${res.data.id_contrato} (${res.data.accion}) archivado en ${res.data.ruta_archivo}`
          : `Registro detenido: ${res.error}`
      );
      return JSON.stringify(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_registrar",
        rawArgs?.mensaje_id ?? null,
        false,
        `Error en registro: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

/**
 * HU-5: Genera el reporte `out/alertas.md` con contratos próximos a vencer (<= 60 días), pólizas pendientes y contratos registrados desde el corte.
 */
export const alertas = {
  description:
    "Genera el archivo out/alertas.md y devuelve los contratos que vencen en <= 60 días desde la fecha hoy, las pólizas pendientes y los contratos registrados desde el 2026-05-30.",
  args: {
    hoy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato requerido: YYYY-MM-DD")
      .describe("Fecha de referencia en formato YYYY-MM-DD (ej. 2026-09-03)."),
  },
  async execute(rawArgs: { hoy: string }, ctx: ToolContext): Promise<string> {
    try {
      const parsed = z.object(alertas.args).safeParse(rawArgs);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Fecha inválida en contratos_alertas: ${parsed.error.message}`,
        });
      }
      const resultado = ejecutarGenerarAlertas(ctx.directory, parsed.data.hoy);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_alertas",
        null,
        true,
        `Reporte generado en ${resultado.ruta} (hoy=${parsed.data.hoy}): ${resultado.vencen.length} por vencer, ${resultado.polizas_pendientes.length} pólizas pendientes, ${resultado.registrados_desde_corte.length} nuevos.`
      );
      return JSON.stringify({ ok: true, data: resultado });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_alertas",
        null,
        false,
        `Error en alertas: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

/**
 * P1 Opcional: Lee el texto de un archivo PDF nativo o documento de texto dentro del proyecto.
 */
export const leer_pdf = {
  description:
    "Extrae el texto plano de un archivo de contrato (.pdf o .txt) ubicado dentro del directorio del proyecto.",
  args: {
    ruta: z
      .string()
      .min(1)
      .describe(
        "Ruta relativa al directorio raíz del proyecto (ej. fixtures/reto-02/buzon/msg-001/contrato.txt)."
      ),
  },
  async execute(rawArgs: { ruta: string }, ctx: ToolContext): Promise<string> {
    try {
      const parsed = z.object(leer_pdf.args).safeParse(rawArgs);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Ruta inválida en contratos_leer_pdf: ${parsed.error.message}`,
        });
      }
      const res = ejecutarLeerDocumento(ctx.directory, parsed.data.ruta);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_leer_pdf",
        null,
        true,
        `Archivo leído (${res.ruta}, ${res.texto.length} caracteres).`
      );
      return JSON.stringify({ ok: true, data: { texto: res.texto, formato: res.formato } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      registrarLogHerramienta(
        ctx.directory,
        "contratos_leer_pdf",
        null,
        false,
        `Error al leer archivo: ${message}`
      );
      return JSON.stringify({ ok: false, error: message });
    }
  },
};

