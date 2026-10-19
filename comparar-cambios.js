// =========================================================================
// COMPARAR CAMBIOS DE MÓDULOS Y COMPONENTES (UI) — solo manager
// Lee CambioModulos.xlsx y lo compara con:
//  A) componentes_retirados (hoja CE-LE-BA)  -> cambios de componentes en campo
//  B) historial_equipo      (hoja Cambios MC) -> vida del equipo por IMEI
// Nunca pisa datos existentes. Requiere sql/73-cambios-historicos-excel.sql
// =========================================================================

const CBU_MAX = 300;
let cbuA = null, cbuB = null, cbuEquipos = [];

const cbuArchivo = document.getElementById("cb-archivo");
const cbuBtn = document.getElementById("cb-analizar");
const cbuSalida = document.getElementById("cb-salida");
const cbuEstado = document.getElementById("cb-estado");

cbuArchivo.addEventListener("change", () => { cbuBtn.disabled = !cbuArchivo.files.length; });

const cbuEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cbuF = v => (v === null || v === undefined || v === "") ? "—" : v;

function cbuLeerLibro(archivo) {
  return new Promise((resolve, reject) => {
    const l = new FileReader();
    l.onload = e => { try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true })); } catch (err) { reject(err); } };
    l.onerror = () => reject(new Error("No se pudo leer el archivo"));
    l.readAsArrayBuffer(archivo);
  });
}

async function cbuLeerTabla(tabla, columnas, filtro) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    let q = supabaseClient.from(tabla).select(columnas).range(desde, desde + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    todas.push(...data);
    if (data.length < 1000) break;
  }
  return todas;
}

