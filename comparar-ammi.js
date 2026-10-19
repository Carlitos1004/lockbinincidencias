// =========================================================================
// COMPARAR HISTORIAL AMMI (UI) — solo manager
// Lee GestionGarantias (ControlFraAMMI + Informes AMMI), lo compara con los
// envíos a AMMI que ya hay en componentes_retirados y permite importar:
//  - los envíos que no existen (se crean como registro histórico), y
//  - los datos que faltan en los que sí existen (solo campos vacíos).
// NUNCA pisa un dato que el sistema ya tiene. Requiere sql/72.
// =========================================================================

const AMU_MAX = 300;
let amuRes = null;

const amuArchivo = document.getElementById("am-archivo");
const amuBtn = document.getElementById("am-analizar");
const amuSalida = document.getElementById("am-salida");
const amuEstado = document.getElementById("am-estado");

amuArchivo.addEventListener("change", () => { amuBtn.disabled = !amuArchivo.files.length; });

const amuEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function amuLeerLibro(archivo) {
  return new Promise((resolve, reject) => {
    const l = new FileReader();
    l.onload = e => { try { resolve(XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true })); } catch (err) { reject(err); } };
    l.onerror = () => reject(new Error("No se pudo leer el archivo"));
    l.readAsArrayBuffer(archivo);
  });
}

// La hoja de control tiene una fila de títulos de grupo antes de las cabeceras reales
function amuHojaControl(libro) {
  const h = libro.Sheets["ControlFraAMMI"];
  if (!h) return null;
  const filas = XLSX.utils.sheet_to_json(h, { header: 1, defval: null, raw: true });
  const iCab = filas.findIndex(f => f && f.includes("Código envío"));
  if (iCab < 0) return null;
  const cab = filas[iCab];
  return filas.slice(iCab + 1).filter(f => f && f.some(v => v !== null && v !== "")).map(f => Object.fromEntries(cab.map((c, i) => [c, f[i] ?? null])));
}

function amuHojaInformes(libro) {
  const h = libro.Sheets["Informes AMMI"];
  return h ? XLSX.utils.sheet_to_json(h, { defval: null }) : null;
}

