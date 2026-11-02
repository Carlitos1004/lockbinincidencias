// =========================================================================
// ÓRDENES DE PRESUPUESTO (vandalismo) — solo manager. Solo seguimiento.
// Estados: Borrador -> Presupuesto enviado -> Presupuesto aprobado ->
//          Equipos repuestos   (o Presupuesto rechazado)
// =========================================================================

let ordenes = [];          // ordenes_presupuesto
let lineasPorOrden = {};   // orden_id -> [lineas]
let ordenActual = null;
let disponibles = [];      // piezas vandalizadas del cliente de la orden abierta, aún sin orden

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const codigo = n => "PRE-" + String(n).padStart(3, "0");
const hoy = () => new Date().toISOString().slice(0, 10);
const fmt = f => f ? new Date(f + "T00:00:00").toLocaleDateString("es-ES") : "—";

function claseEstado(e) {
  return { "Borrador": "orep-gris", "Presupuesto enviado": "orep-proc", "Presupuesto aprobado": "orep-ok",
           "Presupuesto rechazado": "orep-falta", "Equipos repuestos": "orep-info" }[e] || "orep-gris";
}

// Supabase devuelve como máximo 1000 filas por consulta
async function traerTodo(construir) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await construir().range(desde, desde + 999);
    if (error) return { data: null, error };
    todas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: todas, error: null };
}

(async () => {
  await cargarNombresUsuarios();
  await cargar();
  await cargarClientes();
  const p = new URLSearchParams(location.search).get("pre");
  if (p) { const o = ordenes.find(x => String(x.numero) === String(parseInt(p, 10))); if (o) abrir(o.id); }
})();

