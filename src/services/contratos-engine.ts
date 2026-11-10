import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// TIPOS DE DOMINIO (ESQUEMA MAESTRO Y HERRAMIENTAS)
// ============================================================================

export type PaisContrato = "CO" | "EC" | "PE" | "PA" | "HN";
export type MonedaContrato = "COP" | "USD" | "PEN" | "PAB" | "HNL";
export type EstadoPoliza = "vigente" | "pendiente" | "vencida" | "no_aplica";
export type FuenteRegistro = "buzon" | "manual" | "migracion";
export type ClasificacionContrato = "nuevo" | "actualizacion" | "duplicado" | "rechazado";

export interface FilaMaestroContrato {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: PaisContrato;
  objeto: string;
  valor: number;
  moneda: MonedaContrato;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: EstadoPoliza;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: FuenteRegistro;
}

export interface ComercialCatalogo {
  email: string;
  nombre: string;
  region: string;
}

export interface CorreoRaw {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
}

export interface MensajeBuzonItem {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  cuerpo: string;
  adjuntos: string[];
  tiene_contrato: boolean;
  tipo_adjunto: "contrato" | "otrosi" | "cotizacion" | "ninguno";
  clasificacion_preliminar?: "rechazado" | "procesable";
  motivo_rechazo?: string;
}

export interface ConfianzaCampos {
  id_contrato: number;
  cliente: number;
  nit_cliente: number;
  pais: number;
  objeto: number;
  valor: number;
  moneda: number;
  fecha_inicio: number;
  fecha_fin: number;
  requiere_poliza: number;
  tipo_poliza: number;
  estado_poliza: number;
  comercial: number;
}

export interface ContratoExtraido {
  mensaje_id: string;
  id_contrato: string | null;
  cliente: string | null;
  nit_cliente: string | null;
  pais: PaisContrato | null;
  objeto: string | null;
  valor: number | null;
  valor_indeterminado: boolean;
  moneda: MonedaContrato | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  plazo_meses: number | null;
  requiere_poliza: boolean | null;
  tipo_poliza: string;
  estado_poliza: EstadoPoliza | null;
  comercial: string | null;
  email_remitente: string;
  comercial_conocido: boolean;
  es_otrosi: boolean;
  numero_otrosi: string | null;
  adjunto_origen: string | null;
  tiene_contrato: boolean;
  motivo_sin_contrato?: string;
  confianza: ConfianzaCampos;
  notas_extraccion: string[];
}

export interface DetalleRevisionCampo {
  campo: string;
  valor_actual: unknown;
  confianza: number;
  motivo: string;
}

export interface DiferenciaCampo {
  anterior: unknown;
  nuevo: unknown;
}

export interface ResultadoValidacion {
  mensaje_id: string;
  clasificacion: ClasificacionContrato;
  id_contrato_existente?: string;
  requiere_revision: string[];
  detalle_revision: DetalleRevisionCampo[];
  diferencias?: Record<string, DiferenciaCampo>;
  advertencias: string[];
  motivo_rechazo?: string;
  comercial_resuelto: {
    email: string;
    nombre: string;
    conocido: boolean;
    region?: string;
  };
}

export interface ResultadoRegistro {
  id_contrato: string;
  accion: "nuevo" | "actualizacion" | "duplicado_ignorado" | "rechazado_ignorado";
  ruta_archivo: string;
  ruta_maestro: string;
  cambios?: Record<string, DiferenciaCampo>;
  fila?: FilaMaestroContrato;
}

export interface EntradaHistorial {
  ts: string;
  id_contrato: string;
  accion: "nuevo" | "actualizacion";
  cambios: Record<string, DiferenciaCampo>;
  mensaje_id: string;
}

export interface EntradaLog {
  ts: string;
  herramienta: string;
  mensaje_id: string | null;
  ok: boolean;
  resumen: string;
}

export interface ContratoPorVencer extends FilaMaestroContrato {
  dias_restantes: number;
}

export interface ContratoVencido extends FilaMaestroContrato {
  dias_vencido: number;
}

export interface ResultadoAlertas {
  hoy: string;
  ruta: string;
  vencen: ContratoPorVencer[];
  vencidos_historicos: ContratoVencido[];
  polizas_pendientes: FilaMaestroContrato[];
  registrados_desde_corte: FilaMaestroContrato[];
  actualizados_desde_corte: EntradaHistorial[];
  resumen_ejecutivo: {
    total_contratos_maestro: number;
    vencen_60_dias: number;
    vencidos_sin_renovar: number;
    polizas_pendientes: number;
    nuevos_desde_corte: number;
    actualizaciones_desde_corte: number;
  };
}

// ============================================================================
// CONSTANTES Y UTILIDADES DE ARCHIVOS / RUTAS
// ============================================================================

export const FECHA_CORTE_MAESTRO = "2026-05-30";
export const UMBRAL_CONFIANZA = 0.8;

const CSV_HEADERS: (keyof FilaMaestroContrato)[] = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
];

export function getRutasProyecto(directory: string) {
  const baseDir = path.resolve(directory);
  const fixturesDir = path.join(baseDir, "fixtures", "reto-02");
  const buzonDir = path.join(fixturesDir, "buzon");
  const maestroFixturePath = path.join(fixturesDir, "maestro-contratos.csv");
  const comercialesPath = path.join(fixturesDir, "comerciales.json");

  const outDir = path.join(baseDir, "out");
  const sharepointDir = path.join(outDir, "sharepoint");
  const maestroOutPath = path.join(sharepointDir, "maestro-contratos.csv");
  const historialPath = path.join(sharepointDir, "historial.jsonl");
  const procesadosPath = path.join(outDir, "procesados.json");
  const logPath = path.join(outDir, "log.jsonl");
  const alertasPath = path.join(outDir, "alertas.md");

  return {
    baseDir,
    fixturesDir,
    buzonDir,
    maestroFixturePath,
    comercialesPath,
    outDir,
    sharepointDir,
    maestroOutPath,
    historialPath,
    procesadosPath,
    logPath,
    alertasPath,
  };
}

/**
 * Inicializa la estructura de `out/` y copia `maestro-contratos.csv` a `out/sharepoint/`
 * si aún no existe (cumpliendo RN6: el fixture original es estrictamente de solo lectura).
 */
export function asegurarEntornoSalida(directory: string): void {
  const rutas = getRutasProyecto(directory);
  fs.mkdirSync(rutas.outDir, { recursive: true });
  fs.mkdirSync(rutas.sharepointDir, { recursive: true });
  fs.mkdirSync(path.join(rutas.sharepointDir, "Contratos"), { recursive: true });

  if (!fs.existsSync(rutas.maestroOutPath)) {
    fs.copyFileSync(rutas.maestroFixturePath, rutas.maestroOutPath);
  }
  if (!fs.existsSync(rutas.procesadosPath)) {
    fs.writeFileSync(rutas.procesadosPath, JSON.stringify([], null, 2), "utf-8");
  }
}

/**
 * Registra una entrada de auditoría en `out/log.jsonl` (RN7 y CA4).
 */
