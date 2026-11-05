// =========================================================================
// PÁGINA DE CONTENEDORES (manager)
// Lista y detalle de contenedores: MC que ha tenido, visitas, número, nota,
// y enlazar / quitar MC. Usa contenedores-core.js y las tablas contenedor_mc
// y contenedores (SQL 93 y 95).
// =========================================================================

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtFecha = f => f ? new Date(f).toLocaleDateString("es-ES") : "—";

let filasMc = [];          // contenedor_mc completo
let datosCont = {};        // contenedor_id -> {numero, nota}
let contenedorAbierto = null;

async function traerTodo(tabla, columnas) {
  let todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from(tabla).select(columnas).order(tabla === "contenedor_mc" ? "m_control" : "contenedor_id").range(desde, desde + 999);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return todas;
}

async function cargar() {
  const tbody = document.getElementById("tbody-cont");
  try {
    filasMc = await traerTodo("contenedor_mc", "*");
    datosCont = {};
    try { (await traerTodo("contenedores", "*")).forEach(r => { datosCont[r.contenedor_id] = r; }); } catch (e) { console.warn("Sin tabla contenedores (SQL 95)", e.message); }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Error: ${esc(err.message)} (¿Corriste el SQL 93?)</td></tr>`;
    return;
  }
  await pintarLista();
  cargarPendientes();
}

function gruposPorId() {
  const g = {};
  filasMc.forEach(r => { (g[r.contenedor_id] = g[r.contenedor_id] || []).push(r); });
  Object.keys(datosCont).forEach(id => { if (datosCont[id].numero && !g[id]) g[id] = []; });
  return g;
}

async function pintarLista(textoBusqueda) {
  const tbody = document.getElementById("tbody-cont");
  const q = (textoBusqueda || "").trim().toUpperCase();
  const g = gruposPorId();
  let ids = Object.keys(g).filter(id => g[id].length > 1 || (datosCont[id] && datosCont[id].numero));
  if (q) ids = ids.filter(id => id.toUpperCase().includes(q) || String((datosCont[id] || {}).numero || "").toUpperCase() === q || g[id].some(r => r.m_control.toUpperCase().includes(q)));
  ids.sort((a, b) => a.localeCompare(b));
  if (!ids.length) { tbody.innerHTML = `<tr><td colspan="4">${q ? "Ningún contenedor enlazado coincide." : "Todavía no hay contenedores con varios MC. Se irán creando al cambiar MC en Ruta."}</td></tr>`; return; }
  // última visita por contenedor (una consulta para todos los MC mostrados)
  const todosMc = [...new Set(ids.flatMap(id => [id, ...g[id].map(r => r.m_control)]))];
  const visitas = await visitasPorMc(supabaseClient, todosMc);
  tbody.innerHTML = ids.map(id => {
    const mcs = [...new Set([id, ...g[id].map(r => r.m_control)])];
    const ult = mcs.flatMap(m => visitas[m] || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
    return `<tr class="orep-fila" data-id="${esc(id)}">
      <td><strong>${esc((datosCont[id] || {}).numero || "—")}</strong></td>
      <td>${esc(id)}</td>
      <td>${esc(mcs.join(" → "))}</td>
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
  // por número exacto
  const porNum = Object.values(datosCont).find(d => String(d.numero || "").toUpperCase() === q);
  if (porNum) { abrirContenedor(porNum.contenedor_id); return; }
  // por MC (enlazado o no)
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
  const filas = filasMc.filter(r => r.contenedor_id === id);
  const mcs = [...new Set([id, ...filas.map(r => r.m_control)])];
  const info = datosCont[id] || {};

  const { data: eqs } = await supabaseClient.from("equipos").select("m_control, cliente, fraccion, estado_montaje, fecha_instalacion").in("m_control", mcs);
  const eqPor = {}; (eqs || []).forEach(e => { eqPor[e.m_control] = e; });
  const visitas = await visitasPorMc(supabaseClient, mcs);
  const todas = mcs.flatMap(m => visitas[m] || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const filaDe = Object.fromEntries(filas.map(r => [r.m_control, r]));
  const trMc = mcs.map(m => {
    const r = filaDe[m] || {}, e = eqPor[m] || {};
    const esRaiz = m === id;
    return `<tr>
      <td><strong>${esc(m)}</strong>${esRaiz ? " <small>(origen)</small>" : ""}</td>
      <td>${esc(e.cliente || "—")}</td><td>${esc(e.fraccion || "—")}</td><td>${esc(e.estado_montaje || "—")}${e.fecha_instalacion ? "<br><small>instalado " + fmtFecha(e.fecha_instalacion) + "</small>" : ""}</td>
      <td>${esc(r.mc_anterior || "—")}</td><td>${r.id_ot ? esc(r.id_ot) : "—"}${r.fecha ? "<br><small>" + fmtFecha(r.fecha) + "</small>" : ""}</td><td>${esc(r.origen || (esRaiz ? "inicial" : "—"))}</td>
      <td>${esRaiz ? "" : `<button type="button" class="sec btn-quitar" data-mc="${esc(m)}">Quitar</button>`}</td></tr>`;
  }).join("");
  const trVis = todas.length ? todas.map(h => `<tr>
      <td>${fmtFecha(h.fecha)}</td><td><a href="ot-detalle.html?ot=${encodeURIComponent(h.id_ot)}">${esc(h.id_ot)}</a></td><td>${esc(h.m_control)}</td>
      <td>${esc(h.falla || "")}</td><td>${esc(h.accion_calle || h.comentarios || "")}</td></tr>`).join("")
    : `<tr><td colspan="5">Sin visitas registradas.</td></tr>`;

  cont.innerHTML = `<div class="caja-cont">
    <h3>Contenedor ${esc(info.numero ? "Nº " + info.numero + " · " : "")}${esc(id)}</h3>
    <div class="fila-form">
      <label>Número: <input type="text" id="cont-numero" value="${esc(info.numero || "")}" placeholder="Ej: 115" style="width:110px;"></label>
      <label style="flex:1;min-width:240px;">Nota: <input type="text" id="cont-nota" value="${esc(info.nota || "")}" placeholder="Ubicación, referencia..." style="width:100%;"></label>
      <button type="button" id="cont-guardar">Guardar</button>
    </div>
    <p id="cont-msg" class="msg-cont"></p>

    <h4>MC que ha tenido este contenedor</h4>
    <div class="scroll-x-tabla" style="max-height:none;"><table class="tabla-revision">
      <thead><tr><th>MC</th><th>Cliente</th><th>Fracción</th><th>Estado</th><th>MC anterior</th><th>OT / fecha del cambio</th><th>Origen</th><th></th></tr></thead>
      <tbody>${trMc}</tbody></table></div>
    <div class="fila-form">
      <input type="text" id="cont-add" placeholder="Añadir MC a este contenedor (ej: MC2501432)" style="min-width:290px;">
      <button type="button" id="cont-add-btn">Añadir</button>
    </div>

    <h4>Visitas de todos sus MC</h4>
    <div class="scroll-x-tabla" style="max-height:360px;"><table class="tabla-revision">
      <thead><tr><th>Fecha</th><th>OT</th><th>MC</th><th>Falla</th><th>Acción</th></tr></thead>
      <tbody>${trVis}</tbody></table></div>
    <div class="fila-form"><button type="button" class="sec" id="cont-cerrar">Cerrar</button></div>
  </div>`;
  cont.scrollIntoView({ behavior: "smooth" });

  document.getElementById("cont-cerrar").onclick = () => { cont.hidden = true; contenedorAbierto = null; };
  document.getElementById("cont-guardar").onclick = () => guardarDatos(id);
  document.getElementById("cont-add-btn").onclick = () => anadirMc(id);
  cont.querySelectorAll(".btn-quitar").forEach(b => b.onclick = () => quitarMc(id, b.dataset.mc));
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
  if (!/^MC\d+/.test(mc)) { mensaje("Escribe un MC válido (ej: MC2501432).", true); return; }
  if (mc === id) { mensaje("Ese es el MC de origen de este contenedor.", true); return; }
  const existente = filasMc.find(r => r.m_control === mc);
  if (existente && existente.contenedor_id !== id &&
      !confirm(`${mc} ya pertenece al contenedor ${existente.contenedor_id}. ¿Moverlo a ${id}?`)) return;
  // si el MC era el origen de otro contenedor, sus MC se mueven con él
  const hijos = filasMc.filter(r => r.contenedor_id === mc && r.m_control !== mc);
  const filas = [{ m_control: mc, contenedor_id: id, origen: "manual", fecha: new Date().toISOString().slice(0, 10) },
    ...hijos.map(r => ({ m_control: r.m_control, contenedor_id: id, mc_anterior: r.mc_anterior, origen: r.origen, id_ot: r.id_ot, fecha: r.fecha }))];
  if (!filasMc.some(r => r.m_control === id)) filas.push({ m_control: id, contenedor_id: id, origen: "inicial" });
  const { error } = await supabaseClient.from("contenedor_mc").upsert(filas, { onConflict: "m_control" });
  if (error) { mensaje("No se pudo añadir: " + error.message, true); return; }
  await cargar();
  abrirContenedor(id);
}

async function quitarMc(id, mc) {
  if (!confirm(`¿Quitar ${mc} de este contenedor? Pasará a contar como un contenedor propio.`)) return;
  const { error } = await supabaseClient.from("contenedor_mc").delete().eq("m_control", mc);
  if (error) { mensaje("No se pudo quitar: " + error.message + " (¿Corriste el SQL 95?)", true); return; }
  await cargar();
  abrirContenedor(id);
}

// ---------- Cambios de MC registrados en las OT que aún no están enlazados ----------
let pendientes = [];
async function cargarPendientes() {
  const tbody = document.getElementById("tbody-pend");
  try {
    let filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabaseClient.from("historial_fallas")
        .select("m_control, id_ot, fecha, nuevo_serial").ilike("nuevo_serial", "%MC%").order("fecha", { ascending: false }).range(desde, desde + 999);
      if (error) throw error;
      filas = filas.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const contDe = {};
    filasMc.forEach(r => { contDe[r.m_control] = r.contenedor_id; });
    const cid = mc => contDe[mc] || mc;
    const vistos = new Set();
    pendientes = [];
    filas.forEach(h => {
      const viejo = String(h.m_control || "").toUpperCase();
      String(h.nuevo_serial || "").toUpperCase().split(/[\s,;]+/).filter(t => /^MC\d+$/.test(t)).forEach(nuevo => {
        if (nuevo === viejo || !/^MC\d+$/.test(viejo)) return;
        if (cid(nuevo) === cid(viejo)) return; // ya enlazados
        const clave = viejo + ">" + nuevo;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        pendientes.push({ viejo, nuevo, id_ot: h.id_ot, fecha: h.fecha });
      });
    });
    document.getElementById("enlazar-todos").hidden = pendientes.length < 2;
    if (!pendientes.length) { tbody.innerHTML = `<tr><td colspan="5">No hay cambios de MC pendientes de enlazar en las OT. ✅</td></tr>`; return; }
    tbody.innerHTML = pendientes.map((p, i) => `<tr>
      <td>${fmtFecha(p.fecha)}</td><td><a href="ot-detalle.html?ot=${encodeURIComponent(p.id_ot)}">${esc(p.id_ot)}</a></td>
      <td>${esc(p.viejo)}</td><td>${esc(p.nuevo)}</td>
      <td><button type="button" class="btn-enlazar-pend" data-i="${i}">Enlazar</button></td></tr>`).join("");
    tbody.querySelectorAll(".btn-enlazar-pend").forEach(b => b.addEventListener("click", async () => {
      const p = pendientes[parseInt(b.dataset.i, 10)];
      b.disabled = true;
      const r = await vincularMcContenedor(supabaseClient, p.viejo, p.nuevo, p.id_ot, "historial");
      if (!r.ok) { alert("No se pudo enlazar: " + r.error); b.disabled = false; return; }
      await cargar();
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${esc(err.message)}</td></tr>`;
  }
}

document.getElementById("enlazar-todos").addEventListener("click", async () => {
  if (!confirm(`¿Enlazar los ${pendientes.length} cambios de la lista? Revisa antes que sean correctos.`)) return;
  const msg = document.getElementById("msg-pend");
  let ok = 0;
  // en orden cronológico, para que las cadenas se formen bien
  for (const p of [...pendientes].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))) {
    msg.textContent = `Enlazando... ${ok}/${pendientes.length}`;
    const r = await vincularMcContenedor(supabaseClient, p.viejo, p.nuevo, p.id_ot, "historial");
    if (r.ok) ok++;
  }
  msg.textContent = `✅ ${ok} enlazados.`;
  await cargar();
});

cargar();