async function cargar() {
  const tbody = document.getElementById("tbody-pre");
  const { data: ords, error } = await supabaseClient.from("ordenes_presupuesto").select("*").order("numero", { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="10">Error: ${esc(error.message)} (¿Corriste el SQL 84?)</td></tr>`; return; }
  ordenes = ords || [];
  const { data: lins, error: e2 } = await traerTodo(() => supabaseClient.from("presupuesto_lineas").select("*").order("id"));
  if (e2) { tbody.innerHTML = `<tr><td colspan="10">Error: ${esc(e2.message)}</td></tr>`; return; }
  lineasPorOrden = {};
  (lins || []).forEach(l => (lineasPorOrden[l.orden_id] = lineasPorOrden[l.orden_id] || []).push(l));
  renderLista();
}

function renderLista() {
  const tbody = document.getElementById("tbody-pre");
  const fe = document.getElementById("filtro-estado-pre").value;
  const ft = document.getElementById("filtro-texto-pre").value.trim().toLowerCase();
  const vis = ordenes.filter(o => {
    const ls = lineasPorOrden[o.id] || [];
    if (fe && o.estado !== fe) return false;
    if (!ft) return true;
    return codigo(o.numero).toLowerCase().includes(ft) || (o.numero_oferta || "").toLowerCase().includes(ft) ||
      (o.cliente || "").toLowerCase().includes(ft) || ls.some(l => l.m_control.toLowerCase().includes(ft));
  });
  if (!vis.length) { tbody.innerHTML = `<tr><td colspan="10">${ordenes.length ? "Ninguna orden coincide." : "Aún no hay órdenes de presupuesto."}</td></tr>`; return; }
  tbody.innerHTML = vis.map(o => {
    const ls = lineasPorOrden[o.id] || [];
    const mcs = new Set(ls.map(l => l.m_control)).size;
    return `<tr class="orep-fila ${ordenActual === o.id ? "orep-activa" : ""}" data-id="${o.id}">
      <td><strong>${codigo(o.numero)}</strong></td><td>${esc(o.numero_oferta || "—")}</td><td>${esc(o.cliente)}</td>
      <td><span class="orep-badge ${claseEstado(o.estado)}">${esc(o.estado)}</span></td>
      <td>${ls.length}</td><td>${ls.filter(l => l.aprobada === true).length}</td><td>${mcs}</td>
      <td>${fmt(o.fecha_enviado)}</td><td>${fmt(o.fecha_aprobado)}</td><td>${fmt(o.fecha_repuesto)}</td></tr>`;
  }).join("");
  tbody.querySelectorAll("tr.orep-fila").forEach(tr => tr.addEventListener("click", () => abrir(tr.dataset.id)));
}
document.getElementById("filtro-estado-pre").addEventListener("change", renderLista);
document.getElementById("filtro-texto-pre").addEventListener("input", renderLista);

// ---------- Crear ----------
async function cargarClientes() {
  const sel = document.getElementById("nueva-cliente");
  const { data, error } = await traerTodo(() => supabaseClient.from("componentes_retirados").select("id, cliente").eq("vandalismo", true).order("id"));
  if (error) { sel.innerHTML = `<option value="">Error: ${esc(error.message)}</option>`; return; }
  const { data: tk } = await traerTodo(() => supabaseClient.from("historial_fallas").select("id_registro, cliente").eq("vandalismo", true).order("id_registro"));
  const clientes = [...new Set([...(data || []), ...(tk || [])].map(c => c.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">Elige cliente...</option>' + clientes.map(c => `<option>${esc(c)}</option>`).join("");
}

document.getElementById("nueva-crear").addEventListener("click", async () => {
  const cliente = document.getElementById("nueva-cliente").value;
  const oferta = document.getElementById("nueva-oferta").value.trim();
  if (!cliente) { alert("Elige el cliente."); return; }
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data, error } = await supabaseClient.from("ordenes_presupuesto")
    .insert({ cliente, numero_oferta: oferta || null, creada_por: user ? user.email : null }).select().single();
  if (error) { alert("No se pudo crear: " + error.message); return; }
  document.getElementById("nueva-oferta").value = "";
  await cargar();
  abrir(data.id);
});

// ---------- Detalle ----------
async function abrir(id) {
  ordenActual = id;
  const o = ordenes.find(x => x.id === id);
  if (!o) return;
  document.getElementById("detalle").hidden = false;
  renderLista();
  pintarDetalle();
  await cargarDisponibles();
  document.getElementById("detalle").scrollIntoView({ behavior: "smooth" });
}

function pintarDetalle() {
  const o = ordenes.find(x => x.id === ordenActual);
  if (!o) return;
  const ls = lineasPorOrden[o.id] || [];
  document.getElementById("detalle-titulo").textContent =
    `${codigo(o.numero)} — ${o.cliente}${o.numero_oferta ? " — oferta " + o.numero_oferta : ""}`;
  const n = f => ls.filter(f).length;
  document.getElementById("detalle-resumen").innerHTML = `
    <div class="tarjeta-resumen"><strong>${new Set(ls.map(l => l.m_control)).size}</strong><span>Equipos</span></div>
    <div class="tarjeta-resumen"><strong>${ls.length}</strong><span>Piezas</span></div>
    <div class="tarjeta-resumen"><strong>${n(l => l.aprobada === true)}</strong><span>Aprobadas</span></div>
    <div class="tarjeta-resumen"><strong>${n(l => l.aprobada === null)}</strong><span>Pendientes</span></div>
    <div class="tarjeta-resumen"><strong>${n(l => l.aprobada === false)}</strong><span>Rechazadas</span></div>`;
  document.getElementById("det-oferta").value = o.numero_oferta || "";
  document.getElementById("det-estado").value = o.estado;
  document.getElementById("det-notas").value = o.notas || "";
  document.getElementById("det-fechas").textContent =
    `Creada el ${new Date(o.creada_en).toLocaleDateString("es-ES")} por ${nombreUsuario(o.creada_por)} · Enviado: ${fmt(o.fecha_enviado)} · Aprobado: ${fmt(o.fecha_aprobado)} · Repuesto: ${fmt(o.fecha_repuesto)}`;

  const sorted = [...ls].sort((a, b) => a.m_control.localeCompare(b.m_control) || (a.tipo_componente || "").localeCompare(b.tipo_componente || ""));
  document.getElementById("tbody-lineas").innerHTML = sorted.length ? sorted.map(l => `
    <tr data-id="${l.id}">
      <td>${esc(l.m_control)}</td><td>${esc(l.tipo_componente || "—")}</td><td>${esc(l.serial || "—")}</td>
      <td>${l.id_ot ? `<a href="ot-detalle.html?ot=${encodeURIComponent(l.id_ot)}">${esc(l.id_ot)}</a>` : "—"}</td>
      <td><select class="sel-aprob">
        <option value="" ${l.aprobada === null ? "selected" : ""}>Pendiente de respuesta</option>
        <option value="si" ${l.aprobada === true ? "selected" : ""}>✅ Acepta pagar</option>
        <option value="no" ${l.aprobada === false ? "selected" : ""}>❌ Rechaza</option>
      </select></td>
      <td><button type="button" class="btn-quitar-lin" title="Quitar de la orden">✕</button></td>
    </tr>`).join("") : '<tr><td colspan="6">La orden está vacía. Añade piezas abajo.</td></tr>';

  document.querySelectorAll(".sel-aprob").forEach(sel => sel.addEventListener("change", async () => {
    const v = sel.value === "si" ? true : sel.value === "no" ? false : null;
    const id = sel.closest("tr").dataset.id;
    const { error } = await supabaseClient.from("presupuesto_lineas").update({ aprobada: v }).eq("id", id);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    const l = (lineasPorOrden[ordenActual] || []).find(x => x.id === id); if (l) l.aprobada = v;
    pintarDetalle(); renderLista();
  }));
  document.querySelectorAll(".btn-quitar-lin").forEach(b => b.addEventListener("click", async () => {
    const id = b.closest("tr").dataset.id;
    const { error } = await supabaseClient.from("presupuesto_lineas").delete().eq("id", id);
    if (error) { alert("No se pudo quitar: " + error.message); return; }
    lineasPorOrden[ordenActual] = (lineasPorOrden[ordenActual] || []).filter(x => x.id !== id);
    pintarDetalle(); renderLista(); cargarDisponibles();
  }));
}

async function guardarOrden(cambios) {
  const { error } = await supabaseClient.from("ordenes_presupuesto").update(cambios).eq("id", ordenActual);
  if (error) { alert("No se pudo guardar: " + error.message); return false; }
  Object.assign(ordenes.find(x => x.id === ordenActual), cambios);
  return true;
}

document.getElementById("det-oferta").addEventListener("change", async e => {
  if (await guardarOrden({ numero_oferta: e.target.value.trim() || null })) { pintarDetalle(); renderLista(); }
});
document.getElementById("det-notas").addEventListener("change", async e => {
  await guardarOrden({ notas: e.target.value.trim() || null });
});

document.getElementById("det-estado").addEventListener("change", async e => {
  const o = ordenes.find(x => x.id === ordenActual);
  const nuevo = e.target.value;
  const ls = lineasPorOrden[o.id] || [];
  const cambios = { estado: nuevo };
  if (nuevo === "Presupuesto enviado") cambios.fecha_enviado = o.fecha_enviado || hoy();
  if (nuevo === "Presupuesto aprobado") {
    cambios.fecha_aprobado = o.fecha_aprobado || hoy();
    const pend = ls.filter(l => l.aprobada === null);
    if (pend.length && confirm(`Hay ${pend.length} pieza(s) sin respuesta. ¿Marcarlas todas como "Acepta pagar"?\n(Aceptar = sí, Cancelar = las dejo como están y las marcas una a una)`)) {
      const { error } = await supabaseClient.from("presupuesto_lineas").update({ aprobada: true }).in("id", pend.map(l => l.id));
      if (error) { alert("No se pudieron marcar: " + error.message); e.target.value = o.estado; return; }
      pend.forEach(l => { l.aprobada = true; });
    }
  }
  if (nuevo === "Equipos repuestos") {
    const aprob = ls.filter(l => l.aprobada === true);
    if (!aprob.length) { alert("No hay piezas aprobadas en esta orden."); e.target.value = o.estado; return; }
    const conComp = aprob.filter(l => l.componente_id && !String(l.componente_id).startsWith("T"));
    if (!confirm(`Se marcará la orden como repuesta (${aprob.length} pieza(s) aprobadas).\n` +
      (conComp.length ? `Además, ${conComp.length} pieza(s) pasarán a "Repuesto desde stock" en la Orden de reposición. ¿Continuar?` : "¿Continuar?"))) { e.target.value = o.estado; return; }
    cambios.fecha_repuesto = hoy();
    if (conComp.length) {
      const { error } = await supabaseClient.from("componentes_retirados")
        .update({ repo_estado: "Repuesto desde stock" }).in("id", conComp.map(l => l.componente_id));
      if (error) { alert("No se pudo actualizar la reposición: " + error.message); e.target.value = o.estado; return; }
    }
  }
  if (await guardarOrden(cambios)) { pintarDetalle(); renderLista(); }
  else e.target.value = o.estado;
});

document.getElementById("det-eliminar").addEventListener("click", async () => {
  const o = ordenes.find(x => x.id === ordenActual);
  if (!confirm(`¿Eliminar ${codigo(o.numero)} con todas sus piezas? Las piezas vuelven a estar disponibles para otra orden.`)) return;
  const { error } = await supabaseClient.from("ordenes_presupuesto").delete().eq("id", o.id);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  ordenActual = null; document.getElementById("detalle").hidden = true;
  await cargar();
});

// ---------- Añadir piezas ----------
async function cargarDisponibles() {
  const o = ordenes.find(x => x.id === ordenActual);
  const tb = document.getElementById("tbody-disp");
  tb.innerHTML = '<tr><td colspan="6">Cargando...</td></tr>';
  const { data, error } = await traerTodo(() => supabaseClient.from("componentes_retirados")
    .select("id, m_control, tipo_componente, serial_retirado, id_ot, destino").eq("vandalismo", true).eq("cliente", o.cliente).order("id"));
  if (error) { tb.innerHTML = `<tr><td colspan="6">Error: ${esc(error.message)}</td></tr>`; return; }
  // Tickets marcados como vandalismo en la OT (sin pieza concreta): entran como "Equipo completo"
  const { data: tks } = await traerTodo(() => supabaseClient.from("historial_fallas")
    .select("id_registro, m_control, id_ot, falla").eq("vandalismo", true).eq("cliente", o.cliente).order("id_registro"));
  const { data: usadas } = await traerTodo(() => supabaseClient.from("presupuesto_lineas").select("id, componente_id").not("componente_id", "is", null).order("id"));
  const usadasSet = new Set((usadas || []).map(l => String(l.componente_id)));
  const mcConPieza = new Set((data || []).map(c => c.m_control));
  const delTicket = [];
  (tks || []).forEach(t => {
    const clave = "T" + t.id_registro;
    if (!t.m_control || usadasSet.has(clave) || mcConPieza.has(t.m_control)) return;
    delTicket.push({ id: clave, m_control: t.m_control, tipo_componente: "Equipo completo", serial_retirado: null, id_ot: t.id_ot, destino: "Ticket vandalismo: " + (t.falla || "") });
  });
  disponibles = (data || []).filter(c => !usadasSet.has(String(c.id)) && c.m_control).concat(delTicket)
    .sort((a, b) => a.m_control.localeCompare(b.m_control));
  renderDisponibles();
}

function renderDisponibles() {
  const f = document.getElementById("disp-filtro").value.trim().toLowerCase();
  const vis = disponibles.filter(c => !f || c.m_control.toLowerCase().includes(f));
  document.getElementById("tbody-disp").innerHTML = vis.length ? vis.map(c => `
    <tr><td><input type="checkbox" class="chk-disp" data-id="${c.id}"></td><td>${esc(c.m_control)}</td>
    <td>${esc(c.tipo_componente || "—")}</td><td>${esc(c.serial_retirado || "—")}</td><td>${esc(c.id_ot || "—")}</td>
    <td>${esc((c.destino || "—").replace(/^[✓❌🚨]\s*/, ""))}</td></tr>`).join("")
    : '<tr><td colspan="6">No hay piezas vandalizadas libres de este cliente.</td></tr>';
}
document.getElementById("disp-filtro").addEventListener("input", renderDisponibles);
document.getElementById("disp-todas").addEventListener("click", () =>
  document.querySelectorAll(".chk-disp").forEach(c => { c.checked = true; }));

async function insertarLineas(filas) {
  const { data, error } = await supabaseClient.from("presupuesto_lineas").insert(filas).select();
  if (error) { alert("No se pudo añadir: " + error.message); return false; }
  lineasPorOrden[ordenActual] = (lineasPorOrden[ordenActual] || []).concat(data || []);
  pintarDetalle(); renderLista(); return true;
}

document.getElementById("disp-anadir").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".chk-disp:checked")].map(c => c.dataset.id);
  if (!ids.length) { alert("Marca al menos una pieza."); return; }
  const filas = disponibles.filter(c => ids.includes(String(c.id))).map(c => ({
    orden_id: ordenActual, m_control: c.m_control, tipo_componente: c.tipo_componente,
    serial: c.serial_retirado, id_ot: c.id_ot, componente_id: String(c.id), aprobada: null }));
  if (await insertarLineas(filas)) cargarDisponibles();
});

document.getElementById("man-anadir").addEventListener("click", async () => {
  const mc = document.getElementById("man-mc").value.trim().toUpperCase();
  if (!/^MC\d+$/.test(mc)) { alert("Escribe un MC válido, por ejemplo MC2500123."); return; }
  const tipo = document.getElementById("man-tipo").value;
  if (await insertarLineas([{ orden_id: ordenActual, m_control: mc, tipo_componente: tipo, aprobada: null }]))
    document.getElementById("man-mc").value = "";
});
