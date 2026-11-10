import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as appTools from "../src/tools/contratos.ts";
import * as moduloTools from "../modulo/tools/contratos.ts";
import { handleRequest, ejecutarTurnoAgente } from "../src/server.ts";
import {
  leerMaestroContratos,
  type ContratoExtraido,
  type ResultadoAlertas,
  type ResultadoRegistro,
  type ResultadoValidacion,
} from "../src/services/contratos-engine.ts";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "out");
const FIXTURE_MAESTRO = path.join(ROOT, "fixtures", "reto-02", "maestro-contratos.csv");

describe("Reto 02 · Suite de Verificación End-to-End (Motor, Herramientas, Agente y Módulo)", () => {
  const fixtureOriginalContent = fs.readFileSync(FIXTURE_MAESTRO, "utf-8");

  beforeEach(() => {
    if (fs.existsSync(OUT_DIR)) {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
    }
  });

  test("HU-1 a HU-5: Procesamiento determinista de los 6 casos del buzón y protección del fixture", async () => {
    const ctx = { directory: ROOT, sessionId: "test-suite" };

    // 1. Leer buzón
    const buzonRes = JSON.parse(await appTools.leer_buzon.execute({}, ctx));
    expect(buzonRes.ok).toBe(true);
    expect(buzonRes.data.mensajes.length).toBe(6);

    // msg-005 no tiene contrato (es cotización)
    const m005 = buzonRes.data.mensajes.find((m: { id: string }) => m.id === "msg-005");
    expect(m005.tiene_contrato).toBe(false);

    // 2. msg-001: Contrato nuevo con póliza de cumplimiento -> nuevo, pendiente
    const ext001 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-001" }, ctx))
      .data as ContratoExtraido;
    expect(ext001.id_contrato).toBe("CT-2026-015");
    expect(ext001.nit_cliente).toBe("890900111");
    expect(ext001.valor).toBe(265000000);
    expect(ext001.requiere_poliza).toBe(true);

    const val001 = JSON.parse(
      await appTools.validar.execute({ mensaje_id: "msg-001", contrato: ext001 }, ctx)
    ).data as ResultadoValidacion;
    expect(val001.clasificacion).toBe("nuevo");
    expect(val001.requiere_revision).toEqual([]);

    const reg001 = JSON.parse(
      await appTools.registrar.execute(
        { mensaje_id: "msg-001", contrato: ext001, confirmado: false },
        ctx
      )
    );
    expect(reg001.ok).toBe(true);
    expect((reg001.data as ResultadoRegistro).fila?.estado_poliza).toBe("pendiente");

    // 3. msg-002: Contrato nuevo sin póliza (Ecuador, USD 120000) -> nuevo, no_aplica
    const ext002 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-002" }, ctx))
      .data as ContratoExtraido;
    expect(ext002.id_contrato).toBe("CT-2026-016");
    expect(ext002.pais).toBe("EC");
    expect(ext002.requiere_poliza).toBe(false);

    const reg002 = JSON.parse(
      await appTools.registrar.execute(
        { mensaje_id: "msg-002", contrato: ext002, confirmado: false },
        ctx
      )
    );
    expect(reg002.ok).toBe(true);
    expect((reg002.data as ResultadoRegistro).fila?.estado_poliza).toBe("no_aplica");

    // 4. msg-003: Otrosí al contrato CT-2026-011 -> actualizacion (valor 520000, fecha_fin 2027-11-01)
    const ext003 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-003" }, ctx))
      .data as ContratoExtraido;
    const val003 = JSON.parse(
      await appTools.validar.execute({ mensaje_id: "msg-003", contrato: ext003 }, ctx)
    ).data as ResultadoValidacion;
    expect(val003.clasificacion).toBe("actualizacion");
    expect(val003.id_contrato_existente).toBe("CT-2026-011");

    const reg003 = JSON.parse(
      await appTools.registrar.execute(
        { mensaje_id: "msg-003", contrato: ext003, confirmado: false },
        ctx
      )
    );
    expect(reg003.ok).toBe(true);
    expect((reg003.data as ResultadoRegistro).accion).toBe("actualizacion");

    // 5. msg-004: Reenvío de CT-2026-012 -> duplicado, sin escritura
    const ext004 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-004" }, ctx))
      .data as ContratoExtraido;
    const val004 = JSON.parse(
      await appTools.validar.execute({ mensaje_id: "msg-004", contrato: ext004 }, ctx)
    ).data as ResultadoValidacion;
    expect(val004.clasificacion).toBe("duplicado");

    // 6. msg-005: Cotización sin contrato -> rechazado
    const ext005 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-005" }, ctx))
      .data as ContratoExtraido;
    const val005 = JSON.parse(
      await appTools.validar.execute({ mensaje_id: "msg-005", contrato: ext005 }, ctx)
    ).data as ResultadoValidacion;
    expect(val005.clasificacion).toBe("rechazado");

    // 7. msg-006: Contrato marco por demanda y plazo en meses -> requiere_revision (valor, fecha_fin)
    const ext006 = JSON.parse(await appTools.extraer.execute({ mensaje_id: "msg-006" }, ctx))
      .data as ContratoExtraido;
    const val006 = JSON.parse(
      await appTools.validar.execute({ mensaje_id: "msg-006", contrato: ext006 }, ctx)
    ).data as ResultadoValidacion;
    expect(val006.clasificacion).toBe("nuevo");
    expect(val006.requiere_revision).toContain("valor");
    expect(val006.requiere_revision).toContain("fecha_fin");

    // Sin confirmar debe rechazarse el registro (RN5)
    const reg006SinConfirmar = JSON.parse(
      await appTools.registrar.execute(
        { mensaje_id: "msg-006", contrato: ext006, confirmado: false },
        ctx
      )
    );
    expect(reg006SinConfirmar.ok).toBe(false);
    expect(reg006SinConfirmar.error).toContain("requiere revisión");

    // Con confirmado = true debe registrarse exitosamente
    const reg006Confirmado = JSON.parse(
      await appTools.registrar.execute(
        {
          mensaje_id: "msg-006",
          contrato: { ...ext006, valor: 0, fecha_fin: "2027-08-31" },
          confirmado: true,
        },
        ctx
      )
    );
    expect(reg006Confirmado.ok).toBe(true);
    expect((reg006Confirmado.data as ResultadoRegistro).id_contrato).toBe("CM-2026-03");

    // Verificar que el maestro en out/sharepoint tiene exactamente 11 filas (8 base + 3 nuevos, 0 duplicados)
    const maestroFinal = leerMaestroContratos(ROOT);
    expect(maestroFinal.length).toBe(11);

    // Verificar que el fixture original sigue intacto byte por byte (RN6)
    expect(fs.readFileSync(FIXTURE_MAESTRO, "utf-8")).toBe(fixtureOriginalContent);

    // 8. Alertas al 2026-09-03
    const alertasRes = JSON.parse(
      await appTools.alertas.execute({ hoy: "2026-09-03" }, ctx)
    ).data as ResultadoAlertas;
    expect(alertasRes.vencen.map((c) => c.id_contrato)).toEqual(["CT-2026-009", "CT-2026-004"]);
    expect(alertasRes.polizas_pendientes.map((p) => p.id_contrato)).toEqual([
      "CT-2026-004",
      "CT-2026-015",
      "CM-2026-03",
    ]);
    expect(alertasRes.registrados_desde_corte.map((r) => r.id_contrato)).toEqual([
      "CT-2026-015",
      "CT-2026-016",
      "CM-2026-03",
    ]);
  });

  test("Sección 11 PRD: Ciclo conversacional completo con pausa HITL y posterior confirmación", async () => {
    const sessionId = "test-hitl-session";

    // Turno 1: Procesar el buzón y detenerse ante msg-006
    const turno1 = await ejecutarTurnoAgente(
      sessionId,
      "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
      ROOT
    );

    expect(turno1.ok).toBe(true);
    expect(turno1.needsConfirmation).toBe(true);
    expect(turno1.toolCalls.length).toBeGreaterThanOrEqual(15);
    expect(turno1.reply).toContain("CM-2026-03");

    // En este punto el maestro debe tener 10 contratos (8 originales + msg-001 + msg-002; msg-006 aún no registrado)
    expect(leerMaestroContratos(ROOT).length).toBe(10);

    // Turno 2: El analista confirma msg-006
    const turno2 = await ejecutarTurnoAgente(
      sessionId,
      "confirmo el valor 0 y la fecha fin 2027-08-31",
      ROOT
    );

    expect(turno2.ok).toBe(true);
    expect(turno2.needsConfirmation).toBe(false);
    expect(leerMaestroContratos(ROOT).length).toBe(11);
  });

  test("Sección 9.4 Bonus: El módulo empaquetado en modulo/ comparte exactamente las mismas piezas que la app", () => {
    // 1. Verificar que las funciones exportadas en modulo/tools/contratos.ts son las mismas referencias
    expect(moduloTools.leer_buzon).toBe(appTools.leer_buzon);
    expect(moduloTools.extraer).toBe(appTools.extraer);
    expect(moduloTools.validar).toBe(appTools.validar);
    expect(moduloTools.registrar).toBe(appTools.registrar);
    expect(moduloTools.alertas).toBe(appTools.alertas);
    expect(moduloTools.leer_pdf).toBe(appTools.leer_pdf);

    // 2. Verificar que el cuerpo de modulo/agent.md coincide con agent/prompt.md
    const promptApp = fs.readFileSync(path.join(ROOT, "agent", "prompt.md"), "utf-8").trim();
    const agentModulo = fs.readFileSync(path.join(ROOT, "modulo", "agent.md"), "utf-8");
    const cuerpoModuloAgent = agentModulo.replace(/^---[\s\S]*?---\r?\n/, "").trim();
    expect(cuerpoModuloAgent).toBe(promptApp);

    // 3. Verificar que el cuerpo de modulo/skill/registro-contratos/SKILL.md coincide con src/knowledge/registro-contratos.md
    const skillApp = fs
      .readFileSync(path.join(ROOT, "src", "knowledge", "registro-contratos.md"), "utf-8")
      .trim();
    const skillModulo = fs.readFileSync(
      path.join(ROOT, "modulo", "skill", "registro-contratos", "SKILL.md"),
      "utf-8"
    );
    const cuerpoSkillModulo = skillModulo.replace(/^---[\s\S]*?---\r?\n/, "").trim();
    expect(cuerpoSkillModulo).toBe(skillApp);
  });

  test("Sección 6.4 PRD: Endpoints HTTP (/api/health, /api/chat, /api/sessions/:id, /api/state, /)", async () => {
    const baseUrl = "http://localhost:3000";

    // 1. GET /api/health
    const healthRes = await handleRequest(new Request(`${baseUrl}/api/health`), ROOT);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.ok).toBe(true);
    expect(healthJson.toolsRegistered).toContain("contratos_leer_buzon");
    expect(healthJson.toolsRegistered).toContain("contratos_registrar");

    // 2. GET / (Interfaz Web)
    const htmlRes = await handleRequest(new Request(`${baseUrl}/`), ROOT);
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain("Perxia 2.0");

    // 3. POST /api/chat
    const chatRes = await handleRequest(
      new Request(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "http-test-session",
          message:
            "Procesa el buzón de contratos con fecha de hoy 2026-09-03. No registres nada dudoso sin preguntarme.",
        }),
      }),
      ROOT
    );
    expect(chatRes.status).toBe(200);
    const chatJson = await chatRes.json();
    expect(chatJson.ok).toBe(true);
    expect(chatJson.needsConfirmation).toBe(true);

    // 4. GET /api/sessions/:id
    const sesRes = await handleRequest(
      new Request(`${baseUrl}/api/sessions/http-test-session`),
      ROOT
    );
    expect(sesRes.status).toBe(200);
    const sesJson = await sesRes.json();
    expect(sesJson.ok).toBe(true);
    expect(sesJson.session.needsConfirmation).toBe(true);

    // 5. POST /api/chat (Confirmación HITL por HTTP)
    const chatRes2 = await handleRequest(
      new Request(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "http-test-session",
          message: "confirmo el valor 0 y la fecha fin 2027-08-31",
        }),
      }),
      ROOT
    );
    expect(chatRes2.status).toBe(200);
    const chatJson2 = await chatRes2.json();
    expect(chatJson2.ok).toBe(true);
    expect(chatJson2.needsConfirmation).toBe(false);

    // 6. GET /api/state (Verificar 11 contratos en el maestro)
    const stateRes = await handleRequest(new Request(`${baseUrl}/api/state`), ROOT);
    expect(stateRes.status).toBe(200);
    const stateJson = await stateRes.json();
    expect(stateJson.ok).toBe(true);
    expect(stateJson.maestro.length).toBe(11);

    // 7. POST /api/llm-config (Configurar API Key desde el front sin exponer la clave en respuestas)
    const cfgRes = await handleRequest(
      new Request(`${baseUrl}/api/llm-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          apiKey: "AIzaSyTestDummyKey12345",
          model: "gemini-2.5-flash",
        }),
      }),
      ROOT
    );
    expect(cfgRes.status).toBe(200);
    const cfgJson = await cfgRes.json();
    expect(cfgJson.ok).toBe(true);
    expect(cfgJson.provider).toBe("gemini");
    expect(cfgJson.model).toBe("gemini-2.5-flash");
    expect(cfgJson.hasCustomKey).toBe(true);
    expect(JSON.stringify(cfgJson)).not.toContain("AIzaSyTestDummyKey12345");

    // Restaurar modo local tras la prueba
    await handleRequest(
      new Request(`${baseUrl}/api/llm-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "local", apiKey: "" }),
      }),
      ROOT
    );
  });
});