async function amuLeerTabla(tabla, columnas, filtro) {
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

amuBtn.addEventListener("click", async () => {
  amuBtn.disabled = true;
  amuSalida.innerHTML = "";
  amuEstado.textContent = "Leyendo el Excel...";
  try {
    const libro = await amuLeerLibro(amuArchivo.files[0]);
    const control = amuHojaControl(libro);
    const informes = amuHojaInformes(libro);
    if (!control || !informes) throw new Error('No encuentro las hojas "ControlFraAMMI" e "Informes AMMI". ¿Es el archivo GestionGarantias?');
    const archivo = amLeerArchivo(control, informes);

    amuEstado.textContent = "Leyendo los envíos que ya hay en el sistema...";
    const db = await amuLeerTabla("componentes_retirados", "*", q => q.eq("destino", AM_DESTINO));
    if (db.length && !("ammi_codigo_envio" in db[0])) throw new Error("faltan las columnas nuevas de AMMI");
    const equipos = await amuLeerTabla("equipos", "m_control,cliente,imei,serie_bateria,serie_cierre,serie_lector");

    amuRes = amComparar(archivo, db, equipos);
    amuRes.nuevos.forEach(n => { n.serialEnSistema = n.serialEnSistema || []; }); // por si el core está desactualizado
    amuRes._db = db;
    amuRes._imeis = new Map(equipos.map(q => [String(q.m_control).toUpperCase(), q.imei]));
    amuRes._t = { archivo: archivo.envios.length, ambas: archivo.ambas, soloControl: archivo.soloControl, soloInformes: archivo.soloInformes, bd: db.length };
    amuEstado.textContent = "";
    amuPintar();
  } catch (err) {
    const falta = /ammi_|columnas nuevas|does not exist/.test(err.message);
    amuEstado.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${amuEsc(err.message)}${falta ? "<br>Corre primero <strong>sql/72-ammi-historial-excel.sql</strong> en Supabase." : ""}</span>`;
  } finally {
    amuBtn.disabled = false;
  }
});

function amuTabla(titulo, cab, filas, abierto) {
  const mostrar = filas.slice(0, AMU_MAX);
  return `<details class="caja-formulario" style="margin-top:12px;" ${abierto ? "open" : ""}>
    <summary style="cursor:pointer;font-weight:600;">${titulo}</summary>
    <div class="tabla-garantias-wrap" style="margin-top:8px;overflow-x:auto;"><table class="tabla-revision">
    <thead><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${mostrar.join("") || `<tr><td colspan="${cab.length}">Nada que mostrar</td></tr>`}</tbody></table></div>
    ${filas.length > mostrar.length ? `<p style="margin:6px 0;">Se muestran las primeras ${AMU_MAX}. Descarga el CSV para ver todas.</p>` : ""}</details>`;
}

function amuPintar() {
  const r = amuRes;
  const f = v => (v === null || v === undefined || v === "") ? "—" : v;
  const tarjeta = (n, t) => `<div class="caja-formulario" style="flex:1;min-width:150px;text-align:center;"><div style="font-size:1.6rem;font-weight:700;">${n}</div><div>${t}</div></div>`;
  const nuevosSinMc = r.nuevos.filter(n => !n.mc).length;
  const h = [];

  h.push(`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">
    ${tarjeta(r.nuevos.length, "No están en el sistema")}
    ${tarjeta(r.completar.length, "Están y se pueden completar")}
    ${tarjeta(r.difieren.length, "Están con datos distintos")}
    ${tarjeta(r.completos.length, "Ya completos")}
    ${tarjeta(r.nuevos.filter(n => n.serialEnSistema.length).length, "Reenvíos: mismo serial, otro periodo")}
  </div>
  <p style="margin-top:10px;">Archivo: ${r._t.archivo} envíos (${r._t.ambas} en las dos hojas, ${r._t.soloControl} solo en Control, ${r._t.soloInformes} solo en Informes; ${r.pendientesArchivo} pendientes de regreso). Sin serial (descartados): ${r.sinSerial.length}. En el sistema: ${r._t.bd} envíos a AMMI, de los cuales ${r.soloBD.length} no aparecen en el archivo (no se tocan).</p>`);

  h.push(amuTabla(`Datos distintos (${r.difieren.length}) — no se cambia ese dato, solo se rellenan los campos vacíos`,
    ["Serial", "Envío", "Qué difiere"],
    r.difieren.map(d => `<tr><td>${amuEsc(d.e.serial)}</td><td>${f(d.e.fechaEnvio)}</td><td>${d.diferencias.map(x => `${amuEsc(x.campo)}: sistema «${amuEsc(x.sistema)}» / archivo «${amuEsc(x.archivo)}»`).join("<br>")}</td></tr>`), r.difieren.length > 0));

  h.push(amuTabla(`No están en el sistema (${r.nuevos.length}) — se crearán como registro histórico`,
    ["Serial", "Tipo", "Envío", "Regreso", "Acción", "MC / cliente en el sistema", "SN reposición / MC nuevo", "Ya en el sistema con fecha (otro periodo)"],
    r.nuevos.map(n => `<tr><td>${amuEsc(n.e.serial)}</td><td>${f(n.e.tipo)}</td><td>${f(n.e.fechaEnvio)}</td><td>${n.e.pendiente ? "Pendiente" : f(n.e.fechaDevolucion)}</td><td>${f(n.e.accion)}</td>
      <td>${n.mc ? amuEsc(n.mc) + " · " + amuEsc(n.clienteSistema) : "<em>no encontrado</em> · " + amuEsc(n.e.cliente)}</td><td>${f(n.e.snUtilizado)}</td><td>${n.serialEnSistema.length ? "⚠️ " + n.serialEnSistema.join(", ") : "—"}</td></tr>`)));

  h.push(amuTabla(`Se completan (${r.completar.length})`, ["Serial", "Envío", "Campos que se rellenan"],
    r.completar.map(c => `<tr><td>${amuEsc(c.e.serial)}</td><td>${f(c.e.fechaEnvio)}</td><td>${Object.keys(c.parche).map(k => k.replace("ammi_", "")).join(", ")}</td></tr>`)));

  h.push(amuTabla(`Sin serial legible (${r.sinSerial.length})`, ["Código de envío", "Hoja"], r.sinSerial.map(s => `<tr><td>${amuEsc(s.codigo)}</td><td>${s.hoja}</td></tr>`)));

  h.push(`<div class="caja-formulario" style="margin-top:16px;">
    <p style="font-weight:600;">Importar</p>
    <p>Se crearán hasta <strong>${r.nuevos.length}</strong> registros históricos (${nuevosSinMc} sin MC en la tabla de equipos: quedan sin MC pero con su serial) y se completarán datos vacíos en <strong>${r.completar.length + r.difieren.length}</strong> envíos que ya existen. No se borra ni se pisa nada.</p>
    <p>Cambios de carcasa: <strong>${amuCarcasas(false).length}</strong> se registrarán también en Vida del Equipo («Regresó de AMMI», con el mismo IMEI del MC anterior) y se recalculará el Registro Maestro.</p>
    ${r.nuevos.some(n => n.serialEnSistema.length) ? `<p><label style="cursor:pointer;"><input type="checkbox" id="am-incluir-dup" checked> Crear también los ${r.nuevos.filter(n => n.serialEnSistema.length).length} reenvíos: el mismo serial ya está en el sistema pero con una fecha fuera del periodo de este envío, así que son envíos distintos (desmarca para omitirlos)</label></p>` : ""}
    <button class="btn-secundario btn-compacto" type="button" id="am-csv">Descargar CSV</button>
    <button class="btn-primario" type="button" id="am-importar">Importar</button>
    <div id="am-resultado" style="margin-top:10px;"></div>
  </div>`);

  h.push(`<div class="caja-formulario" style="margin-top:16px;">
    <p style="font-weight:600;">Cambios de carcasa sin registrar en Vida del Equipo</p>
    <div id="am-pend-carcasa">Comprobando...</div>
  </div>`);

  amuSalida.innerHTML = h.join("");
  amuCalcularPendientesCarcasa();
  document.getElementById("am-csv").addEventListener("click", amuCsv);
  document.getElementById("am-importar").addEventListener("click", amuImportar);
}


// Cambios de carcasa que se van a importar (para registrarlos en Vida del Equipo)
function amuCarcasas(incluirDup) {
  const r = amuRes;
  const lista = [];
  const fechaDe = v => String(v || "").slice(0, 10);
  r.nuevos.filter(n => n.e.tipo && (incluirDup || !n.serialEnSistema.length)).forEach(n => {
    const c = amCamposDelArchivo(n.e);
    if (c.ammi_cambio_carcasa && c.ammi_mc_nuevo && n.e.serial !== c.ammi_mc_nuevo)
      lista.push({ mcViejo: n.e.serial, mcNuevo: c.ammi_mc_nuevo, fecha: fechaDe(c.ammi_fecha_regreso), idOt: null });
  });
  [...r.completar, ...r.difieren].forEach(p => {
    if (p.parche.ammi_cambio_carcasa && p.parche.ammi_mc_nuevo && p.e.serial !== p.parche.ammi_mc_nuevo)
      lista.push({ mcViejo: p.e.serial, mcNuevo: p.parche.ammi_mc_nuevo, fecha: fechaDe(p.parche.ammi_fecha_regreso || p.bd.ammi_fecha_regreso), idOt: p.bd.id_ot || null });
  });
  return lista;
}

async function amuRegistrarCarcasa(c) {
  // El MC nuevo comparte placa (y IMEI) con el viejo: se busca por cualquiera de los dos
  let imei = amuRes._imeis.get(c.mcViejo.toUpperCase()) || amuRes._imeis.get(c.mcNuevo.toUpperCase()) || null;
  for (const mc of [c.mcViejo, c.mcNuevo]) {
    if (imei) break;
    const { data: ev } = await supabaseClient.from("historial_equipo").select("imei")
      .eq("mc", mc).not("imei", "is", null).order("fecha", { ascending: false }).limit(1).maybeSingle();
    imei = ev?.imei || null;
  }
  if (!imei) return { ok: false, motivo: "sin IMEI" };

  const { data: existente } = await supabaseClient.from("historial_equipo").select("id")
    .eq("mc", c.mcNuevo).eq("mc_anterior", c.mcViejo).eq("tipo_evento", "Regresó de AMMI").maybeSingle();
  const datos = {
    imei, mc: c.mcNuevo, tipo_evento: "Regresó de AMMI", mc_anterior: c.mcViejo, id_ot: c.idOt,
    fecha: new Date((c.fecha || new Date().toISOString().slice(0, 10)) + "T12:00:00").toISOString(),
    notas: `Reparado por AMMI con cambio de carcasa: serial ${c.mcViejo} → ${c.mcNuevo} (mismo IMEI). Importado del Excel de AMMI.`
  };
  const { error } = existente
    ? await supabaseClient.from("historial_equipo").update(datos).eq("id", existente.id)
    : await supabaseClient.from("historial_equipo").insert(datos);
  if (error) return { ok: false, motivo: error.message };
  return { ok: true, imei };
}

function amuCsv() {
  const r = amuRes;
  const l = [["categoria", "serial", "tipo", "codigo_envio", "fecha_envio", "fecha_regreso", "accion", "mc_sistema", "sn_utilizado", "detalle"]];
  const a = (cat, e, extra) => l.push([cat, e.serial, e.tipo || "", e.codigo, e.fechaEnvio || "", e.pendiente ? "PENDIENTE" : (e.fechaDevolucion || ""), e.accion || "", extra?.mc || "", e.snUtilizado || "", extra?.det || ""]);
  r.nuevos.forEach(n => a("nuevo", n.e, { mc: n.mc }));
  r.completar.forEach(c => a("completar", c.e, { det: Object.keys(c.parche).join("+") }));
  r.difieren.forEach(d => a("difiere", d.e, { det: d.diferencias.map(x => `${x.campo}: ${x.sistema} / ${x.archivo}`).join(" | ") }));
  r.completos.forEach(c => a("completo", c.e));
  r.soloBD.forEach(b => l.push(["solo_sistema", b.serial_retirado, b.tipo_componente || "", "", String(b.fecha || "").slice(0, 10), String(b.ammi_fecha_regreso || "").slice(0, 10), "", b.m_control || "", "", ""]));
  const csv = l.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "comparacion-ammi.csv"; link.click();
  URL.revokeObjectURL(url);
}

async function amuImportar() {
  const boton = document.getElementById("am-importar");
  const caja = document.getElementById("am-resultado");
  const r = amuRes;
  const incluirDup = !!(document.getElementById("am-incluir-dup") || {}).checked;
  const nuevas = r.nuevos.filter(n => n.e.tipo && (incluirDup || !n.serialEnSistema.length)).map(amFilaNueva);
  const parches = [...r.completar, ...r.difieren].filter(x => Object.keys(x.parche).length);
  if (!nuevas.length && !parches.length) { caja.textContent = "No hay nada que importar."; return; }
  if (!confirm(`Se crearán ${nuevas.length} registros históricos y se completarán ${parches.length} envíos existentes. ¿Continuar?`)) return;

  boton.disabled = true;
  try {
    for (let i = 0; i < nuevas.length; i += 100) {
      caja.textContent = `Creando registros ${Math.min(i + 100, nuevas.length)} de ${nuevas.length}...`;
      const { error } = await supabaseClient.from("componentes_retirados").insert(nuevas.slice(i, i + 100));
      if (error) throw new Error(`crear (${i + 1}-${i + 100}): ${error.message}`);
    }
    for (let i = 0; i < parches.length; i += 8) {
      caja.textContent = `Completando datos ${Math.min(i + 8, parches.length)} de ${parches.length}...`;
      const resultados = await Promise.all(parches.slice(i, i + 8).map(p =>
        supabaseClient.from("componentes_retirados").update(p.parche).eq("id", p.bd.id)));
      const fallo = resultados.find(x => x.error);
      if (fallo) throw new Error(`completar: ${fallo.error.message}`);
    }
    const carcasas = amuCarcasas(incluirDup);
    const sinImei = [], conError = [], imeis = new Set();
    for (let i = 0; i < carcasas.length; i++) {
      caja.textContent = `Registrando cambios de carcasa ${i + 1} de ${carcasas.length}...`;
      const x = await amuRegistrarCarcasa(carcasas[i]);
      if (x.ok) imeis.add(x.imei);
      else if (x.motivo === "sin IMEI") sinImei.push(`${carcasas[i].mcViejo} → ${carcasas[i].mcNuevo}`);
      else conError.push(`${carcasas[i].mcViejo}: ${x.motivo}`);
    }
    let errRec = 0;
    for (const imei of imeis) {
      const { error } = await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: imei });
      if (error) errRec++;
    }
    const avisos = [
      sinImei.length ? `<br>⚠️ ${sinImei.length} cambios de carcasa NO se registraron en Vida del Equipo por no encontrar el IMEI del MC viejo: ${amuEsc(sinImei.join(", "))}` : "",
      conError.length ? `<br>⚠️ Errores al registrar: ${amuEsc(conError.join(" | "))}` : "",
      errRec ? `<br>⚠️ Falló el recálculo del Registro Maestro en ${errRec} IMEI.` : ""
    ].join("");
    caja.innerHTML = `<span class="resultado-msg resultado-ok" style="display:block;">✅ ${nuevas.length} registros creados, ${parches.length} completados y ${carcasas.length - sinImei.length - conError.length} cambios de carcasa registrados en Vida del Equipo.${avisos}<br>Vuelve a pulsar «Comparar» para verificar; no repitas «Importar» sin comparar antes, porque duplicaría los nuevos.</span>`;
  } catch (err) {
    caja.innerHTML = `<span class="resultado-msg resultado-error" style="display:block;">❌ ${amuEsc(err.message)}. Lo anterior a ese error quedó guardado: vuelve a pulsar «Comparar» antes de reintentar.</span>`;
  } finally {
    boton.disabled = false;
  }
}


// =========================================================================
// Cambios de carcasa que ya están en componentes_retirados pero no en Vida del Equipo
// =========================================================================

let amuPendCarcasa = [];

async function amuCalcularPendientesCarcasa() {
  const caja = document.getElementById("am-pend-carcasa");
  try {
    const eventos = await amuLeerTabla("historial_equipo", "mc,mc_anterior", q => q.eq("tipo_evento", "Regresó de AMMI"));
    const hechos = new Set(eventos.map(e => `${String(e.mc).toUpperCase()}|${String(e.mc_anterior).toUpperCase()}`));
    amuPendCarcasa = amuRes._db
      .filter(r => r.ammi_cambio_carcasa && r.ammi_mc_nuevo)
      .map(r => ({ mcViejo: r.m_control || r.serial_retirado, mcNuevo: r.ammi_mc_nuevo, fecha: String(r.ammi_fecha_regreso || "").slice(0, 10), idOt: r.id_ot || null }))
      .filter(c => c.mcViejo && !hechos.has(`${c.mcNuevo.toUpperCase()}|${c.mcViejo.toUpperCase()}`));
    caja.innerHTML = amuPendCarcasa.length
      ? `<p><strong>${amuPendCarcasa.length}</strong>: ${amuEsc(amuPendCarcasa.map(c => c.mcViejo + " → " + c.mcNuevo).join(", "))}</p>
         <button class="btn-primario btn-compacto" type="button" id="am-reg-carcasa">Registrar en Vida del Equipo</button>
         <div id="am-reg-carcasa-res" style="margin-top:8px;"></div>`
      : "Ninguno pendiente: todos los cambios de carcasa están registrados.";
    const b = document.getElementById("am-reg-carcasa");
    if (b) b.addEventListener("click", amuRegistrarPendientes);
  } catch (err) {
    caja.textContent = "No se pudo comprobar: " + err.message;
  }
}

async function amuRegistrarPendientes() {
  const res = document.getElementById("am-reg-carcasa-res");
  const b = document.getElementById("am-reg-carcasa");
  b.disabled = true;
  const sin = [], err = [], imeis = new Set();
  for (const c of amuPendCarcasa) {
    const x = await amuRegistrarCarcasa(c);
    if (x.ok) imeis.add(x.imei); else (x.motivo === "sin IMEI" ? sin : err).push(`${c.mcViejo} → ${c.mcNuevo}${x.motivo === "sin IMEI" ? "" : " (" + x.motivo + ")"}`);
  }
  for (const imei of imeis) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: imei });
  res.innerHTML = `✅ ${amuPendCarcasa.length - sin.length - err.length} registrados.${sin.length ? `<br>⚠️ Sin IMEI en equipos ni historial (ni el MC viejo ni el nuevo): ${amuEsc(sin.join(", "))}` : ""}${err.length ? `<br>⚠️ ${amuEsc(err.join(" | "))}` : ""}`;
  b.disabled = false;
}
