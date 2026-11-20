// =========================================================================
// STOCK EN CLIENTES — material entregado a un cliente que lo guarda en su stock.
// Cada pieza (serial) está "En stock del cliente" hasta que se ve instalada en un equipo
// (el serial aparece en Equipos en un MC distinto del que ya lo tenía al registrarla).
// =========================================================================
const escH = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
const PREFIJO_TIPO = { BA: "Batería", LE: "Lector Electrónico", CE: "Cierre Electrónico", MC: "Módulo de Control" };
const COL_EQUIPO = { "Batería": "serie_bateria", "Lector Electrónico": "serie_lector", "Cierre Electrónico": "serie_cierre", "Módulo de Control": "m_control" };
const quitarAcentos = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const hoyISO = () => new Date().toISOString().slice(0, 10);
const msg = (t, error) => { const p = document.getElementById("msg"); p.textContent = t || ""; p.hidden = !t; p.className = "resultado-msg" + (error ? " error" : ""); };

let entregas = [], items = [];
let planNueva = [];

async function paginar(tabla, columnas, orden) {
  const filas = [];
  for (let d = 0; ; d += 1000) {
    let q = supabaseClient.from(tabla).select(columnas).range(d, d + 999);
    if (orden) q = q.order(orden, { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

// ---- Detección: ¿alguna pieza "En stock" ya aparece instalada en un equipo? ----
async function detectarInstaladas() {
  const pend = items.filter(i => i.estado === "En stock del cliente");
  const porTipo = {};
  pend.forEach(i => { (porTipo[i.tipo] = porTipo[i.tipo] || []).push(i); });
  const cambios = [];
  for (const [tipo, lista] of Object.entries(porTipo)) {
    const col = COL_EQUIPO[tipo]; if (!col) continue;
    const seriales = lista.map(i => i.serial);
    for (let k = 0; k < seriales.length; k += 100) {
      const { data } = await supabaseClient.from("equipos").select("m_control, estado_montaje, " + col).in(col, seriales.slice(k, k + 100));
      (data || []).forEach(e => {
        if (quitarAcentos(e.estado_montaje) === "DESVINCULADO") return;       // un equipo ya desvinculado no cuenta
        const it = lista.find(i => i.serial === String(e[col]).toUpperCase());
        if (!it) return;
        if (tipo === "Módulo de Control") { if (!it.mc_base) cambios.push({ it, mc: e.m_control }); return; }
        if (it.mc_base && it.mc_base === e.m_control) return;                   // ya estaba en ese MC al registrarla: no es una instalación nueva
        cambios.push({ it, mc: e.m_control });
      });
    }
  }
  const ahora = new Date().toISOString();
  for (let k = 0; k < cambios.length; k += 10) {
    await Promise.all(cambios.slice(k, k + 10).map(c => supabaseClient.from("entregas_cliente_items")
      .update({ estado: "Instalada", mc_instalado: c.mc, instalada_en: ahora }).eq("id", c.it.id)));
  }
  return cambios.length;
}

async function cargar() {
  try {
    entregas = await paginar("entregas_cliente", "*", "fecha");
    items = await paginar("entregas_cliente_items", "*");
  } catch (e) { msg("❌ " + e.message + " (¿corriste el SQL 108?)", true); return; }
  const nuevas = await detectarInstaladas();
  if (nuevas) { items = await paginar("entregas_cliente_items", "*"); msg(`🔧 ${nuevas} pieza(s) detectadas como instaladas por el cliente.`, false); } else msg("");
  pintarFiltros(); pintarResumen(); pintarEntregas();
}

function pintarFiltros() {
  const sel = document.getElementById("f-cliente"); const v = sel.value;
  const clientes = [...new Set(entregas.map(e => e.cliente))].sort();
  sel.innerHTML = '<option value="">Todos</option>' + clientes.map(c => `<option>${escH(c)}</option>`).join("");
  sel.value = clientes.includes(v) ? v : "";
}

function pintarResumen() {
  const porEntrega = Object.fromEntries(entregas.map(e => [e.id, e]));
  const r = {};
  items.forEach(i => {
    const c = (porEntrega[i.entrega_id] || {}).cliente; if (!c) return;
    const f = (r[c] = r[c] || { total: 0, stock: 0, inst: 0, tipos: {} });
    f.total++; i.estado === "Instalada" ? f.inst++ : f.stock++;
    if (i.estado !== "Instalada") { const k = i.tipo === "Batería" ? "Batería" + (i.subtipo ? " " + i.subtipo : "") : i.tipo; f.tipos[k] = (f.tipos[k] || 0) + 1; }
  });
  const filas = Object.entries(r).sort();
  document.getElementById("resumen-clientes").innerHTML = filas.length
    ? `<div class="scroll-x-tabla"><table class="tabla-revision"><thead><tr><th>Cliente</th><th>Entregadas</th><th>Instaladas por el cliente</th><th>Le quedan en stock</th><th>Qué le queda</th></tr></thead><tbody>` +
      filas.map(([c, f]) => `<tr><td><strong>${escH(c)}</strong></td><td>${f.total}</td><td>${f.inst}</td><td><strong>${f.stock}</strong></td><td>${escH(Object.entries(f.tipos).map(([k, v]) => v + " " + k).join(" · ") || "—")}</td></tr>`).join("") + "</tbody></table></div>"
    : "<p>Todavía no hay entregas registradas.</p>";
}

function pintarEntregas() {
  const fc = document.getElementById("f-cliente").value;
  const fs = document.getElementById("f-serial").value.trim().toUpperCase();
  const cont = document.getElementById("lista-entregas");
  const lista = entregas.filter(e => (!fc || e.cliente === fc) && (!fs || items.some(i => i.entrega_id === e.id && i.serial.includes(fs))));
  if (!lista.length) { cont.innerHTML = "<p>No hay entregas con ese filtro.</p>"; return; }
  cont.innerHTML = lista.map(e => {
    const its = items.filter(i => i.entrega_id === e.id).sort((a, b) => a.serial.localeCompare(b.serial));
    const nInst = its.filter(i => i.estado === "Instalada").length;
    const filas = its.map(i => `<tr data-id="${i.id}" style="${fs && i.serial.includes(fs) ? "background:#fffbe6;" : ""}">
      <td class="celda-mono">${escH(i.serial)}</td><td>${escH(i.tipo)}${i.subtipo ? " · " + escH(i.subtipo) : ""}</td><td>${i.categoria ? i.categoria + "ª" : "—"}</td>
      <td>${i.estado === "Instalada" ? `<span class="chip chip-info">Instalada en ${escH(i.mc_instalado || "?")}</span> <small>${i.instalada_en ? new Date(i.instalada_en).toLocaleDateString("es-ES") : ""}</small>` : '<span class="chip chip-ok">En stock del cliente</span>'}
        ${i.mc_base ? `<br><small title="Al registrarla, Equipos ya la mostraba en este MC">ℹ️ figuraba en ${escH(i.mc_base)}</small>` : ""}</td>
      <td><button type="button" class="btn-secundario it-borrar" title="Quitar esta pieza de la entrega">✕</button></td></tr>`).join("");
    return `<details class="caja" data-id="${e.id}" ${fs ? "open" : ""}>
      <summary class="entrega-cab"><strong>${escH(e.cliente)}</strong> · ${new Date(e.fecha + "T00:00:00").toLocaleDateString("es-ES")} · ${its.length} piezas
        ${e.albaran ? `<span class="chip chip-ok">📄 ${escH(e.albaran)}</span>` : '<span class="chip chip-aviso">📄 sin albarán</span>'}
        <span class="chip">${its.length - nInst} en stock · ${nInst} instaladas</span></summary>
      <div class="fila-form">
        <label>Nº de albarán <input type="text" class="alb-input" value="${escH(e.albaran || "")}" style="width:200px;"></label>
        <button type="button" class="btn-primario alb-guardar">Guardar albarán</button>
        <label>Nota <input type="text" class="nota-input" value="${escH(e.nota || "")}" style="width:240px;"></label>
        <button type="button" class="btn-secundario nota-guardar">Guardar nota</button>
        <button type="button" class="btn-secundario ent-borrar">🗑 Borrar entrega</button>
      </div>
      <div class="scroll-x-tabla" style="max-height:340px;"><table class="tabla-revision"><thead><tr><th>Serial</th><th>Pieza</th><th>Cat.</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
    </details>`;
  }).join("");
}

document.getElementById("f-cliente").addEventListener("change", pintarEntregas);
document.getElementById("f-serial").addEventListener("input", pintarEntregas);
document.getElementById("lista-entregas").addEventListener("click", async ev => {
  const det = ev.target.closest("details[data-id]"); if (!det) return;
  const id = Number(det.dataset.id);
  if (ev.target.closest(".alb-guardar")) {
    const v = det.querySelector(".alb-input").value.trim() || null;
    const { error } = await supabaseClient.from("entregas_cliente").update({ albaran: v }).eq("id", id);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    entregas.find(e => e.id === id).albaran = v; pintarEntregas();
  } else if (ev.target.closest(".nota-guardar")) {
    const v = det.querySelector(".nota-input").value.trim() || null;
    const { error } = await supabaseClient.from("entregas_cliente").update({ nota: v }).eq("id", id);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    entregas.find(e => e.id === id).nota = v; msg("✅ Nota guardada.", false);
  } else if (ev.target.closest(".ent-borrar")) {
    if (!confirm("¿Borrar esta entrega completa con todas sus piezas? (solo si se registró por error)")) return;
    const { error } = await supabaseClient.from("entregas_cliente").delete().eq("id", id);
    if (error) { alert("No se pudo borrar: " + error.message); return; }
    await cargar();
  } else if (ev.target.closest(".it-borrar")) {
    const itemId = Number(ev.target.closest("tr").dataset.id);
    if (!confirm("¿Quitar esta pieza de la entrega?")) return;
    const { error } = await supabaseClient.from("entregas_cliente_items").delete().eq("id", itemId);
    if (error) { alert("No se pudo borrar: " + error.message); return; }
    await cargar();
  }
});

// ---- Nueva entrega ----
document.getElementById("e-fecha").value = hoyISO();
(async () => {   // clientes conocidos (de Equipos) para el desplegable de sugerencias
  try {
    const vistos = new Set();
    for (let d = 0; ; d += 1000) {
      const { data } = await supabaseClient.from("equipos").select("cliente").range(d, d + 999);
      (data || []).forEach(e => { if (e.cliente) vistos.add(e.cliente); });
      if (!data || data.length < 1000) break;
    }
    document.getElementById("lista-clientes").innerHTML = [...vistos].sort().map(c => `<option value="${escH(c)}">`).join("");
  } catch (e) { /* sin sugerencias */ }
})();

function extraerSeriales(texto) {
  const hallados = String(texto || "").toUpperCase().match(/\b(?:BA|LE|CE|MC)\d{6,10}\b/g) || [];
  return [...new Set(hallados)];
}
async function leerExcel(archivo) {
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
  let texto = "";
  wb.SheetNames.forEach(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }).forEach(f => { texto += (f || []).join(" ") + "\n"; }));
  return texto;
}

document.getElementById("e-previa").addEventListener("click", async () => {
  const out = document.getElementById("e-resultado");
  out.innerHTML = "Comprobando…"; planNueva = [];
  let texto = document.getElementById("e-texto").value;
  const archivo = document.getElementById("e-excel").files[0];
  if (archivo) { try { texto += "\n" + await leerExcel(archivo); } catch (e) { out.textContent = "❌ No pude leer el Excel: " + e.message; return; } }
  const seriales = extraerSeriales(texto);
  if (!seriales.length) { out.innerHTML = "<p>⚠️ No encuentro seriales (BA…, LE…, CE… o MC… con cifras). Pega la lista o sube el Excel.</p>"; return; }

  // ya en stock de algún cliente
  const enStock = {};
  items.filter(i => i.estado === "En stock del cliente").forEach(i => { enStock[i.serial] = entregas.find(e => e.id === i.entrega_id); });
  // dónde los muestra Equipos ahora
  const enEquipos = {};
  for (const [tipo, col] of Object.entries(COL_EQUIPO)) {
    const lista = seriales.filter(s => PREFIJO_TIPO[s.slice(0, 2)] === tipo);
    for (let k = 0; k < lista.length; k += 100) {
      const { data } = await supabaseClient.from("equipos").select("m_control, cliente, estado_montaje, modelo_bateria, " + col).in(col, lista.slice(k, k + 100));
      (data || []).forEach(e => { if (quitarAcentos(e.estado_montaje) !== "DESVINCULADO") enEquipos[String(e[col]).toUpperCase()] = e; });
    }
  }
  // tipo de batería
  const subSel = document.getElementById("e-subtipo").value;
  const bats = seriales.filter(s => s.startsWith("BA"));
  let auto = { exacto: {} };
  if (!subSel && bats.length) { try { auto = await clasificarBateriasAuto(supabaseClient, bats); } catch (e) { /* sin tipo */ } }
  const cat = document.getElementById("e-categoria").value;

  planNueva = seriales.map(s => {
    const tipo = PREFIJO_TIPO[s.slice(0, 2)];
    const eq = enEquipos[s];
    const sub = tipo === "Batería" ? (subSel || (auto.exacto[s] || "").replace("Batería ", "") || null) : null;
    return { serial: s, tipo, subtipo: sub, categoria: cat ? Number(cat) : null, conflicto: enStock[s] || null, equipo: eq || null,
      mc_base: eq && tipo !== "Módulo de Control" ? eq.m_control : null };
  });
  const validas = planNueva.filter(p => !p.conflicto);
  const conEquipo = validas.filter(p => p.equipo);
  const resumenTipos = {};
  validas.forEach(p => { const k = p.tipo === "Batería" ? "Batería " + (p.subtipo || "sin tipo") : p.tipo; resumenTipos[k] = (resumenTipos[k] || 0) + 1; });
  const filas = planNueva.map((p, i) => `<tr><td>${i + 1}</td><td class="celda-mono">${escH(p.serial)}</td><td>${escH(p.tipo)}${p.subtipo ? " · " + escH(p.subtipo) : ""}</td>
    <td>${p.conflicto ? `⛔ ya en stock de ${escH(p.conflicto.cliente)} (no se guarda)` : p.equipo ? `ℹ️ Equipos lo muestra en ${escH(p.equipo.m_control)} (${escH(p.equipo.cliente || "")})` : "✅ nueva"}</td></tr>`).join("");
  out.innerHTML = `<p><strong>${validas.length}</strong> piezas para guardar (${escH(Object.entries(resumenTipos).map(([k, v]) => v + " " + k).join(" · ") || "—")})${planNueva.length - validas.length ? ` · ${planNueva.length - validas.length} se saltan` : ""}.</p>
    ${conEquipo.length ? `<p class="chip chip-aviso" style="display:block;border-radius:10px;padding:8px 12px;">⚠️ ${conEquipo.length} de estas piezas figuran ahora mismo instaladas en equipos de Equipos. No se marcarán como «instaladas» (se guarda el MC donde figuran como referencia): solo se detectará una instalación si cambian a otro MC. Si salen de esos equipos para entregarse, es lo normal.</p>` : ""}
    <div class="scroll-x-tabla" style="max-height:300px;"><table class="tabla-revision"><thead><tr><th>#</th><th>Serial</th><th>Pieza</th><th>Situación</th></tr></thead><tbody>${filas}</tbody></table></div>
    ${validas.length ? `<div class="fila-form"><button type="button" class="btn-primario" id="e-guardar">✅ Registrar ${validas.length} piezas</button></div>` : ""}`;
  const g = document.getElementById("e-guardar");
  if (g) g.addEventListener("click", guardarEntrega);
});

async function guardarEntrega() {
  const cliente = document.getElementById("e-cliente").value.trim();
  if (!cliente) { alert("Escribe el cliente."); return; }
  const validas = planNueva.filter(p => !p.conflicto);
  if (!validas.length) return;
  if (!confirm(`¿Registrar ${validas.length} piezas entregadas a ${cliente}?`)) return;
  const btn = document.getElementById("e-guardar"); btn.disabled = true; btn.textContent = "Guardando…";
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: ent, error } = await supabaseClient.from("entregas_cliente").insert({
    cliente, fecha: document.getElementById("e-fecha").value || hoyISO(), albaran: document.getElementById("e-albaran").value.trim() || null,
    nota: document.getElementById("e-nota").value.trim() || null, creada_por: user ? user.email : null }).select().single();
  if (error) { alert("No se pudo guardar la entrega: " + error.message + " (¿corriste el SQL 108?)"); btn.disabled = false; btn.textContent = "Registrar"; return; }
  const filas = validas.map(p => ({ entrega_id: ent.id, tipo: p.tipo, subtipo: p.subtipo, categoria: p.categoria, serial: p.serial, mc_base: p.mc_base }));
  for (let k = 0; k < filas.length; k += 100) {
    const { error: e2 } = await supabaseClient.from("entregas_cliente_items").insert(filas.slice(k, k + 100));
    if (e2) { alert("Se creó la entrega pero falló al guardar piezas: " + e2.message + (e2.code === "23505" ? " (algún serial ya está en stock de un cliente)" : "")); await cargar(); return; }
  }
  planNueva = [];
  ["e-texto", "e-albaran", "e-nota"].forEach(i => { document.getElementById(i).value = ""; });
  document.getElementById("e-excel").value = "";
  document.getElementById("e-resultado").innerHTML = `<p>✅ Entrega registrada (${filas.length} piezas).</p>`;
  await cargar();
}

cargar();
