---
name: registro-contratos
description: Reglas de negocio, umbrales de confianza, normalización de campos y alertas para el registro maestro de contratos vigentes de Periferia IT Group.
---
# Conocimiento del Proceso: Registro y Gobierno de Contratos Vigentes

## 1. Contexto Operativo de Periferia IT Group
- El registro maestro histórico (`maestro-contratos.csv`) estuvo congelado desde el **30 de mayo de 2026** (`2026-05-30`).
- Todos los contratos vigentes, requieren o no póliza, deben centralizarse en `out/sharepoint/maestro-contratos.csv` con copia documental en `out/sharepoint/Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>` y trazabilidad inmutable en `out/sharepoint/historial.jsonl`.

## 2. Reglas de Clasificación y Validación (RN1 – RN5)
- **RN1 · Duplicado (`duplicado`)**: Mismo `id_contrato` y mismos `valor`, `fecha_inicio` y `fecha_fin` que una fila existente en el maestro. No se escribe en el maestro ni se duplica fila.
- **RN2 · Actualización (`actualizacion`)**: Mismo `id_contrato` (o mismo `nit_cliente` + `objeto` con similitud $\ge 0.90$) con cambios en `valor`, `fecha_fin` u otro atributo, o documento identificado explícitamente como **Otrosí**. Modifica la fila existente en el maestro y agrega un registro de auditoría en `out/sharepoint/historial.jsonl`.
- **RN3 · Nuevo (`nuevo`)**: Contrato válido sin coincidencia previa en el maestro. Se inserta una nueva fila. Si `requiere_poliza = true`, su `estado_poliza` inicial es `pendiente`; si no requiere póliza, es `no_aplica`.
- **RN4 · Rechazado (`rechazado`)**: Correo sin adjunto de contrato (por ejemplo, cotizaciones u ofertas comerciales aún no firmadas) o texto sin partes ni objeto identificables. Se rechaza con motivo explícito sin tocar el maestro.
- **RN5 · Umbral de Confianza y Revisión Humana (`requiere_revision`)**: Todo campo con `confianza < 0.80` se incluye en `requiere_revision`. `contratos_registrar` bloquea la escritura a menos que `confirmado = true`.

## 3. Reglas de Normalización de Campos (Sección 7.2)
- `id_contrato`: Número oficial en el documento (`CT-YYYY-NNN`, `CM-YYYY-NN`). Si no existiera, `AUTO-<año>-<secuencia>`.
- `nit_cliente`: Identificador tributario (NIT en Colombia, RUC en Ecuador/Perú/Panamá, RTN en Honduras) sin puntos ni dígito de verificación (`890.900.111-4` $\rightarrow$ `890900111`).
- `pais`: Código ISO `CO | EC | PE | PA | HN`.
- `valor`: Entero sin separadores. En contratos marco por demanda (`valor_indeterminado = true`), se asigna `0` con confianza $< 0.80$ para que la analista confirme antes de registrar.
- `fecha_inicio` / `fecha_fin`: Formato ISO `YYYY-MM-DD`. Si `fecha_fin` se calcula a partir de un plazo en meses sobre una fecha de firma sin día exacto, se marca con confianza $< 0.80$ para confirmación humana.
- `comercial`: Se cruza el correo remitente (`de`) contra `fixtures/reto-02/comerciales.json`. Si el remitente no está en el catálogo (ej. un practicante comercial), se reporta como advertencia pero **no bloquea** el registro (HU-3).

## 4. Criterios de Alertas (`contratos_alertas`)
1. **Vencimiento próximo**: Contratos cuya `fecha_fin` ocurre en $\le 60$ días calendario desde la fecha de referencia `hoy`.
2. **Riesgo de Pólizas**: Contratos con `requiere_poliza = true` y `estado_poliza != "vigente"` (por ejemplo, `pendiente` o `vencida`).
3. **Cierre de Brecha (Gap)**: Contratos registrados con `fecha_registro > "2026-05-30"` y otrosíes aplicados en `historial.jsonl`.