cbuBtn.addEventListener("click", async () => {
  cbuBtn.disabled = true;
  cbuSalida.innerHTML = "";
  cbuEstado.textContent = "Leyendo el Excel...";
  try {
    const libro = await cbuLeerLibro(cbuArchivo.files[0]);
    const hA = libro.Sheets["CE-LE-BA"], hB = libro.Sheets["Cambios MC"];
    if (!hA || !hB) throw new Error('No encuentro las hojas "CE-LE-BA" y "Cambios MC". ¿Es el archivo CambioModulos?');
    const filasA = XLSX.utils.sheet_to_json(hA, { defval: null, raw: true }).map(f => ({ Cliente: f["Cliente"], Fecha: f["Fecha"], MC: f["MC"], "Serial viejo": f["Serial viejo"], "Serial nuevo": f["Serial nuevo"] }));
    const filasB = XLSX.utils.sheet_to_json(hB, { defval: null, raw: true });
    const archA = cbLeerComponentes(filasA);
    const archB = cbLeerCambiosMC(filasB);

    cbuEstado.textContent = "Leyendo lo que ya hay en el sistema...";
    const db = await cbuLeerTabla("componentes_retirados", "id,fecha,m_control,tipo_componente,serial_retirado,serial_nuevo,destino");
    const eventos = await cbuLeerTabla("historial_equipo", "id,imei,mc,mc_anterior,tipo_evento,fecha");
    cbuEquipos = await cbuLeerTabla("equipos", "m_control,cliente,imei");
    const probe = await supabaseClient.from("componentes_retirados").select("origen_historico_excel").limit(1);
    if (probe.error) throw new Error("origen_historico_excel: faltan las columnas nuevas");

    cbuA = cbCompararComponentes(archA, db, cbuEquipos);
    cbuB = cbCompararMC(archB, eventos, cbuEquipos);
    cbuEstado.textContent = "";
    cbuPintar();
  } catch (err) {
    const falta = /origen_|columnas nuevas|does not exist/.test(err.message);
    cbuEstado.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cbuEsc(err.message)}${falta ? "<br>Corre primero <strong>sql/73-cambios-historicos-excel.sql</strong> en Supabase." : ""}</span>`;
  } finally {
    cbuBtn.disabled = false;
  }
});

function cbuTabla(titulo, cab, filas, abierto) {
  const mostrar = filas.slice(0, CBU_MAX);
  return `<details class="caja-formulario" style="margin-top:12px;" ${abierto ? "open" : ""}>
    <summary style="cursor:pointer;font-weight:600;">${titulo}</summary>
    <div class="tabla-garantias-wrap" style="margin-top:8px;overflow-x:auto;"><table class="tabla-revision">
    <thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${mostrar.join("") || `<tr><td colspan="${cab.length}">Nada que mostrar</td></tr>`}</tbody></table></div>
    ${filas.length > mostrar.length ? `<p style="margin:6px 0;">Se muestran las primeras ${CBU_MAX}. Descarga el CSV para ver todas.</p>` : ""}</details>`;
}

const cbuTarjeta = (n, t) => `<div class="caja-formulario" style="flex:1;min-width:140px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;">${n}</div><div>${t}</div></div>`;

function cbuPintar() {
  const a = cbuA, b = cbuB;
  const h = [];

  // ---------------- A ----------------
  h.push(`<h2 style="margin-top:24px;">A) Cambios de componentes (hoja CE-LE-BA)</h2>
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
    ${cbuTarjeta(a.nuevos.length, "No están en el sistema")}
    ${cbuTarjeta(a.completar.length, "Están y se completan")}
    ${cbuTarjeta(a.difieren.length, "Están con datos distintos")}
    ${cbuTarjeta(a.completos.length, "Ya completos")}
    ${cbuTarjeta(a.descartados.length, "Descartados")}
  </div>
  <p style="margin-top:8px;">${a.repetidos} filas idénticas repetidas se unieron en una. ${a.mcFueraDeEquipos} de los nuevos son de MC que no están en la tabla de equipos (se guardan sin MC, con el MC original anotado).</p>`);

  h.push(cbuTabla(`Datos distintos (${a.difieren.length}) — no se cambia nada`, ["Serial retirado", "Fecha", "Campo", "Sistema", "Archivo"],
    a.difieren.map(d => `<tr><td>${cbuEsc(d.r.viejo)}</td><td>${d.r.fecha}</td><td>${d.campo}</td><td>${cbuEsc(d.sistema)}</td><td>${cbuEsc(d.archivo)}</td></tr>`), a.difieren.length > 0));
  h.push(cbuTabla(`No están en el sistema (${a.nuevos.length}) — se crearán como «Histórico»`, ["Fecha", "Cliente", "MC", "Tipo", "Serial viejo", "Serial nuevo", "Mismo serial ya en el sistema"],
    a.nuevos.map(n => `<tr><td>${n.r.fecha}</td><td>${cbuEsc(n.cliente)}</td><td>${cbuEsc(n.r.mc)}${n.mcEnEquipos ? "" : " ⚠️"}</td><td>${cbuEsc(n.r.tipo)}</td><td>${cbuF(n.r.viejo)}</td><td>${cbuF(n.r.nuevo)}</td><td>${n.serialEnSistema.length ? "⚠️ " + n.serialEnSistema.join(", ") : "—"}</td></tr>`)));
  h.push(cbuTabla(`Se completan con el serial nuevo (${a.completar.length})`, ["Serial retirado", "Fecha", "Serial nuevo que se añade"],
    a.completar.map(c => `<tr><td>${cbuEsc(c.r.viejo)}</td><td>${c.r.fecha}</td><td>${cbuEsc(c.r.nuevo)}</td></tr>`)));
  h.push(cbuTabla(`Descartados (${a.descartados.length})`, ["Fila del Excel", "MC", "Motivo", "Serial viejo → nuevo"],
    a.descartados.map(d => `<tr><td>${d.fila}</td><td>${cbuF(d.mc)}</td><td>${d.motivo}</td><td>${cbuEsc(d.crudo)}</td></tr>`)));
  h.push(`<div class="caja-formulario" style="margin-top:12px;">
    <p>Se crearán <strong>${a.nuevos.length}</strong> registros históricos y se completarán <strong>${a.completar.length}</strong>. Los nuevos quedan como «Revisado», con destino «${CB_DESTINO}», sin contar como material y sin pasar por Revisión de Taller.</p>
    <button class="btn-primario" type="button" id="cb-importar-a">Importar cambios de componentes</button>
    <div id="cb-res-a" style="margin-top:10px;"></div></div>`);

  // ---------------- B ----------------
  h.push(`<h2 style="margin-top:32px;">B) Cambios de módulo de control (hoja Cambios MC)</h2>
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
    ${cbuTarjeta(b.nuevos.length, "Sin registrar en Vida del Equipo")}
    ${cbuTarjeta(b.parciales.length, "Registrados a medias")}
    ${cbuTarjeta(b.difieren.length, "IMEI distinto al del sistema")}
    ${cbuTarjeta(b.completos.length, "Ya registrados")}
    ${cbuTarjeta(b.descartados.length, "Descartados")}
  </div>
  <p style="margin-top:8px;">${b.mismoImei} cambios tienen el mismo IMEI en el viejo y el nuevo (cambio de carcasa o etiqueta): se registran como «Regresó de AMMI». ${b.nuevos.concat(b.parciales).filter(x => x.r.soloRetiro).length} son retiradas sin reemplazo (solo se registra la desvinculación).</p>`);

  const filaB = x => `<tr><td>${x.r.fecha}</td><td>${cbuEsc(x.cliente)}</td><td>${cbuEsc(x.r.mcViejo)}</td><td>${cbuEsc(cbuF(x.r.mcNuevo))}</td><td>${cbuEsc(cbuF(x.r.imeiViejo))}<br>${cbuEsc(cbuF(x.r.imeiNuevo))}</td><td>${x.faltan.join(" + ") || "—"}</td><td>${x.avisos.map(cbuEsc).join("<br>")}</td></tr>`;
  const cabB = ["Fecha", "Cliente", "MC viejo", "MC nuevo", "IMEI viejo / nuevo", "Se registrará", "Avisos"];
  h.push(cbuTabla(`IMEI distinto al del sistema (${b.difieren.length}) — no se importan`, cabB, b.difieren.map(filaB), b.difieren.length > 0));
  h.push(cbuTabla(`Registrados a medias (${b.parciales.length})`, cabB, b.parciales.map(filaB)));
  h.push(cbuTabla(`Sin registrar (${b.nuevos.length})`, cabB, b.nuevos.map(filaB)));
  h.push(cbuTabla(`Descartados (${b.descartados.length})`, ["Fila del Excel", "Motivo", "MC viejo → nuevo"], b.descartados.map(d => `<tr><td>${d.fila}</td><td>${d.motivo}</td><td>${cbuEsc(d.crudo)}</td></tr>`)));
  const nEv = [...b.nuevos, ...b.parciales].reduce((s, x) => s + x.faltan.length, 0);
  h.push(`<div class="caja-formulario" style="margin-top:12px;">
    <p>Se crearán <strong>${nEv}</strong> eventos en Vida del Equipo (desvinculación del MC viejo y vinculación del nuevo, con IMEI, cliente y seriales de lector, cierre y batería) y se recalculará el Registro Maestro de los IMEI afectados.</p>
    <button class="btn-primario" type="button" id="cb-importar-b">Importar cambios de MC</button>
    <div id="cb-res-b" style="margin-top:10px;"></div></div>
  <div class="caja-formulario" style="margin-top:12px;"><button class="btn-secundario btn-compacto" type="button" id="cb-csv">Descargar CSV de ambas comparaciones</button></div>`);

  cbuSalida.innerHTML = h.join("");
  document.getElementById("cb-importar-a").addEventListener("click", cbuImportarA);
  document.getElementById("cb-importar-b").addEventListener("click", cbuImportarB);
  document.getElementById("cb-csv").addEventListener("click", cbuCsv);
}

function cbuCsv() {
  const l = [["hoja", "categoria", "fecha", "cliente", "mc_viejo", "mc_nuevo", "serial_viejo", "serial_nuevo", "detalle"]];
  const a = cbuA, b = cbuB;
  const pa = (cat, r, det) => l.push(["CE-LE-BA", cat, r.fecha, r.cliente || "", r.mc || "", "", r.viejo || "", r.nuevo || "", det || ""]);
  a.nuevos.forEach(n => pa("nuevo", n.r, n.mcEnEquipos ? "" : "MC no está en equipos"));
  a.completar.forEach(c => pa("completar", c.r));
  a.difieren.forEach(d => pa("difiere", d.r, `sistema ${d.sistema}`));
  a.completos.forEach(c => pa("completo", c.r));
  a.descartados.forEach(d => l.push(["CE-LE-BA", "descartado", "", "", d.mc || "", "", "", "", `fila ${d.fila}: ${d.motivo} (${d.crudo})`]));
  const pb = (cat, x) => l.push(["Cambios MC", cat, x.r.fecha, x.cliente || "", x.r.mcViejo, x.r.mcNuevo || "", "", "", `${x.faltan.join("+")} ${x.avisos.join(" | ")}`.trim()]);
  b.nuevos.forEach(x => pb("nuevo", x));
  b.parciales.forEach(x => pb("parcial", x));
  b.difieren.forEach(x => pb("difiere", x));
  b.completos.forEach(x => pb("completo", x));
  b.descartados.forEach(d => l.push(["Cambios MC", "descartado", "", "", "", "", "", "", `fila ${d.fila}: ${d.motivo} (${d.crudo})`]));
  const csv = l.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "comparacion-cambios-modulos.csv"; link.click();
  URL.revokeObjectURL(url);
}

async function cbuRecalcular(imeis, caja, prefijo) {
  const lista = [...imeis].filter(Boolean);
  let fallos = 0;
  for (let i = 0; i < lista.length; i += 6) {
    caja.textContent = `${prefijo} Recalculando Registro Maestro ${Math.min(i + 6, lista.length)} de ${lista.length}...`;
    const rs = await Promise.all(lista.slice(i, i + 6).map(imei => supabaseClient.rpc("recalcular_registro_maestro", { p_imei: imei })));
    fallos += rs.filter(x => x.error).length;
  }
  return fallos;
}

async function cbuImportarA() {
  const boton = document.getElementById("cb-importar-a"), caja = document.getElementById("cb-res-a");
  const nuevas = cbuA.nuevos.map(cbFilaComponente);
  const parches = cbuA.completar;
  if (!nuevas.length && !parches.length) { caja.textContent = "No hay nada que importar."; return; }
  if (!confirm(`Se crearán ${nuevas.length} registros históricos y se completarán ${parches.length}. ¿Continuar?`)) return;
  boton.disabled = true;
  try {
    for (let i = 0; i < nuevas.length; i += 100) {
      caja.textContent = `Creando ${Math.min(i + 100, nuevas.length)} de ${nuevas.length}...`;
      const { error } = await supabaseClient.from("componentes_retirados").insert(nuevas.slice(i, i + 100));
      if (error) throw new Error(`crear (${i + 1}-${i + 100}): ${error.message}`);
    }
    for (let i = 0; i < parches.length; i += 8) {
      caja.textContent = `Completando ${Math.min(i + 8, parches.length)} de ${parches.length}...`;
      const rs = await Promise.all(parches.slice(i, i + 8).map(p => supabaseClient.from("componentes_retirados").update(p.parche).eq("id", p.bd.id)));
      const f = rs.find(x => x.error);
      if (f) throw new Error("completar: " + f.error.message);
    }
    const imeiDe = new Map(cbuEquipos.map(q => [String(q.m_control).toUpperCase(), q.imei]));
    const imeis = new Set([...cbuA.nuevos.filter(n => n.mcEnEquipos).map(n => imeiDe.get(n.r.mc))]);
    const fallos = await cbuRecalcular(imeis, caja, "");
    caja.innerHTML = `<span class="resultado-msg resultado-ok" style="display:block;">✅ ${nuevas.length} creados y ${parches.length} completados.${fallos ? ` ⚠️ Falló el recálculo del Registro Maestro en ${fallos} IMEI.` : ""} Vuelve a pulsar «Comparar» antes de importar de nuevo.</span>`;
  } catch (err) {
    caja.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cbuEsc(err.message)}. Vuelve a pulsar «Comparar» antes de reintentar.</span>`;
  } finally { boton.disabled = false; }
}