export function registrarLogHerramienta(
  directory: string,
  herramienta: string,
  mensaje_id: string | null,
  ok: boolean,
  resumen: string
): void {
  try {
    asegurarEntornoSalida(directory);
    const { logPath } = getRutasProyecto(directory);
    const entry: EntradaLog = {
      ts: new Date().toISOString(),
      herramienta,
      mensaje_id,
      ok,
      resumen,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Nunca lanzar desde el logger de auditoría
  }
}

// ============================================================================
// PARSEO Y SERIALIZACIÓN DE CSV (MAESTRO DE CONTRATOS)
// ============================================================================

function parsearLineaCSV(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function escaparCampoCSV(val: string | number | boolean): string {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function leerMaestroContratos(directory: string): FilaMaestroContrato[] {
  asegurarEntornoSalida(directory);
  const { maestroOutPath } = getRutasProyecto(directory);
  const raw = fs.readFileSync(maestroOutPath, "utf-8").trim();
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const rows: FilaMaestroContrato[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parsearLineaCSV(lines[i]);
    if (cols.length < CSV_HEADERS.length) continue;
    rows.push({
      id_contrato: cols[0].trim(),
      cliente: cols[1].trim(),
      nit_cliente: cols[2].trim(),
      pais: (cols[3].trim() || "CO") as PaisContrato,
      objeto: cols[4].trim(),
      valor: Number(cols[5].trim() || 0),
      moneda: (cols[6].trim() || "COP") as MonedaContrato,
      fecha_inicio: cols[7].trim(),
      fecha_fin: cols[8].trim(),
      requiere_poliza: cols[9].trim().toLowerCase() === "true",
      tipo_poliza: cols[10].trim(),
      estado_poliza: (cols[11].trim() || "no_aplica") as EstadoPoliza,
      comercial: cols[12].trim(),
      ruta_sharepoint: cols[13].trim(),
      fecha_registro: cols[14].trim(),
      fuente: (cols[15].trim() || "buzon") as FuenteRegistro,
    });
  }
  return rows;
}

export function escribirMaestroContratos(directory: string, filas: FilaMaestroContrato[]): void {
  asegurarEntornoSalida(directory);
  const { maestroOutPath } = getRutasProyecto(directory);
  const headerLine = CSV_HEADERS.join(",");
  const bodyLines = filas.map((fila) =>
    CSV_HEADERS.map((key) => escaparCampoCSV(fila[key])).join(",")
  );
  fs.writeFileSync(maestroOutPath, [headerLine, ...bodyLines].join("\n") + "\n", "utf-8");
}

export function leerComerciales(directory: string): ComercialCatalogo[] {
  const { comercialesPath } = getRutasProyecto(directory);
  if (!fs.existsSync(comercialesPath)) return [];
  return JSON.parse(fs.readFileSync(comercialesPath, "utf-8")) as ComercialCatalogo[];
}

export function leerProcesados(directory: string): string[] {
  asegurarEntornoSalida(directory);
  const { procesadosPath } = getRutasProyecto(directory);
  try {
    const data = JSON.parse(fs.readFileSync(procesadosPath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function marcarMensajeProcesado(directory: string, mensajeId: string): void {
  asegurarEntornoSalida(directory);
  const { procesadosPath } = getRutasProyecto(directory);
  const actual = new Set(leerProcesados(directory));
  actual.add(mensajeId);
  fs.writeFileSync(procesadosPath, JSON.stringify(Array.from(actual), null, 2), "utf-8");
}

// ============================================================================
// HEURÍSTICAS DETERMINISTAS DE EXTRACCIÓN DE TEXTO CONTRACTUAL
// ============================================================================

const MESES_ES: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const NUMEROS_TEXTO_ES: Record<string, number> = {
  un: 1,
  uno: 1,
  primero: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  dieciocho: 18,
  veinte: 20,
  veinticuatro: 24,
  treinta: 30,
  "treinta y uno": 31,
};

/**
 * Convierte expresiones de fecha en español a formato ISO YYYY-MM-DD.
 * Soporta:
 * - "primero (1) de agosto de 2026"
 * - "treinta y uno (31) de julio de 2027"
 * - "a los treinta (30) días del mes de julio de 2026"
 * - "27 de agosto de 2026"
 * - "2026-08-01"
 */
export function parsearFechaEspanol(fragmento: string): { fecha: string | null; confianza: number } {
  // 1. Formato ISO directo YYYY-MM-DD
  const isoMatch = fragmento.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return { fecha: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`, confianza: 1.0 };
  }

  // 2. Patrón con número entre paréntesis: "primero (1) de agosto de 2026" o "a los treinta (30) días del mes de julio de 2026"
  const parentesisRegex =
    /\((\d{1,2})\)\s*(?:d[ií]as\s+del\s+mes\s+)?de\s+([a-záéíóú]+)\s+de\s+(20\d{2})/i;
  const mPar = fragmento.match(parentesisRegex);
  if (mPar) {
    const dia = mPar[1].padStart(2, "0");
    const mesNombre = mPar[2].toLowerCase();
    const mes = MESES_ES[mesNombre];
    const anio = mPar[3];
    if (mes) {
      return { fecha: `${anio}-${mes}-${dia}`, confianza: 1.0 };
    }
  }

  // 3. Patrón numérico estándar: "27 de agosto de 2026"
  const directoRegex = /\b(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(20\d{2})\b/i;
  const mDir = fragmento.match(directoRegex);
  if (mDir) {
    const dia = mDir[1].padStart(2, "0");
    const mesNombre = mDir[2].toLowerCase();
    const mes = MESES_ES[mesNombre];
    const anio = mDir[3];
    if (mes) {
      return { fecha: `${anio}-${mes}-${dia}`, confianza: 0.95 };
    }
  }

  // 4. Patrón solo mes y año: "en el mes de agosto de 2026"
  const soloMesRegex = /mes\s+de\s+([a-záéíóú]+)\s+de\s+(20\d{2})/i;
  const mMes = fragmento.match(soloMesRegex);
  if (mMes) {
    const mesNombre = mMes[1].toLowerCase();
    const mes = MESES_ES[mesNombre];
    const anio = mMes[2];
    if (mes) {
      // Último día del mes o día 31 si es agosto (baja confianza porque el día exacto no figura en la firma)
      const ultimoDia = new Date(Number(anio), Number(mes), 0).getDate();
      return {
        fecha: `${anio}-${mes}-${String(ultimoDia).padStart(2, "0")}`,
        confianza: 0.65,
      };
    }
  }

  return { fecha: null, confianza: 0 };
}

/**
 * Suma meses a una fecha YYYY-MM-DD para derivar la fecha_fin cuando el contrato
 * solo expresa el plazo en meses ("duración de doce (12) meses contados a partir de la fecha de su firma").
 */
export function sumarMesesFecha(
  fechaInicio: string,
  meses: number,
  diaExactoConocido: boolean
): string {
  const [y, m, d] = fechaInicio.split("-").map(Number);
  if (!diaExactoConocido) {
    // Si se firmó "en el mes de agosto de 2026" y dura 12 meses, el fin de vigencia es el último día de agosto del año siguiente (2027-08-31)
    const targetYear = y + Math.floor((m - 1 + meses) / 12);
    const targetMonth = ((m - 1 + meses) % 12) + 1;
    const lastDay = new Date(targetYear, targetMonth, 0).getDate();
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  const date = new Date(Date.UTC(y, m - 1 + meses, d));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Normaliza la razón social del cliente conservando siglas societarias (S.A.S., S.A., S.A.C., S. de R.L.)
 * y formato Title Case consistente con el maestro histórico.
 */
export function normalizarNombreCliente(raw: string): string {
  const limpio = raw.trim().replace(/,+$/, "").replace(/\s+/g, " ");
  const palabrasMinusculas = new Set(["de", "del", "la", "las", "los", "y", "e"]);
  const siglasMayusculas = new Set([
    "S.A.S.",
    "S.A.S",
    "S.A.",
    "S.A",
    "S.A.C.",
    "S.A.C",
    "LTDA.",
    "LTDA",
    "B2B",
    "SAP",
    "TI",
    "CRM",
    "WMS",
    "R.L.",
  ]);

  if (/^S\.\s*de\s*R\.L\.?$/i.test(limpio)) {
    return "S. de R.L.";
  }

  const tokens = limpio.split(" ");
  return tokens
    .map((tok, idx) => {
      const upper = tok.toUpperCase();
      if (siglasMayusculas.has(upper)) {
        return upper.endsWith(".") ? upper : `${upper}.`;
      }
      const lower = tok.toLowerCase();
      if (idx > 0 && palabrasMinusculas.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ")
    .replace(/\bS\.\s*De\s*R\.L\./g, "S. de R.L.");
}

/**
 * Genera el slug de carpeta de SharePoint consistente con `maestro-contratos.csv`
 * (ej. "Industrias Delta S.A.S." -> "industrias-delta", "Corporación Andina de Servicios S.A." -> "corporacion-andina-de-servicios").
 */
export function generarClienteSlug(cliente: string): string {
  return cliente
    .replace(/\b(S\.A\.S\.?|S\.A\.C\.?|S\.A\.?|S\.\s*de\s*R\.L\.?|LTDA\.?)\b/gi, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Calcula similitud léxica entre dos textos de objeto contractual (RN2: similitud >= 0.9).
 */
export function calcularSimilitudTexto(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const tokensA = new Set(norm(a));
  const tokensB = new Set(norm(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let interseccion = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) interseccion++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return interseccion / union;
}

// ============================================================================
// 1. LEER BUZÓN (`contratos_leer_buzon`)
// ============================================================================

export function ejecutarLeerBuzon(directory: string): { mensajes: MensajeBuzonItem[] } {
  asegurarEntornoSalida(directory);
  const { buzonDir } = getRutasProyecto(directory);
  const procesados = new Set(leerProcesados(directory));

  if (!fs.existsSync(buzonDir)) {
    return { mensajes: [] };
  }

  const carpetas = fs
    .readdirSync(buzonDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const mensajes: MensajeBuzonItem[] = [];

  for (const carpeta of carpetas) {
    if (procesados.has(carpeta)) continue;

    const correoPath = path.join(buzonDir, carpeta, "correo.json");
    if (!fs.existsSync(correoPath)) continue;

    const correo = JSON.parse(fs.readFileSync(correoPath, "utf-8")) as CorreoRaw;
    const adjuntos = Array.isArray(correo.adjuntos) ? correo.adjuntos : [];

    // Determinar si el mensaje trae un contrato u otrosí real vs cotización o consulta
    let tieneContrato = false;
    let tipoAdjunto: "contrato" | "otrosi" | "cotizacion" | "ninguno" = "ninguno";
    let motivoRechazo: string | undefined;

    for (const adj of adjuntos) {
      const lower = adj.toLowerCase();
      const adjPath = path.join(buzonDir, carpeta, adj);
      const contenido = fs.existsSync(adjPath) ? fs.readFileSync(adjPath, "utf-8") : "";

      if (lower.includes("otrosi") || /OTROS[IÍ]\s+No\./i.test(contenido)) {
        tieneContrato = true;
        tipoAdjunto = "otrosi";
        break;
      }
      if (
        lower.includes("cotizacion") ||
        /^COTIZACI[ÓO]N\b/i.test(contenido.trim()) ||
        /a[uú]n no hay contrato/i.test(correo.cuerpo)
      ) {
        tieneContrato = false;
        tipoAdjunto = "cotizacion";
        motivoRechazo = `El adjunto '${adj}' corresponde a una cotización u oferta comercial y el correo indica que aún no existe contrato firmado.`;
        break;
      }
      if (
        lower.includes("contrato") ||
        /\bCONTRATO\b/i.test(contenido)
      ) {
        tieneContrato = true;
        tipoAdjunto = "contrato";
        break;
      }
    }

    if (adjuntos.length === 0) {
      tieneContrato = false;
      tipoAdjunto = "ninguno";
      motivoRechazo = "El correo electrónico no contiene archivos adjuntos.";
    }

    mensajes.push({
      id: correo.id || carpeta,
      de: correo.de,
      para: correo.para,
      asunto: correo.asunto,
      fecha: correo.fecha,
      cuerpo: correo.cuerpo,
      adjuntos,
      tiene_contrato: tieneContrato,
      tipo_adjunto: tipoAdjunto,
      clasificacion_preliminar: tieneContrato ? "procesable" : "rechazado",
      ...(motivoRechazo ? { motivo_rechazo: motivoRechazo } : {}),
    });
  }

  return { mensajes };
}

// ============================================================================
// 2. EXTRAER DATOS DEL CONTRATO (`contratos_extraer`)
// ============================================================================

export function ejecutarExtraerContrato(
  directory: string,
  mensajeId: string
): ContratoExtraido {
  asegurarEntornoSalida(directory);
  const { buzonDir } = getRutasProyecto(directory);
  const msgDir = path.join(buzonDir, mensajeId);

  if (!fs.existsSync(msgDir)) {
    throw new Error(`No existe el mensaje '${mensajeId}' en el buzón (${buzonDir}).`);
  }

  const correoPath = path.join(msgDir, "correo.json");
  if (!fs.existsSync(correoPath)) {
    throw new Error(`El mensaje '${mensajeId}' no contiene archivo correo.json.`);
  }

  const correo = JSON.parse(fs.readFileSync(correoPath, "utf-8")) as CorreoRaw;
  const comerciales = leerComerciales(directory);
  const comercialMatch = comerciales.find(
    (c) => c.email.toLowerCase() === correo.de.toLowerCase()
  );

  const adjuntoNombre = correo.adjuntos?.[0] ?? null;
  const adjuntoPath = adjuntoNombre ? path.join(msgDir, adjuntoNombre) : null;
  const textoRaw =
    adjuntoPath && fs.existsSync(adjuntoPath)
      ? fs.readFileSync(adjuntoPath, "utf-8").trim()
      : "";

  const notas: string[] = [];

  // Verificar si no es un contrato (ej. cotización msg-005 o texto vacío)
  const esCotizacion =
    (adjuntoNombre && adjuntoNombre.toLowerCase().includes("cotizacion")) ||
    /^COTIZACI[ÓO]N\s+No\./i.test(textoRaw) ||
    /a[uú]n no hay contrato/i.test(correo.cuerpo);

  if (!textoRaw || esCotizacion) {
    const motivo = !textoRaw
      ? "El mensaje no tiene texto de contrato adjunto o el archivo está vacío."
      : `El documento adjunto (${adjuntoNombre}) es una cotización comercial (${textoRaw.split(/\r?\n/)[0]}), no un contrato perfeccionado.`;

    return {
      mensaje_id: mensajeId,
      id_contrato: null,
      cliente: null,
      nit_cliente: null,
      pais: null,
      objeto: null,
      valor: null,
      valor_indeterminado: false,
      moneda: null,
      fecha_inicio: null,
      fecha_fin: null,
      plazo_meses: null,
      requiere_poliza: null,
      tipo_poliza: "",
      estado_poliza: null,
      comercial: comercialMatch?.nombre ?? null,
      email_remitente: correo.de,
      comercial_conocido: Boolean(comercialMatch),
      es_otrosi: false,
      numero_otrosi: null,
      adjunto_origen: adjuntoNombre,
      tiene_contrato: false,
      motivo_sin_contrato: motivo,
      confianza: {
        id_contrato: 0,
        cliente: 0,
        nit_cliente: 0,
        pais: 0,
        objeto: 0,
        valor: 0,
        moneda: 0,
        fecha_inicio: 0,
        fecha_fin: 0,
        requiere_poliza: 0,
        tipo_poliza: 0,
        estado_poliza: 0,
        comercial: comercialMatch ? 1.0 : 0.4,
      },
      notas_extraccion: [motivo],
    };
  }

  // 1. Detectar si es Otrosí vs Contrato principal
  const otrosiHeaderMatch = textoRaw.match(
    /OTROS[IÍ]\s+No\.\s*(\d+)\s+AL\s+CONTRATO.*?No\.\s*([A-Z0-9-]+)/i
  );
  const esOtrosi = Boolean(
    otrosiHeaderMatch || (adjuntoNombre && adjuntoNombre.toLowerCase().includes("otrosi"))
  );
  const numeroOtrosi = otrosiHeaderMatch ? otrosiHeaderMatch[1] : null;

  // 2. Extraer id_contrato
  let idContrato: string | null = null;
  let confIdContrato = 0;

  if (otrosiHeaderMatch?.[2]) {
    idContrato = otrosiHeaderMatch[2].trim();
    confIdContrato = 1.0;
  } else {
    const idMatch =
      textoRaw.match(/CONTRATO(?:\s+MARCO)?\s+DE\s+PRESTACI[ÓO]N\s+DE\s+SERVICIOS\s+No\.\s*([A-Z0-9-]+)/i) ||
      textoRaw.match(/\b((?:CT|CM)-\d{4}-\d{2,4})\b/);
    if (idMatch?.[1]) {
      idContrato = idMatch[1].trim();
      confIdContrato = 1.0;
    }
  }

  // 3. Buscar contrato base en el maestro si es un otrosí o si ya existe ese id_contrato
  const maestro = leerMaestroContratos(directory);
  const registroExistente = idContrato
    ? maestro.find((r) => r.id_contrato.toUpperCase() === idContrato!.toUpperCase())
    : undefined;

  // 4. Extraer Cliente (EL CONTRATANTE) y NIT / RUC
  let cliente: string | null = null;
  let confCliente = 0;
  let nitCliente: string | null = null;
  let confNit = 0;

  const entreMatch = textoRaw.match(
    /Entre\s+(?:los\s+suscritos,\s+)?([^,]+(?:,\s*S\.\s*de\s*R\.L\.)?),\s*(?:identificada\s+con\s+)?(?:NIT|RUC)\s+([0-9.-]+)/i
  );
  if (entreMatch) {
    cliente = normalizarNombreCliente(entreMatch[1]);
    confCliente = 1.0;
    // Eliminar puntos y dígito de verificación (-X) según sección 7.2 del PRD
    nitCliente = entreMatch[2].trim().split("-")[0].replace(/\./g, "");
    confNit = 1.0;
  } else if (registroExistente) {
    cliente = registroExistente.cliente;
    confCliente = 0.95;
    nitCliente = registroExistente.nit_cliente;
    confNit = 0.95;
  }

  // 5. Inferir País (CO | EC | PE | PA | HN)
  let pais: PaisContrato | null = null;
  let confPais = 0;
  const fragmentoPartes = textoRaw.split(/PRIMERA\./i)[0] || textoRaw;

  if (/Quito,\s*Ecuador|Ecuador/i.test(fragmentoPartes)) {
    pais = "EC";
    confPais = 1.0;
  } else if (/Lima,\s*Per[uú]|Per[uú]/i.test(fragmentoPartes)) {
    pais = "PE";
    confPais = 1.0;
  } else if (/Panam[aá]/i.test(fragmentoPartes)) {
    pais = "PA";
    confPais = 1.0;
  } else if (/Honduras|San Pedro Sula/i.test(fragmentoPartes)) {
    pais = "HN";
    confPais = 1.0;
  } else if (/Bogot[aá]|Medell[ií]n|Barranquilla|Cali|Colombia/i.test(fragmentoPartes)) {
    pais = "CO";
    confPais = 1.0;
  } else if (nitCliente?.length === 13 && nitCliente.endsWith("001")) {
    pais = "EC";
    confPais = 0.9;
  } else if (nitCliente?.length === 11 && nitCliente.startsWith("20")) {
    pais = "PE";
    confPais = 0.9;
  }

  // 6. Extraer Objeto (máx 200 caracteres según 7.2)
  let objeto: string | null = null;
  let confObjeto = 0;

  const objetoClauseMatch = textoRaw.match(
    /PRIMERA\.\s*OBJETO\.\s*([^\r\n]+)/i
  );
  if (objetoClauseMatch?.[1]) {
    let objLimpio = objetoClauseMatch[1]
      .trim()
      .replace(/^EL\s+CONTRATISTA\s+se\s+obliga\s+a\s+ejecutar\s+la\s+/i, "")
      .replace(/^EL\s+CONTRATISTA\s+prestar[aá]\s+(?:el\s+)?/i, "")
      .replace(/\.$/, "");
    objLimpio = objLimpio.charAt(0).toUpperCase() + objLimpio.slice(1);
    if (objLimpio.length > 200) {
      objLimpio = objLimpio.slice(0, 197).trim() + "...";
    }
    objeto = objLimpio;
    confObjeto = 0.95;
  } else if (esOtrosi && registroExistente) {
    // En un otrosí de plazo/valor, el objeto original se conserva
    objeto = registroExistente.objeto;
    confObjeto = 1.0;
    notas.push(
      `Otrosí conserva el objeto del contrato base ${registroExistente.id_contrato}.`
    );
  }

  // 7. Extraer Valor y Moneda
  let valor: number | null = null;
  let valorIndeterminado = false;
  let confValor = 0;
  let moneda: MonedaContrato | null = null;
  let confMoneda = 0;

  const seccionValorMatch =
    textoRaw.match(/SEGUNDA\.\s*(?:VALOR\.|Modificar la cl[aá]usula SEGUNDA \(VALOR\))[^\r\n]*/i);
  const textoValor = seccionValorMatch ? seccionValorMatch[0] : textoRaw;

  if (/no\s+tiene\s+un\s+valor\s+determinado|seg[uú]n\s+las\s+tarifas|por\s+demanda/i.test(textoValor)) {
    // Regla 7.2 y 7.4: Valor 0 si el contrato es por demanda (valor_indeterminado = true),
    // pero confianza < 0.8 para exigir confirmación humana (msg-006).
    valor = 0;
    valorIndeterminado = true;
    confValor = 0.65;
    notas.push(
      "Contrato marco por demanda sin cuantía fija ('no tiene un valor determinado'). Se asigna valor = 0 con confianza 0.65 para confirmación humana."
    );
  } else {
    const montoExplicitMatch = textoValor.match(
      /\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([0-9.,]+)/i
    );
    if (montoExplicitMatch) {
      moneda = montoExplicitMatch[1].toUpperCase() as MonedaContrato;
      confMoneda = 1.0;
      const rawNum = montoExplicitMatch[2];
      // Si termina en .00 o ,00 quitar decimales antes de limpiar separadores de miles
      const sinDecimales = rawNum.replace(/[.,]00$/, "");
      const soloDigitos = sinDecimales.replace(/[.,]/g, "");
      valor = Number(soloDigitos);
      confValor = Number.isFinite(valor) ? 1.0 : 0;
    }
  }

  if (!moneda) {
    // Inferir moneda del resto del contrato (ej. cláusula de garantías en msg-006 o país)
    const monedaGlobalMatch = textoRaw.match(/\b(COP|USD|PEN|PAB|HNL)\b/);
    if (monedaGlobalMatch) {
      moneda = monedaGlobalMatch[1] as MonedaContrato;
      confMoneda = 0.88;
    } else if (pais === "CO") {
      moneda = "COP";
      confMoneda = 0.85;
    } else if (pais === "EC" || pais === "PA") {
      moneda = "USD";
      confMoneda = 0.85;
    } else if (pais === "PE") {
      moneda = "PEN";
      confMoneda = 0.85;
    } else if (pais === "HN") {
      moneda = "HNL";
      confMoneda = 0.8;
    }
  }

  // 8. Extraer Plazo (fecha_inicio y fecha_fin)
  let fechaInicio: string | null = null;
  let confFechaInicio = 0;
  let fechaFin: string | null = null;
  let confFechaFin = 0;
  let plazoMeses: number | null = null;

  // 8.a Extraer meses de duración si se mencionan
  const plazoMesesMatch = textoRaw.match(
    /(?:plazo de ejecuci[oó]n ser[aá] de|duraci[oó]n de)\s+([a-záéíóú]+)?\s*\((\d{1,3})\)\s*meses/i
  );
  if (plazoMesesMatch?.[2]) {
    plazoMeses = Number(plazoMesesMatch[2]);
  } else {
    const palabraMesesMatch = textoRaw.match(
      /(?:plazo de ejecuci[oó]n ser[aá] de|duraci[oó]n de)\s+(un|uno|dos|tres|cuatro|cinco|seis|doce|dieciocho|veinticuatro)\s+meses/i
    );
    if (palabraMesesMatch?.[1]) {
      plazoMeses = NUMEROS_TEXTO_ES[palabraMesesMatch[1].toLowerCase()] ?? null;
    }
  }

  // 8.b Caso rango explícito: "desde el <fecha1> hasta el <fecha2>"
  const rangoExplicitMatch = textoRaw.match(
    /desde\s+el\s+([^\r\n]+?)\s+hasta\s+el\s+([^\r\n.]+)/i
  );
  if (rangoExplicitMatch) {
    const ini = parsearFechaEspanol(rangoExplicitMatch[1]);
    const fin = parsearFechaEspanol(rangoExplicitMatch[2]);
    fechaInicio = ini.fecha;
    confFechaInicio = ini.confianza;
    fechaFin = fin.fecha;
    confFechaFin = fin.confianza;
  }

  // 8.c Caso Otrosí que extiende fecha_fin: "se extiende hasta el <fecha>"
  if (!fechaFin && esOtrosi) {
    const extiendeMatch = textoRaw.match(/se\s+extiende\s+hasta\s+el\s+([^\r\n".]+)/i);
    if (extiendeMatch) {
      const fin = parsearFechaEspanol(extiendeMatch[1]);
      fechaFin = fin.fecha;
      confFechaFin = fin.confianza;
    }
    const suscritoMatch = textoRaw.match(/suscrito\s+el\s+([^\r\n,]+)/i);
    if (suscritoMatch) {
      const ini = parsearFechaEspanol(suscritoMatch[1]);
      fechaInicio = ini.fecha;
      confFechaInicio = ini.confianza;
    } else if (registroExistente) {
      fechaInicio = registroExistente.fecha_inicio;
      confFechaInicio = 1.0;
    }
  }

  // 8.d Caso plazo expresado en meses a partir de la fecha de firma (ej. msg-006)
  if (!fechaInicio || !fechaFin) {
    const lineaFirmaMatch = textoRaw.match(/Se\s+firma\s+en\s+[^\r\n]+/i);
    const infoFirma = lineaFirmaMatch
      ? parsearFechaEspanol(lineaFirmaMatch[0])
      : { fecha: null, confianza: 0 };

    if (!fechaInicio) {
      if (infoFirma.fecha && infoFirma.confianza >= 0.9) {
        fechaInicio = infoFirma.fecha;
        confFechaInicio = infoFirma.confianza;
      } else if (infoFirma.fecha) {
        // La firma solo indica "en el mes de agosto de 2026"; usamos la fecha del correo o el inicio del mes como base
        const fechaCorreoISO = correo.fecha.slice(0, 10);
        const [anioFirma, mesFirma] = infoFirma.fecha.split("-");
        fechaInicio =
          fechaCorreoISO.startsWith(`${anioFirma}-${mesFirma}`)
            ? `${anioFirma}-${mesFirma}-01`
            : infoFirma.fecha;
        confFechaInicio = 0.85;
        notas.push(
          `El documento indica firma 'en el mes de agosto de 2026' sin día exacto; se toma fecha_inicio = ${fechaInicio}.`
        );
      }
    }

    if (!fechaFin && fechaInicio && plazoMeses) {
      const diaExactoConocido = infoFirma.confianza >= 0.9;
      fechaFin = sumarMesesFecha(fechaInicio, plazoMeses, diaExactoConocido);
      // Confianza < 0.8 porque la fecha_fin es derivada de un plazo en meses sobre una fecha de firma sin día exacto (RN5 / Caso msg-006)
      confFechaFin = diaExactoConocido ? 0.82 : 0.60;
      notas.push(
        `fecha_fin (${fechaFin}) derivada de plazo de ${plazoMeses} meses a partir de la firma (confianza ${confFechaFin} < 0.8, requiere confirmación humana).`
      );
    }
  }

  // 9. Extraer Pólizas / Garantías
  let requierePoliza = false;
  let confRequierePoliza = 0.95;
  const tiposPolizaDetectados: string[] = [];
  let confTipoPoliza = 0.95;

  const seccionGarantiasMatch = textoRaw.match(
    /(?:GARANT[IÍ]AS\.|garant[ií]as\s+de)([^\r\n]*)/i
  );
  if (seccionGarantiasMatch) {
    const textoGarantias = seccionGarantiasMatch[0];
    requierePoliza = true;
    confRequierePoliza = 1.0;

    if (/cumplimiento/i.test(textoGarantias)) {
      tiposPolizaDetectados.push("cumplimiento");
    }
    if (/calidad/i.test(textoGarantias)) {
      tiposPolizaDetectados.push("calidad");
    }
    if (/salarios\s+y\s+prestaciones|salarios_prestaciones/i.test(textoGarantias)) {
      tiposPolizaDetectados.push("salarios_prestaciones");
    }
    if (/responsabilidad\s+civil/i.test(textoGarantias)) {
      tiposPolizaDetectados.push("responsabilidad_civil");
    }
  } else {
    requierePoliza = false;
    confRequierePoliza = 1.0;
  }

  const tipoPoliza = tiposPolizaDetectados.join(";");
  let estadoPoliza: EstadoPoliza = requierePoliza ? "pendiente" : "no_aplica";
  if (esOtrosi && registroExistente && requierePoliza) {
    estadoPoliza = registroExistente.estado_poliza;
  }

  // 10. Resolver Comercial Remitente
  let comercialNombre: string | null = comercialMatch?.nombre ?? null;
  let confComercial = comercialMatch ? 1.0 : 0.8;

  if (!comercialMatch) {
    // Extraer nombre del remitente desde el cuerpo si firma al final (ej. "Julián Pérez, practicante comercial.")
    const firmaCuerpoMatch = correo.cuerpo.match(
      /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+),\s*practicante\s+comercial/
    );
    comercialNombre = firmaCuerpoMatch
      ? `${firmaCuerpoMatch[1]} (No registrado - ${correo.de})`
      : `No registrado (${correo.de})`;
    notas.push(
      `El correo remitente '${correo.de}' no se encuentra en comerciales.json. Según HU-3 se reporta pero no bloquea el registro.`
    );
  }

  return {
    mensaje_id: mensajeId,
    id_contrato: idContrato,
    cliente,
    nit_cliente: nitCliente,
    pais,
    objeto,
    valor,
    valor_indeterminado: valorIndeterminado,
    moneda,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    plazo_meses: plazoMeses,
    requiere_poliza: requierePoliza,
    tipo_poliza: tipoPoliza,
    estado_poliza: estadoPoliza,
    comercial: comercialNombre,
    email_remitente: correo.de,
    comercial_conocido: Boolean(comercialMatch),
    es_otrosi: esOtrosi,
    numero_otrosi: numeroOtrosi,
    adjunto_origen: adjuntoNombre,
    tiene_contrato: true,
    confianza: {
      id_contrato: confIdContrato,
      cliente: confCliente,
      nit_cliente: confNit,
      pais: confPais,
      objeto: confObjeto,
      valor: confValor,
      moneda: confMoneda,
      fecha_inicio: confFechaInicio,
      fecha_fin: confFechaFin,
      requiere_poliza: confRequierePoliza,
      tipo_poliza: confTipoPoliza,
      estado_poliza: 1.0,
      comercial: confComercial,
    },
    notas_extraccion: notas,
  };
}

// ============================================================================
// 3. VALIDAR Y CLASIFICAR (`contratos_validar`) — Reglas RN1 a RN5
// ============================================================================

function combinarConExtraccionBase(
  base: ContratoExtraido,
  overrides?: Partial<ContratoExtraido>
): ContratoExtraido {
  if (!overrides || typeof overrides !== "object") {
    return base;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (k === "confianza" || k === "mensaje_id") continue;
    if (v !== undefined && v !== null && v !== "") {
      merged[k] = v;
    }
  }
  merged.confianza = {
    ...base.confianza,
    ...(overrides.confianza ?? {}),
  };
  return merged as unknown as ContratoExtraido;
}

export function ejecutarValidarContrato(
  directory: string,
  mensajeId: string,
  contratoInput: Partial<ContratoExtraido> = {}
): ResultadoValidacion {
  asegurarEntornoSalida(directory);
  const baseExtraido = ejecutarExtraerContrato(directory, mensajeId);

  // Combinar base determinista con posibles overrides confirmados por el usuario,
  // pero manteniendo siempre las confianzas originales de la extracción determinista
  // para que `requiere_revision` refleje fielmente los campos con confianza < 0.8.
  const contrato: ContratoExtraido = combinarConExtraccionBase(baseExtraido, contratoInput);

  const comerciales = leerComerciales(directory);
  const comercialCatalogo = comerciales.find(
    (c) => c.email.toLowerCase() === (contrato.email_remitente || "").toLowerCase()
  );

  const comercialResuelto = {
    email: contrato.email_remitente,
    nombre: comercialCatalogo?.nombre ?? contrato.comercial ?? `No registrado (${contrato.email_remitente})`,
    conocido: Boolean(comercialCatalogo),
    ...(comercialCatalogo ? { region: comercialCatalogo.region } : {}),
  };

  const advertencias: string[] = [];
  if (!comercialResuelto.conocido) {
    advertencias.push(
      `Remitente '${contrato.email_remitente}' no figura en el catálogo oficial comerciales.json (resuelto como '${comercialResuelto.nombre}'). No bloquea el registro según HU-3.`
    );
  }

  // RN4: Rechazado — sin adjunto de contrato, o texto que no contiene partes ni objeto identificables
  if (
    !contrato.tiene_contrato ||
    !contrato.cliente ||
    !contrato.nit_cliente ||
    !contrato.objeto
  ) {
    return {
      mensaje_id: mensajeId,
      clasificacion: "rechazado",
      requiere_revision: [],
      detalle_revision: [],
      advertencias,
      motivo_rechazo:
        contrato.motivo_sin_contrato ||
        "El documento no contiene partes contratantes (cliente/NIT) u objeto contractual identificable (RN4).",
      comercial_resuelto: comercialResuelto,
    };
  }

  // Evaluar confianza por campo (RN5: campos con confianza < 0.8 -> requiere_revision)
  const camposEvaluables: Array<{ campo: keyof ConfianzaCampos; valor: unknown; etiqueta: string }> = [
    { campo: "id_contrato", valor: contrato.id_contrato, etiqueta: "ID del contrato" },
    { campo: "cliente", valor: contrato.cliente, etiqueta: "Cliente / Razón social" },
    { campo: "nit_cliente", valor: contrato.nit_cliente, etiqueta: "NIT / RUC del cliente" },
    { campo: "pais", valor: contrato.pais, etiqueta: "País" },
    { campo: "objeto", valor: contrato.objeto, etiqueta: "Objeto contractual" },
    { campo: "valor", valor: contrato.valor, etiqueta: "Valor del contrato" },
    { campo: "moneda", valor: contrato.moneda, etiqueta: "Moneda" },
    { campo: "fecha_inicio", valor: contrato.fecha_inicio, etiqueta: "Fecha de inicio" },
    { campo: "fecha_fin", valor: contrato.fecha_fin, etiqueta: "Fecha de finalización" },
    { campo: "requiere_poliza", valor: contrato.requiere_poliza, etiqueta: "Requiere póliza" },
  ];

  const requiereRevision: string[] = [];
  const detalleRevision: DetalleRevisionCampo[] = [];

  for (const item of camposEvaluables) {
    const score = contrato.confianza[item.campo] ?? 0;
    if (score < UMBRAL_CONFIANZA) {
      requiereRevision.push(item.campo);
      let motivo = `Confianza ${score.toFixed(2)} < ${UMBRAL_CONFIANZA} en '${item.campo}'.`;
      if (item.campo === "valor" && contrato.valor_indeterminado) {
        motivo = `Contrato por demanda / cuantía indeterminada: se propuso valor = 0 (confianza ${score.toFixed(2)} < 0.80). Requiere confirmación humana.`;
      } else if (item.campo === "fecha_fin") {
        motivo = `Fecha de finalización (${String(item.valor)}) calculada a partir de plazo en meses (${contrato.plazo_meses ?? 12} meses) con día de firma no explícito (confianza ${score.toFixed(2)} < 0.80). Requiere confirmación humana.`;
      }
      detalleRevision.push({
        campo: item.campo,
        valor_actual: item.valor,
        confianza: score,
        motivo,
      });
    }
  }

  // Cruzar contra el maestro de contratos vigente (RN1, RN2, RN3)
  const maestro = leerMaestroContratos(directory);

  // Buscar por mismo id_contrato o por mismo nit_cliente + objeto con similitud >= 0.9
  let existente = maestro.find(
    (m) =>
      contrato.id_contrato &&
      m.id_contrato.toUpperCase() === contrato.id_contrato.toUpperCase()
  );

  if (!existente && contrato.nit_cliente && contrato.objeto) {
    existente = maestro.find(
      (m) =>
        m.nit_cliente === contrato.nit_cliente &&
        calcularSimilitudTexto(m.objeto, contrato.objeto!) >= 0.9
    );
  }

  if (existente) {
    const mismoValor = Number(existente.valor) === Number(contrato.valor ?? 0);
    const mismaFechaInicio = existente.fecha_inicio === contrato.fecha_inicio;
    const mismaFechaFin = existente.fecha_fin === contrato.fecha_fin;

    // RN1: Duplicado -> mismo id_contrato y mismos valor, fecha_inicio, fecha_fin
    if (
      !contrato.es_otrosi &&
      existente.id_contrato.toUpperCase() === (contrato.id_contrato || "").toUpperCase() &&
      mismoValor &&
      mismaFechaInicio &&
      mismaFechaFin
    ) {
      return {
        mensaje_id: mensajeId,
        clasificacion: "duplicado",
        id_contrato_existente: existente.id_contrato,
        requiere_revision: [],
        detalle_revision: [],
        advertencias: [
          ...advertencias,
          `El contrato ${existente.id_contrato} (${existente.cliente}) ya existe en el maestro con idéntico valor (${existente.moneda} ${existente.valor}) y vigencia (${existente.fecha_inicio} a ${existente.fecha_fin}). Se omite escritura (RN1).`,
        ],
        comercial_resuelto: comercialResuelto,
      };
    }

    // RN2: Actualización -> mismo id_contrato (o nit + objeto >= 0.9) y algún campo distinto, o es otrosí
    const diferencias: Record<string, DiferenciaCampo> = {};
    if (Number(existente.valor) !== Number(contrato.valor ?? existente.valor)) {
      diferencias.valor = { anterior: existente.valor, nuevo: contrato.valor };
    }
    if (contrato.fecha_inicio && existente.fecha_inicio !== contrato.fecha_inicio) {
      diferencias.fecha_inicio = {
        anterior: existente.fecha_inicio,
        nuevo: contrato.fecha_inicio,
      };
    }
    if (contrato.fecha_fin && existente.fecha_fin !== contrato.fecha_fin) {
      diferencias.fecha_fin = {
        anterior: existente.fecha_fin,
        nuevo: contrato.fecha_fin,
      };
    }
    if (contrato.objeto && existente.objeto !== contrato.objeto) {
      diferencias.objeto = { anterior: existente.objeto, nuevo: contrato.objeto };
    }

    return {
      mensaje_id: mensajeId,
      clasificacion: "actualizacion",
      id_contrato_existente: existente.id_contrato,
      requiere_revision: requiereRevision,
      detalle_revision: detalleRevision,
      diferencias,
      advertencias,
      comercial_resuelto: comercialResuelto,
    };
  }

  // RN3: Nuevo -> no hay coincidencia en el maestro
  return {
    mensaje_id: mensajeId,
    clasificacion: "nuevo",
    requiere_revision: requiereRevision,
    detalle_revision: detalleRevision,
    advertencias,
    comercial_resuelto: comercialResuelto,
  };
}

// ============================================================================
// 4. REGISTRAR Y ARCHIVAR (`contratos_registrar`) — HU-4
// ============================================================================

export function ejecutarRegistrarContrato(
  directory: string,
  mensajeId: string,
  contratoOverrides: Partial<ContratoExtraido> = {},
  confirmado = false,
  fechaRegistroOverride?: string
): { ok: true; data: ResultadoRegistro } | { ok: false; error: string } {
  asegurarEntornoSalida(directory);
  const { buzonDir, sharepointDir, maestroOutPath, historialPath } = getRutasProyecto(directory);

  const extraidoBase = ejecutarExtraerContrato(directory, mensajeId);
  const contrato: ContratoExtraido = combinarConExtraccionBase(
    extraidoBase,
    contratoOverrides
  );

  const validacion = ejecutarValidarContrato(directory, mensajeId, contrato);

  // Validar clasificaciones que no deben escribir en el maestro
  if (validacion.clasificacion === "rechazado") {
    marcarMensajeProcesado(directory, mensajeId);
    return {
      ok: false,
      error: `Mensaje ${mensajeId} rechazado: ${validacion.motivo_rechazo ?? "No contiene un contrato válido."}`,
    };
  }

  if (validacion.clasificacion === "duplicado") {
    marcarMensajeProcesado(directory, mensajeId);
    return {
      ok: false,
      error: `Contrato duplicado (${validacion.id_contrato_existente}): ya existe en el maestro con idéntico valor y fechas. No se realiza escritura (RN1).`,
    };
  }

  // RN5 y HU-4: Solo escribe si `requiere_revision` está vacío O `confirmado === true`
  if (validacion.requiere_revision.length > 0 && !confirmado) {
    const detalles = validacion.detalle_revision
      .map((d) => `${d.campo}=${JSON.stringify(d.valor_actual)} (confianza ${d.confianza})`)
      .join(", ");
    return {
      ok: false,
      error: `requiere revisión: [${validacion.requiere_revision.join(", ")}] — ${detalles}. Confirme explícitamente con confirmado=true para registrar.`,
    };
  }

  const maestro = leerMaestroContratos(directory);
  const anioInicio = (contrato.fecha_inicio || "2026-01-01").slice(0, 4);
  const idContratoFinal =
    contrato.id_contrato ||
    validacion.id_contrato_existente ||
    `AUTO-${anioInicio}-${String(maestro.length + 1).padStart(3, "0")}`;

  const clienteFinal = contrato.cliente || "Cliente Desconocido";
  const slugCliente = generarClienteSlug(clienteFinal);

  // Copiar archivo adjunto a out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>
  const adjuntoOrigenNombre = contrato.adjunto_origen || "contrato.txt";
  const ext = path.extname(adjuntoOrigenNombre) || ".txt";
  const rutaRelativaSharepoint = `Contratos/${anioInicio}/${slugCliente}/${idContratoFinal}${ext}`;
  const rutaAbsolutaDestino = path.join(sharepointDir, rutaRelativaSharepoint);

  fs.mkdirSync(path.dirname(rutaAbsolutaDestino), { recursive: true });
  const rutaAdjuntoOrigen = path.join(buzonDir, mensajeId, adjuntoOrigenNombre);
  if (fs.existsSync(rutaAdjuntoOrigen)) {
    fs.copyFileSync(rutaAdjuntoOrigen, rutaAbsolutaDestino);
  }

  // Resolver fecha_registro (fecha del correo o fecha provista)
  const correoPath = path.join(buzonDir, mensajeId, "correo.json");
  const correo = fs.existsSync(correoPath)
    ? (JSON.parse(fs.readFileSync(correoPath, "utf-8")) as CorreoRaw)
    : null;
  const fechaRegistro =
    fechaRegistroOverride || (correo?.fecha ? correo.fecha.slice(0, 10) : "2026-09-03");

  if (validacion.clasificacion === "actualizacion") {
    const idx = maestro.findIndex(
      (f) => f.id_contrato.toUpperCase() === idContratoFinal.toUpperCase()
    );
    if (idx === -1) {
      return {
        ok: false,
        error: `No se encontró el contrato base ${idContratoFinal} para aplicar la actualización.`,
      };
    }

    const anterior = { ...maestro[idx] };
    const cambios: Record<string, DiferenciaCampo> = {};

    const nuevoValor =
      contrato.valor !== null && contrato.valor !== undefined
        ? Number(contrato.valor)
        : anterior.valor;
    const nuevaFechaFin = contrato.fecha_fin || anterior.fecha_fin;
    const nuevaFechaInicio = contrato.fecha_inicio || anterior.fecha_inicio;
    const nuevoObjeto = contrato.objeto || anterior.objeto;

    if (nuevoValor !== anterior.valor) {
      cambios.valor = { anterior: anterior.valor, nuevo: nuevoValor };
    }
    if (nuevaFechaFin !== anterior.fecha_fin) {
      cambios.fecha_fin = { anterior: anterior.fecha_fin, nuevo: nuevaFechaFin };
    }
    if (nuevaFechaInicio !== anterior.fecha_inicio) {
      cambios.fecha_inicio = { anterior: anterior.fecha_inicio, nuevo: nuevaFechaInicio };
    }
    if (nuevoObjeto !== anterior.objeto) {
      cambios.objeto = { anterior: anterior.objeto, nuevo: nuevoObjeto };
    }

    const filaActualizada: FilaMaestroContrato = {
      ...anterior,
      valor: nuevoValor,
      fecha_inicio: nuevaFechaInicio,
      fecha_fin: nuevaFechaFin,
      objeto: nuevoObjeto,
      ruta_sharepoint: rutaRelativaSharepoint,
      fecha_registro: anterior.fecha_registro,
      fuente: "buzon",
    };

    maestro[idx] = filaActualizada;
    escribirMaestroContratos(directory, maestro);

    const historialEntry: EntradaHistorial = {
      ts: new Date().toISOString(),
      id_contrato: idContratoFinal,
      accion: "actualizacion",
      cambios,
      mensaje_id: mensajeId,
    };
    fs.appendFileSync(historialPath, JSON.stringify(historialEntry) + "\n", "utf-8");
    marcarMensajeProcesado(directory, mensajeId);

    return {
      ok: true,
      data: {
        id_contrato: idContratoFinal,
        accion: "actualizacion",
        ruta_archivo: `out/sharepoint/${rutaRelativaSharepoint}`,
        ruta_maestro: path.relative(directory, maestroOutPath).replace(/\\/g, "/"),
        cambios,
        fila: filaActualizada,
      },
    };
  }

  // Caso `nuevo`
  const comercialParaMaestro = validacion.comercial_resuelto.nombre;
  const requierePoliza = Boolean(contrato.requiere_poliza);
  const nuevaFila: FilaMaestroContrato = {
    id_contrato: idContratoFinal,
    cliente: clienteFinal,
    nit_cliente: contrato.nit_cliente || "",
    pais: (contrato.pais || "CO") as PaisContrato,
    objeto: contrato.objeto || "",
    valor: Number(contrato.valor ?? 0),
    moneda: (contrato.moneda || "COP") as MonedaContrato,
    fecha_inicio: contrato.fecha_inicio || fechaRegistro,
    fecha_fin: contrato.fecha_fin || fechaRegistro,
    requiere_poliza: requierePoliza,
    tipo_poliza: requierePoliza ? contrato.tipo_poliza || "cumplimiento" : "",
    estado_poliza: requierePoliza ? "pendiente" : "no_aplica",
    comercial: comercialParaMaestro,
    ruta_sharepoint: rutaRelativaSharepoint,
    fecha_registro: fechaRegistro,
    fuente: "buzon",
  };

  maestro.push(nuevaFila);
  escribirMaestroContratos(directory, maestro);

  const cambiosCreacion: Record<string, DiferenciaCampo> = {
    estado_registro: { anterior: null, nuevo: "creado" },
    valor: { anterior: null, nuevo: nuevaFila.valor },
    fecha_inicio: { anterior: null, nuevo: nuevaFila.fecha_inicio },
    fecha_fin: { anterior: null, nuevo: nuevaFila.fecha_fin },
  };

  const historialEntry: EntradaHistorial = {
    ts: new Date().toISOString(),
    id_contrato: idContratoFinal,
    accion: "nuevo",
    cambios: cambiosCreacion,
    mensaje_id: mensajeId,
  };
  fs.appendFileSync(historialPath, JSON.stringify(historialEntry) + "\n", "utf-8");
  marcarMensajeProcesado(directory, mensajeId);

  return {
    ok: true,
    data: {
      id_contrato: idContratoFinal,
      accion: "nuevo",
      ruta_archivo: `out/sharepoint/${rutaRelativaSharepoint}`,
      ruta_maestro: path.relative(directory, maestroOutPath).replace(/\\/g, "/"),
      cambios: cambiosCreacion,
      fila: nuevaFila,
    },
  };
}

// ============================================================================
// 5. GENERAR REPORTE DE ALERTAS (`contratos_alertas`) — HU-5
// ============================================================================

export function ejecutarGenerarAlertas(
  directory: string,
  hoy: string
): ResultadoAlertas {
  asegurarEntornoSalida(directory);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) {
    throw new Error(`La fecha de referencia 'hoy' (${hoy}) debe tener formato YYYY-MM-DD.`);
  }

  const refTime = new Date(`${hoy}T00:00:00Z`).getTime();
  if (Number.isNaN(refTime)) {
    throw new Error(`Fecha inválida: ${hoy}`);
  }

  const { alertasPath, historialPath } = getRutasProyecto(directory);
  const maestro = leerMaestroContratos(directory);

  const vencen: ContratoPorVencer[] = [];
  const vencidosHistoricos: ContratoVencido[] = [];
  const polizasPendientes: FilaMaestroContrato[] = [];
  const registradosDesdeCorte: FilaMaestroContrato[] = [];

  for (const fila of maestro) {
    const finTime = new Date(`${fila.fecha_fin}T00:00:00Z`).getTime();
    const diffDias = Math.round((finTime - refTime) / (1000 * 60 * 60 * 24));

    if (diffDias >= 0 && diffDias <= 60) {
      vencen.push({ ...fila, dias_restantes: diffDias });
    } else if (diffDias < 0) {
      vencidosHistoricos.push({ ...fila, dias_vencido: Math.abs(diffDias) });
    }

    if (fila.requiere_poliza && fila.estado_poliza !== "vigente") {
      polizasPendientes.push(fila);
    }

    if (fila.fecha_registro > FECHA_CORTE_MAESTRO) {
      registradosDesdeCorte.push(fila);
    }
  }

  vencen.sort((a, b) => a.dias_restantes - b.dias_restantes);
  vencidosHistoricos.sort((a, b) => b.dias_vencido - a.dias_vencido);

  // Leer actualizaciones en historial.jsonl (ej. otrosíes como msg-003)
  const actualizadosDesdeCorte: EntradaHistorial[] = [];
  if (fs.existsSync(historialPath)) {
    const lines = fs
      .readFileSync(historialPath, "utf-8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as EntradaHistorial;
        if (parsed.accion === "actualizacion") {
          actualizadosDesdeCorte.push(parsed);
        }
      } catch {
        // Ignorar líneas malformadas
      }
    }
  }

  const formatMoneda = (valor: number, moneda: string) =>
    valor === 0 ? `${moneda} 0 (Por demanda)` : `${moneda} ${valor.toLocaleString("es-CO")}`;

  const mdLines: string[] = [
    `# Reporte Ejecutivo de Alertas y Control de Contratos — Periferia IT Group`,
    ``,
    `- **Fecha de corte de análisis (\`hoy\`)**: \`${hoy}\``,
    `- **Fecha de congelamiento histórico anterior**: \`${FECHA_CORTE_MAESTRO}\``,
    `- **Total contratos en el maestro**: **${maestro.length}**`,
    ``,
    `---`,
    ``,
    `## 1. Contratos que vencen en ≤ 60 días (ventana ${hoy} a +60 días)`,
    ``,
  ];

  if (vencen.length === 0) {
    mdLines.push(`_No hay contratos que venzan en los próximos 60 días._`, ``);
  } else {
    mdLines.push(
      `| ID Contrato | Cliente | País | Valor | Fecha Fin | Días Restantes | Comercial | Estado Póliza |`,
      `|---|---|---|---|---|---:|---|---|`
    );
    for (const c of vencen) {
      mdLines.push(
        `| **${c.id_contrato}** | ${c.cliente} | ${c.pais} | ${formatMoneda(c.valor, c.moneda)} | \`${c.fecha_fin}\` | **${c.dias_restantes} días** | ${c.comercial} | \`${c.estado_poliza}\` |`
      );
    }
    mdLines.push(``);
  }

  if (vencidosHistoricos.length > 0) {
    mdLines.push(
      `### 1.1 Contratos con fecha de fin anterior a ${hoy} (vencidos en el maestro histórico)`,
      ``,
      `| ID Contrato | Cliente | Fecha Fin | Días desde vencimiento | Comercial | Observación |`,
      `|---|---|---|---:|---|---|`
    );
    for (const v of vencidosHistoricos) {
      mdLines.push(
        `| **${v.id_contrato}** | ${v.cliente} | \`${v.fecha_fin}\` | ${v.dias_vencido} días | ${v.comercial} | Verificar acta de cierre o renovación |`
      );
    }
    mdLines.push(``);
  }

  mdLines.push(
    `---`,
    ``,
    `## 2. Pólizas pendientes de constitución o renovación (\`requiere_poliza = true\` y \`estado_poliza != vigente\`)`,
    ``
  );

  if (polizasPendientes.length === 0) {
    mdLines.push(`_Todas las pólizas exigibles se encuentran vigentes._`, ``);
  } else {
    mdLines.push(
      `| ID Contrato | Cliente | País | Valor | Tipo de Póliza | Estado Póliza | Vigencia Contrato | Comercial |`,
      `|---|---|---|---|---|---|---|---|`
    );
    for (const p of polizasPendientes) {
      mdLines.push(
        `| **${p.id_contrato}** | ${p.cliente} | ${p.pais} | ${formatMoneda(p.valor, p.moneda)} | \`${p.tipo_poliza}\` | **\`${p.estado_poliza}\`** | \`${p.fecha_inicio}\` → \`${p.fecha_fin}\` | ${p.comercial} |`
      );
    }
    mdLines.push(``);
  }

  mdLines.push(
    `---`,
    ``,
    `## 3. Contratos registrados y actualizados desde el corte del ${FECHA_CORTE_MAESTRO} (Gap cubierto)`,
    ``
  );

  if (registradosDesdeCorte.length === 0) {
    mdLines.push(`_No se han registrado contratos posteriores al ${FECHA_CORTE_MAESTRO}._`, ``);
  } else {
    mdLines.push(
      `| ID Contrato | Cliente | País | Objeto | Valor | Vigencia | Fecha Registro | Archivo SharePoint |`,
      `|---|---|---|---|---|---|---|---|`
    );
    for (const r of registradosDesdeCorte) {
      mdLines.push(
        `| **${r.id_contrato}** | ${r.cliente} | ${r.pais} | ${r.objeto} | ${formatMoneda(r.valor, r.moneda)} | \`${r.fecha_inicio}\` → \`${r.fecha_fin}\` | \`${r.fecha_registro}\` | \`${r.ruta_sharepoint}\` |`
      );
    }
    mdLines.push(``);
  }

  if (actualizadosDesdeCorte.length > 0) {
    mdLines.push(
      `### 3.1 Modificaciones contractuales (Otrosíes) aplicadas en el periodo`,
      ``,
      `| ID Contrato | Mensaje Origen | Cambios Aplicados | Timestamp |`,
      `|---|---|---|---|`
    );
    for (const act of actualizadosDesdeCorte) {
      const descCambios = Object.entries(act.cambios)
        .map(([k, v]) => `\`${k}\`: ${JSON.stringify(v.anterior)} → ${JSON.stringify(v.nuevo)}`)
        .join("; ");
      mdLines.push(
        `| **${act.id_contrato}** | \`${act.mensaje_id}\` | ${descCambios} | \`${act.ts}\` |`
      );
    }
    mdLines.push(``);
  }

  const markdown = mdLines.join("\n");
  fs.writeFileSync(alertasPath, markdown, "utf-8");

  return {
    hoy,
    ruta: "out/alertas.md",
    vencen,
    vencidos_historicos: vencidosHistoricos,
    polizas_pendientes: polizasPendientes,
    registrados_desde_corte: registradosDesdeCorte,
    actualizados_desde_corte: actualizadosDesdeCorte,
    resumen_ejecutivo: {
      total_contratos_maestro: maestro.length,
      vencen_60_dias: vencen.length,
      vencidos_sin_renovar: vencidosHistoricos.length,
      polizas_pendientes: polizasPendientes.length,
      nuevos_desde_corte: registradosDesdeCorte.length,
      actualizaciones_desde_corte: actualizadosDesdeCorte.length,
    },
  };
}

// ============================================================================
// 6. LEER PDF O ARCHIVO DE TEXTO (`contratos_leer_pdf` - P1)
// ============================================================================

export function ejecutarLeerDocumento(
  directory: string,
  rutaRelativa: string
): { ruta: string; texto: string; formato: string } {
  const baseDir = path.resolve(directory);
  const targetPath = path.resolve(baseDir, rutaRelativa);

  // Seguridad: impedir path traversal fuera del directorio del proyecto
  if (!targetPath.startsWith(baseDir)) {
    throw new Error("Acceso denegado: la ruta solicitada está fuera del directorio del proyecto.");
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`No existe el archivo en la ruta '${rutaRelativa}'.`);
  }

  const ext = path.extname(targetPath).toLowerCase();
  const buffer = fs.readFileSync(targetPath);

  if (ext === ".pdf") {
    // Extracción determinista de cadenas de texto embebidas en flujos PDF nativos
    const rawLatin = buffer.toString("latin1");
    const bloquesTexto: string[] = [];
    const regexParentesis = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
    let match: RegExpExecArray | null;
    while ((match = regexParentesis.exec(rawLatin)) !== null) {
      bloquesTexto.push(match[1]);
    }
    const textoExtraido =
      bloquesTexto.length > 0
        ? bloquesTexto.join(" ").replace(/\\([()\\])/g, "$1")
        : buffer.toString("utf-8");
    return {
      ruta: rutaRelativa,
      texto: textoExtraido.trim(),
      formato: "pdf-nativo",
    };
  }

  return {
    ruta: rutaRelativa,
    texto: buffer.toString("utf-8").trim(),
    formato: ext.replace(/^\./, "") || "txt",
  };
}
