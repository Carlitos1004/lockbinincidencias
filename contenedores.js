// =========================================================================
// PÁGINA DE CONTENEDORES (manager)
// Lista y detalle de contenedores por ESTANCIAS: qué MC ha estado en cada
// contenedor y entre qué fechas, visitas durante cada estancia, número y nota.
// Usa contenedores-core.js y las tablas contenedor_estancia (SQL 97) y
// contenedores (SQL 95).
// =========================================================================

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtFecha = f => f ? new Date(f).toLocaleDateString("es-ES") : "—";

let filasEst = [];         // contenedor_estancia completo
let datosCont = {};        // contenedor_id -> {numero, nota}
let contenedorAbierto = null;

async function traerTodo(tabla, columnas, orden) {
  let todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from(tabla).select(columnas).order(orden).range(desde, desde + 999);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return todas;
}

async function cargar() {
  const tbody = document.getElementById("tbody-cont");
  try {
    filasEst = await traerTodo("contenedor_estancia", "*", "id");
    datosCont = {};
    try { (await traerTodo("contenedores", "*", "contenedor_id")).forEach(r => { datosCont[r.contenedor_id] = r; }); } catch (e) { console.warn("Sin tabla contenedores (SQL 95)", e.message); }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${esc(err.message)} (¿Corriste el SQL 97?)</td></tr>`;
    return;
  }
  llenarFiltroCliente();
  await pintarLista();
  cargarPendientes();
}

// Lista de clientes (según las OT de las estancias) para el filtro
function llenarFiltroCliente() {
  const sel = document.getElementById("filtro-cliente");
  const actual = sel.value;
  const mapa = {};
  filasEst.forEach(r => { const c = (r.cliente || "").trim(); if (c) mapa[c.toUpperCase()] = c.toUpperCase(); });
  sel.innerHTML = `<option value="">Todos los clientes</option>` + Object.keys(mapa).sort((a, b) => a.localeCompare(b)).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = actual;
}

function gruposPorId() {
  const g = {};
  filasEst.forEach(r => { (g[r.contenedor_id] = g[r.contenedor_id] || []).push(r); });
  Object.keys(g).forEach(id => g[id].sort(ordenEstancias));
  Object.keys(datosCont).forEach(id => { if (datosCont[id].numero && !g[id]) g[id] = []; });
  return g;
}
const mcsDe = (g, id) => [...new Set((g[id] || []).map(r => r.m_control))].concat((g[id] || []).length ? [] : [id]);
const clientesDe = (g, id) => [...new Set((g[id] || []).map(r => (r.cliente || "").trim()).filter(Boolean))];
const distintosClientes = lista => new Set(lista.map(c => c.toLowerCase())).size > 1;

async function pintarLista(textoBusqueda) {
  const tbody = document.getElementById("tbody-cont");
  const q = (textoBusqueda || "").trim().toUpperCase();
  const g = gruposPorId();
  let ids = Object.keys(g).filter(id => mcsDe(g, id).length > 1 || (datosCont[id] && datosCont[id].numero));
  if (q) ids = ids.filter(id => id.toUpperCase().includes(q) || String((datosCont[id] || {}).numero || "").toUpperCase() === q || mcsDe(g, id).some(m => m.toUpperCase().includes(q))
    || g[id].some(r => String(r.id_ot_entrada || "").toUpperCase().includes(q) || String(r.id_ot_salida || "").toUpperCase().includes(q)));
  const cli = document.getElementById("filtro-cliente").value;
  if (cli) ids = ids.filter(id => clientesDe(g, id).some(c => c.toUpperCase() === cli));
  if (document.getElementById("solo-mixtos").checked) ids = ids.filter(id => distintosClientes(clientesDe(g, id)));
  ids.sort((a, b) => a.localeCompare(b));
  if (!ids.length) {
    tbody.innerHTML = `<tr><td colspan="6">${q || cli || document.getElementById("solo-mixtos").checked ? "Ningún contenedor coincide." : "Todavía no hay contenedores con varios MC. Corre el SQL 97 o se irán creando al cambiar MC en Ruta."}</td></tr>`;
    return;
  }
  const info = { estancias: g, miembros: Object.fromEntries(ids.map(id => [id, mcsDe(g, id)])) };
  const visitas = await visitasDeContenedores(supabaseClient, info, ids);
  tbody.innerHTML = ids.map(id => {
    const ult = (visitas[id] || [])[0];
    const cls = clientesDe(g, id);
    const ultCambio = [...g[id]].filter(r => r.desde).sort((a, b) => (a.desde < b.desde ? 1 : -1))[0];
    return `<tr class="orep-fila" data-id="${esc(id)}">
      <td><strong>${esc((datosCont[id] || {}).numero || "—")}</strong></td>
      <td>${distintosClientes(cls) ? "⚠️ " : ""}${esc(cls.join(" / ") || "—")}</td>
      <td>${esc(id)}</td>
      <td>${esc(mcsDe(g, id).join(" → "))}</td>
      <td>${ultCambio ? fmtFecha(ultCambio.desde) + (ultCambio.id_ot_entrada ? " (" + esc(ultCambio.id_ot_entrada) + ")" : "") : "—"}</td>
      <td>${ult ? fmtFecha(ult.fecha) + " (" + esc(ult.id_ot) + ")" : "—"}</td></tr>`;
  }).join("");
  tbody.querySelectorAll(".orep-fila").forEach(tr => tr.addEventListener("click", () => abrirContenedor(tr.dataset.id)));
}

// Buscar: por MC (aunque no esté enlazado) o por número de contenedor
document.getElementById("buscar-btn").addEventListener("click", buscar);
document.getElementById("buscar-cont").addEventListener("keydown", e => { if (e.key === "Enter") buscar(); });
async function buscar() {
  const q = document.getElementById("buscar-cont").value.trim().toUpperCase();
  const msg = document.getElementById("msg-lista");
  msg.textContent = "";
  await pintarLista(q);
  if (!q) return;
  const porNum = Object.values(datosCont).find(d => String(d.numero || "").toUpperCase() === q);
  if (porNum) { abrirContenedor(porNum.contenedor_id); return; }
  if (/^MC\d+/.test(q)) {
    const r = await resolverContenedores(supabaseClient, [q]);
    abrirContenedor(r.contenedorDe[q]);
  }
}

async function abrirContenedor(id) {
  contenedorAbierto = id;
  const cont = document.getElementById("detalle-cont");
  cont.hidden = false;
  cont.innerHTML = `<div class="caja-cont">Cargando...</div>`;
  const g = gruposPorId();
  const estancias = g[id] || [];
  const mcs = mcsDe(g, id);
  const info = datosCont[id] || {};

  const { data: eqs } = await supabaseClient.from("equipos").select("m_control, cliente, fraccion, estado_montaje, fecha_instalacion").in("m_control", mcs);
  const eqPor = {}; (eqs || []).forEach(e => { eqPor[e.m_control] = e; });
  const visitasC = await visitasDeContenedores(supabaseClient, { estancias: g, miembros: { [id]: mcs } }, [id]);
  const todas = visitasC[id] || [];

  const trEst = (estancias.length ? estancias : [{ m_control: id, desde: null, hasta: null, origen: "inicial" }]).map(r => {
    const e = eqPor[r.m_control] || {};
    return `<tr>
      <td><strong>${esc(r.m_control)}</strong>${r.m_control === id ? " <small>(origen)</small>" : ""}${e.estado_montaje ? `<br><small>${esc(e.estado_montaje)}${e.fraccion ? " · " + esc(e.fraccion) : ""}</small>` : ""}</td>
      <td>${r.desde ? fmtFecha(r.desde) : "desde el inicio"}</td>
      <td>${r.hasta ? fmtFecha(r.hasta) : "<strong>sigue puesto</strong>"}</td>
      <td>${esc(r.cliente || "—")}</td>
      <td>${esc(r.mc_anterior || "—")}</td>
      <td>${r.id_ot_entrada ? esc(r.id_ot_entrada) : "—"} → ${r.id_ot_salida ? esc(r.id_ot_salida) : "—"}</td>
      <td>${esc(r.origen || "—")}</td>
      <td>${r.id ? `<button type="button" class="sec btn-quitar" data-id="${r.id}" data-mc="${esc(r.m_control)}">Quitar</button>` : ""}</td></tr>`;
  }).join("");
  const trVis = todas.length ? todas.map(h => `<tr>
      <td>${fmtFecha(h.fecha)}</td><td><a href="ot-detalle.html?ot=${encodeURIComponent(h.id_ot)}">${esc(h.id_ot)}</a></td><td>${esc(h.m_control)}</td><td>${esc(h.cliente || "—")}</td>
      <td>${esc(h.falla || "")}</td><td>${esc(h.accion_calle || h.comentarios || "")}</td></tr>`).join("")
    : `<tr><td colspan="6">Sin visitas registradas.</td></tr>`;

  const clientesCont = clientesDe(g, id);
  const avisoMixto = distintosClientes(clientesCont)
    ? `<p class="msg-cont" style="color:#c0392b;font-weight:700;">⚠️ Las estancias de este contenedor figuran con clientes distintos (${esc(clientesCont.join(" / "))}). Revisa y quita la estancia que no corresponda.</p>` : "";
  cont.innerHTML = `<div class="caja-cont">
    <h3>Contenedor ${esc(info.numero ? "Nº " + info.numero + " · " : "")}${esc(id)}</h3>
    ${avisoMixto}
    <div class="fila-form">
      <label>Número: <input type="text" id="cont-numero" value="${esc(info.numero || "")}" placeholder="Ej: 115" style="width:110px;"></label>
      <label style="flex:1;min-width:240px;">Nota: <input type="text" id="cont-nota" value="${esc(info.nota || "")}" placeholder="Ubicación, referencia..." style="width:100%;"></label>
      <button type="button" id="cont-guardar">Guardar</button>
    </div>
    <p id="cont-msg" class="msg-cont"></p>

    <h4>Estancias: qué MC ha tenido este contenedor y cuándo</h4>
    <div class="scroll-x-tabla" style="max-height:none;"><table class="tabla-revision">
      <thead><tr><th>MC</th><th>Desde</th><th>Hasta</th><th>Cliente (OT)</th><th>MC anterior</th><th>OT entrada → salida</th><th>Origen</th><th></th></tr></thead>
      <tbody>${trEst}</tbody></table></div>
    <div class="fila-form">
      <input type="text" id="cont-add" placeholder="Añadir MC a este contenedor (ej: MC2501432)" style="min-width:290px;">
      <label>desde <input type="date" id="cont-add-fecha" value="${new Date().toISOString().slice(0, 10)}"></label>
      <button type="button" id="cont-add-btn">Añadir</button>
    </div>
    <p class="msg-cont" style="color:#555;">Al añadir un MC, el que estaba puesto en este contenedor termina su estancia en esa fecha, y si el MC estaba en otro contenedor también se cierra allí.</p>

    <h4>Visitas durante las estancias</h4>
    <div class="scroll-x-tabla" style="max-height:360px;"><table class="tabla-revision">
      <thead><tr><th>Fecha</th><th>OT</th><th>MC</th><th>Cliente</th><th>Falla</th><th>Acción</th></tr></thead>
      <tbody>${trVis}</tbody></table></div>
    <div class="fila-form"><button type="button" class="sec" id="cont-cerrar">Cerrar</button></div>
  </div>`;
  cont.scrollIntoView({ behavior: "smooth" });

  document.getElementById("cont-cerrar").onclick = () => { cont.hidden = true; contenedorAbierto = null; };
  document.getElementById("cont-guardar").onclick = () => guardarDatos(id);
  document.getElementById("cont-add-btn").onclick = () => anadirMc(id);
  cont.querySelectorAll(".btn-quitar").forEach(b => b.onclick = () => quitarEstancia(id, b.dataset.id, b.dataset.mc));
}

function mensaje(texto, error) {
  const el = document.getElementById("cont-msg");
  if (!el) return;
  el.textContent = texto; el.style.color = error ? "#c0392b" : "#2e7d32";
}

async function guardarDatos(id) {
  const numero = document.getElementById("cont-numero").value.trim() || null;
  const nota = document.getElementById("cont-nota").value.trim() || null;
  const { error } = await supabaseClient.from("contenedores").upsert({ contenedor_id: id, numero, nota, actualizado_en: new Date().toISOString() }, { onConflict: "contenedor_id" });
  if (error) { mensaje("No se pudo guardar: " + error.message + " (¿Corriste el SQL 95?)", true); return; }
  datosCont[id] = { contenedor_id: id, numero, nota };
  mensaje("✅ Guardado.");
  await pintarLista();
}

async function anadirMc(id) {
  const mc = document.getElementById("cont-add").value.trim().toUpperCase();
  const fecha = document.getElementById("cont-add-fecha").value || new Date().toISOString().slice(0, 10);
  if (!/^MC\d+/.test(mc)) { mensaje("Escribe un MC válido (ej: MC2501432).", true); return; }
  try {
    const hay = filasEst.filter(r => r.contenedor_id === id);
    // El contenedor "vacío" (solo su MC de origen) necesita su estancia inicial
    if (!hay.length && mc !== id) {
      const { error } = await supabaseClient.from("contenedor_estancia").insert({ contenedor_id: id, m_control: id, desde: null, hasta: fecha, origen: "manual" });
      if (error) throw error;
    } else {
      // el MC que estaba puesto termina su estancia
      for (const r of hay.filter(r => !r.hasta)) {
        if (r.m_control === mc) { mensaje(`${mc} ya está puesto en este contenedor.`, true); return; }
        const { error } = await supabaseClient.from("contenedor_estancia").update({ hasta: fecha }).eq("id", r.id);
        if (error) throw error;
      }
    }
    // el MC añadido deja de estar en cualquier otro sitio
    for (const r of filasEst.filter(r => r.m_control === mc && !r.hasta)) {
      await supabaseClient.from("contenedor_estancia").update({ hasta: fecha }).eq("id", r.id);
    }
    const { error } = await supabaseClient.from("contenedor_estancia").insert({ contenedor_id: id, m_control: mc, desde: fecha, hasta: null, origen: "manual" });
    if (error) throw error;
  } catch (err) { mensaje("No se pudo añadir: " + (err.message || err), true); return; }
  await cargar();
  abrirContenedor(id);
}

async function quitarEstancia(id, estId, mc) {
  if (!confirm(`¿Quitar la estancia de ${mc} en este contenedor? Sus visitas dejarán de contarse aquí. (No se reabre la estancia anterior: ajusta su fecha "hasta" si hace falta.)`)) return;
  const { error } = await supabaseClient.from("contenedor_estancia").delete().eq("id", estId);
  if (error) { mensaje("No se pudo quitar: " + error.message, true); return; }
  await cargar();
  abrirContenedor(id);
}

// ---------- Cambios de MC registrados en las OT que aún no están en ningún contenedor ----------
let pendientes = [];
async function cargarPendientes() {
  const tbody = document.getElementById("tbody-pend");
  try {
    let filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabaseClient.from("historial_fallas")
        .select("m_control, id_ot, fecha, nuevo_serial, cliente").ilike("nuevo_serial", "%MC%").order("fecha", { ascending: false }).range(desde, desde + 999);
      if (error) throw error;
      filas = filas.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const g = gruposPorId();
    // estancias registradas por (MC nuevo, OT de entrada) y por contenedor del MC retirado
    const registrado = new Set(filasEst.filter(r => r.id_ot_entrada).map(r => r.m_control + "|" + r.id_ot_entrada));
    const vistos = new Set();
    pendientes = [];
    filas.forEach(h => {
      const viejo = String(h.m_control || "").toUpperCase();
      String(h.nuevo_serial || "").toUpperCase().split(/[\s,;]+/).filter(t => /^MC\d+$/.test(t)).forEach(nuevo => {
        if (nuevo === viejo || !/^MC\d+$/.test(viejo)) return;
        if (registrado.has(nuevo + "|" + h.id_ot)) return;
        const clave = viejo + ">" + nuevo + ">" + h.id_ot;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        // ¿el contenedor donde estaba el MC retirado pertenece a otro cliente?
        const stViejo = filasEst.filter(r => r.m_control === viejo && dentroDeEstancia(h.fecha, r)).pop();
        const clientesCont = stViejo ? clientesDe(g, stViejo.contenedor_id) : [];
        const cli = (h.cliente || "").trim().toLowerCase();
        const sospechoso = !!(cli && clientesCont.length && !clientesCont.some(c => c.toLowerCase() === cli));
        pendientes.push({ viejo, nuevo, id_ot: h.id_ot, fecha: h.fecha, cliente: h.cliente || "", sospechoso, clientesCont });
      });
    });
    document.getElementById("enlazar-todos").hidden = pendientes.filter(p => !p.sospechoso).length < 2;
    if (!pendientes.length) { tbody.innerHTML = `<tr><td colspan="6">No hay cambios de MC pendientes de registrar en contenedores. ✅</td></tr>`; return; }
    tbody.innerHTML = pendientes.map((p, i) => `<tr>
      <td>${fmtFecha(p.fecha)}</td><td><a href="ot-detalle.html?ot=${encodeURIComponent(p.id_ot)}">${esc(p.id_ot)}</a></td>
      <td>${esc(p.viejo)}<br><small>${esc(p.cliente || "—")}</small></td><td>${esc(p.nuevo)}</td>
      <td>${p.sospechoso ? `<span style="color:#c0392b;font-weight:700;">⚠️ El contenedor del MC retirado figura con otro cliente (${esc(p.clientesCont.join(" / "))})</span>` : ""}</td>
      <td><button type="button" class="btn-enlazar-pend" data-i="${i}">Enlazar</button></td></tr>`).join("");
    tbody.querySelectorAll(".btn-enlazar-pend").forEach(b => b.addEventListener("click", async () => {
      const p = pendientes[parseInt(b.dataset.i, 10)];
      b.disabled = true;
      const r = await registrarCambioMc(supabaseClient, p.viejo, p.nuevo, p.id_ot, "historial", p.fecha, p.cliente);
      if (!r.ok) { alert("No se pudo enlazar: " + r.error); b.disabled = false; return; }
      await cargar();
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById("enlazar-todos").addEventListener("click", async () => {
  const lista = pendientes.filter(p => !p.sospechoso);
  if (!confirm(`¿Registrar los ${lista.length} cambios sin problema? (Los ${pendientes.length - lista.length} marcados con ⚠️ se dejan para revisar a mano.)`)) return;
  const msg = document.getElementById("msg-pend");
  let ok = 0;
  // en orden cronológico, para que las cadenas se formen bien
  for (const p of [...lista].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))) {
    msg.textContent = `Enlazando... ${ok}/${lista.length}`;
    const r = await registrarCambioMc(supabaseClient, p.viejo, p.nuevo, p.id_ot, "historial", p.fecha, p.cliente);
    if (r.ok) ok++;
  }
  msg.textContent = `✅ ${ok} registrados.`;
  await cargar();
});

document.getElementById("filtro-cliente").addEventListener("change", () => pintarLista(document.getElementById("buscar-cont").value));
document.getElementById("solo-mixtos").addEventListener("change", () => pintarLista(document.getElementById("buscar-cont").value));

cargar();