async function cbuImportarB() {
  const boton = document.getElementById("cb-importar-b"), caja = document.getElementById("cb-res-b");
  const items = [...cbuB.nuevos, ...cbuB.parciales];
  const eventos = items.flatMap(cbEventosMC).filter(e => e.imei);
  if (!eventos.length) { caja.textContent = "No hay nada que importar."; return; }
  if (!confirm(`Se crearán ${eventos.length} eventos en Vida del Equipo. ¿Continuar?`)) return;
  boton.disabled = true;
  try {
    for (let i = 0; i < eventos.length; i += 100) {
      caja.textContent = `Creando eventos ${Math.min(i + 100, eventos.length)} de ${eventos.length}...`;
      const { error } = await supabaseClient.from("historial_equipo").insert(eventos.slice(i, i + 100));
      if (error) throw new Error(`crear (${i + 1}-${i + 100}): ${error.message}`);
    }
    const fallos = await cbuRecalcular(new Set(eventos.map(e => e.imei)), caja, "");
    caja.innerHTML = `<span class="resultado-msg resultado-ok" style="display:block;">✅ ${eventos.length} eventos creados.${fallos ? ` ⚠️ Falló el recálculo del Registro Maestro en ${fallos} IMEI.` : ""} Vuelve a pulsar «Comparar» antes de importar de nuevo.</span>`;
  } catch (err) {
    caja.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${cbuEsc(err.message)}. Vuelve a pulsar «Comparar» antes de reintentar.</span>`;
  } finally { boton.disabled = false; }
}
