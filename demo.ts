import * as fs from "node:fs";
import * as path from "node:path";
import {
  alertas as contratos_alertas,
  extraer as contratos_extraer,
  leer_buzon as contratos_leer_buzon,
  registrar as contratos_registrar,
  validar as contratos_validar,
} from "./src/tools/contratos.ts";
import type {
  ContratoExtraido,
  MensajeBuzonItem,
  ResultadoAlertas,
  ResultadoRegistro,
  ResultadoValidacion,
} from "./src/services/contratos-engine.ts";

interface ToolResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function parseRes<T>(raw: string): ToolResponse<T> {
  return JSON.parse(raw) as ToolResponse<T>;
}

async function main() {
  const directory = process.cwd();
  const ctx = { directory, sessionId: "demo-verificacion-determinista" };
  const fechaHoy = "2026-09-03";

  // Requisito No Funcional (Sección 8): out/ se limpia al inicio para garantizar determinismo idempotente
  const outDir = path.join(directory, "out");
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  console.log("================================================================================");
  console.log("  PERIFERIA IT GROUP · RETO 02: VERIFICACIÓN DETERMINISTA SIN MODELO (demo.ts)");
  console.log("================================================================================");
  console.log(`Directorio raíz : ${directory}`);
  console.log(`Fecha corte hoy : ${fechaHoy}`);
  console.log(`Estado out/     : Limpiado e inicializado desde fixtures/reto-02/maestro-contratos.csv\n`);

  // 1. Leer el buzón completo
  const resBuzon = parseRes<{ mensajes: MensajeBuzonItem[] }>(
    await contratos_leer_buzon.execute({}, ctx)
  );
  if (!resBuzon.ok || !resBuzon.data) {
    console.error("Error fatal leyendo buzón:", resBuzon.error);
    process.exit(1);
  }

  const mensajes = resBuzon.data.mensajes;
  console.log(`[1] LECTURA DE BUZÓN (contratos_leer_buzon): ${mensajes.length} mensajes encontrados.\n`);

  const pendientesConfirmacion: Array<{
    mensaje_id: string;
    contrato: ContratoExtraido;
    validacion: ResultadoValidacion;
  }> = [];

  // 2. Primera pasada: Procesar los 6 mensajes en orden
  console.log("--------------------------------------------------------------------------------");
  console.log("  PRIMERA PASADA: EXTRACCIÓN, VALIDACIÓN Y REGISTRO AUTOMÁTICO (SIN CONFIRMAR)");
  console.log("--------------------------------------------------------------------------------");

  for (const msg of mensajes) {
    console.log(`\n>>> Procesando [${msg.id}] | De: ${msg.de} | Asunto: "${msg.asunto}"`);
    console.log(`    Adjuntos: [${msg.adjuntos.join(", ")}] | tiene_contrato: ${msg.tiene_contrato}`);

    // Llamar a contratos_extraer
    const resExtraer = parseRes<ContratoExtraido>(
      await contratos_extraer.execute({ mensaje_id: msg.id }, ctx)
    );
    if (!resExtraer.ok || !resExtraer.data) {
      console.log(`    [ERROR EXTRACCIÓN]: ${resExtraer.error}`);
      continue;
    }
    const contrato = resExtraer.data;

    // Llamar a contratos_validar
    const resValidar = parseRes<ResultadoValidacion>(
      await contratos_validar.execute({ mensaje_id: msg.id, contrato }, ctx)
    );
    if (!resValidar.ok || !resValidar.data) {
      console.log(`    [ERROR VALIDACIÓN]: ${resValidar.error}`);
      continue;
    }
    const val = resValidar.data;

    console.log(`    • Clasificación      : ${val.clasificacion.toUpperCase()}`);
    console.log(
      `    • Campos en revisión : ${
        val.requiere_revision.length > 0 ? val.requiere_revision.join(", ") : "Ninguno (confianza >= 0.8)"
      }`
    );

    if (val.advertencias.length > 0) {
      for (const adv of val.advertencias) {
        console.log(`    • Advertencia        : ${adv}`);
      }
    }

    if (val.clasificacion === "rechazado") {
      // Marcar rechazado intentando registrar (devuelve error controlado y marca procesado)
      const resReg = parseRes<ResultadoRegistro>(
        await contratos_registrar.execute({ mensaje_id: msg.id, contrato, confirmado: false }, ctx)
      );
      console.log(`    • Acción tomada      : RECHAZADO SIN ESCRITURA — ${val.motivo_rechazo ?? resReg.error}`);
      continue;
    }

    if (val.clasificacion === "duplicado") {
      const resReg = parseRes<ResultadoRegistro>(
        await contratos_registrar.execute({ mensaje_id: msg.id, contrato, confirmado: false }, ctx)
      );
      console.log(
        `    • Acción tomada      : DUPLICADO IGNORADO (${val.id_contrato_existente}) — Sin escritura en maestro (${resReg.error})`
      );
      continue;
    }

    // Intentar registrar con confirmado: false en la primera pasada
    const resRegistrar = parseRes<ResultadoRegistro>(
      await contratos_registrar.execute(
        { mensaje_id: msg.id, contrato, confirmado: false },
        ctx
      )
    );

    if (resRegistrar.ok && resRegistrar.data) {
      const reg = resRegistrar.data;
      if (reg.accion === "actualizacion") {
        console.log(
          `    • Acción tomada      : ACTUALIZADO en maestro (${reg.id_contrato}) -> Archivo: ${reg.ruta_archivo}`
        );
        console.log(`    • Cambios aplicados  : ${JSON.stringify(reg.cambios)}`);
      } else {
        console.log(
          `    • Acción tomada      : REGISTRADO NUEVO (${reg.id_contrato}) | Estado póliza: ${reg.fila?.estado_poliza} -> Archivo: ${reg.ruta_archivo}`
        );
      }
    } else {
      console.log(`    • Acción tomada      : DETENIDO (HITL) — ${resRegistrar.error}`);
      pendientesConfirmacion.push({
        mensaje_id: msg.id,
        contrato,
        validacion: val,
      });
    }
  }

  // 3. Segunda pasada: Confirmación humana (HITL) para mensajes retenidos (msg-006)
  console.log("\n--------------------------------------------------------------------------------");
  console.log("  SEGUNDA PASADA: CONFIRMACIÓN HUMANA EXPLÍCITA (confirmado = true)");
  console.log("--------------------------------------------------------------------------------");

  for (const item of pendientesConfirmacion) {
    console.log(
      `\n>>> Confirmando [${item.mensaje_id}] (${item.contrato.id_contrato} - ${item.contrato.cliente})`
    );
    for (const det of item.validacion.detalle_revision) {
      console.log(
        `    • Campo revisado: ${det.campo} = ${JSON.stringify(det.valor_actual)} (confianza=${det.confianza}) -> CONFIRMADO POR ANALISTA`
      );
    }

    const resConfirmado = parseRes<ResultadoRegistro>(
      await contratos_registrar.execute(
        {
          mensaje_id: item.mensaje_id,
          contrato: {
            ...item.contrato,
            valor: 0,
            fecha_fin: "2027-08-31",
          },
          confirmado: true,
        },
        ctx
      )
    );

    if (resConfirmado.ok && resConfirmado.data) {
      console.log(
        `    • Acción tomada : REGISTRADO TRAS CONFIRMACIÓN (${resConfirmado.data.id_contrato}) -> Archivo: ${resConfirmado.data.ruta_archivo}`
      );
    } else {
      console.log(`    • Error al confirmar: ${resConfirmado.error}`);
    }
  }

  // 4. Generar reporte de alertas con hoy = "2026-09-03"
  console.log("\n--------------------------------------------------------------------------------");
  console.log(`  REPORTE DE ALERTAS DE VENCIMIENTO Y PÓLIZAS (hoy = ${fechaHoy})`);
  console.log("--------------------------------------------------------------------------------");

  const resAlertas = parseRes<ResultadoAlertas>(
    await contratos_alertas.execute({ hoy: fechaHoy }, ctx)
  );
  if (resAlertas.ok && resAlertas.data) {
    const a = resAlertas.data;
    console.log(`• Archivo generado               : ${a.ruta}`);
    console.log(`• Total contratos en el maestro  : ${a.resumen_ejecutivo.total_contratos_maestro}`);
    console.log(
      `• Vencen en <= 60 días           : ${a.vencen.length} (${a.vencen
        .map((c) => `${c.id_contrato} en ${c.dias_restantes}d`)
        .join(", ")})`
    );
    console.log(
      `• Pólizas pendientes (!=vigente) : ${a.polizas_pendientes.length} (${a.polizas_pendientes
        .map((p) => `${p.id_contrato} [${p.estado_poliza}]`)
        .join(", ")})`
    );
    console.log(
      `• Nuevos desde corte 2026-05-30  : ${a.registrados_desde_corte.length} (${a.registrados_desde_corte
        .map((r) => r.id_contrato)
        .join(", ")})`
    );
    console.log(
      `• Otrosíes aplicados en historial: ${a.actualizados_desde_corte.length} (${a.actualizados_desde_corte
        .map((u) => u.id_contrato)
        .join(", ")})`
    );
  } else {
    console.error("Error generando alertas:", resAlertas.error);
  }

  console.log("\n================================================================================");
  console.log("  DEMO COMPLETADA EXITOSAMENTE. Artefactos escritos en out/ y out/sharepoint/");
  console.log("================================================================================");
}

main();

