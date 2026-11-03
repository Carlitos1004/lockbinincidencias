// =========================================================================
// ÓRDENES DE PRESUPUESTO (vandalismo) — solo manager. Solo seguimiento.
// Estados: Borrador -> Presupuesto enviado -> Presupuesto aprobado ->
//          Equipos repuestos   (o Presupuesto rechazado)
// =========================================================================

let ordenes = [];          // ordenes_presupuesto
let lineasPorOrden = {};   // orden_id -> [lineas]
let ordenActual = null;
let compInfo = {};         // componente_id -> {repo_estado, repo_serial_nuevo, repo_fecha_entrega}
let otPorMc = {};          // MC -> última OT en la que va (ticket abierto)
let disponibles = [];      // piezas vandalizadas del cliente de la orden abierta, aún sin orden

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
const codigo = n => "PRE-" + String(n).padStart(3, "0");
const hoy = () => new Date().toISOString().slice(0, 10);
const fmt = f => f ? new Date(f + "T00:00:00").toLocaleDateString("es-ES") : "—";

const ESTADOS_REPUESTA = ["Repuesto desde stock", "Entregado", "Reparado recibido"];
const esClaveComp = id => id && !String(id).startsWith("T");
function infoLinea(l) { return esClaveComp(l.componente_id) ? (compInfo[String(l.componente_id)] || null) : null; }
let detectadoPorLinea = {}; // linea.id -> {serial, ot} cambio hecho en ruta DESPUÉS de aprobar el presupuesto
function estaRepuesta(l) {
  const i = infoLinea(l);
  return !!(detectadoPorLinea[l.id] || (i && (ESTADOS_REPUESTA.includes(i.repo_estado) || i.repo_serial_nuevo)));
}
const canonTipo = t => /bater/i.test(t || "") ? "Batería" : (t || "");

// Lee el estado de reposición de las piezas ligadas y la OT en la que va cada equipo aprobado
async function cargarInfoReposicion() {
  compInfo = {}; otPorMc = {};
  const todas = Object.values(lineasPorOrden).flat();
  const ids = [...new Set(todas.filter(l => esClaveComp(l.componente_id)).map(l => String(l.componente_id)))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseClient.from("componentes_retirados")
      .select("id, repo_estado, repo_serial_nuevo, repo_fecha_entrega").in("id", ids.slice(i, i + 100));
    (data || []).forEach(c => { compInfo[String(c.id)] = c; });
  }
  const mcs = [...new Set(todas.filter(l => l.aprobada === true).map(l => l.m_control))];

  // Cambios hechos en Ruta: el reporte de ruta crea una pieza con serial nuevo en la OT de la visita.
  // Cuenta como reposición si es del mismo MC y componente y de una OT posterior a la aprobación.
  detectadoPorLinea = {};
  const cambios = [];
  for (let i = 0; i < mcs.length; i += 100) {
    const { data } = await supabaseClient.from("componentes_retirados")
      .select("id, m_control, tipo_componente, serial_nuevo, id_ot").in("m_control", mcs.slice(i, i + 100)).not("serial_nuevo", "is", null);
    (data || []).forEach(c => cambios.push(c));
  }
  const otsCamb = [...new Set(cambios.map(c => c.id_ot).filter(Boolean))];
  const fechaOt = {};
  for (let i = 0; i < otsCamb.length; i += 100) {
    const { data } = await supabaseClient.from("ordenes_trabajo").select("id_ot, fecha").in("id_ot", otsCamb.slice(i, i + 100));
    (data || []).forEach(o => { fechaOt[o.id_ot] = (o.fecha || "").slice(0, 10); });
  }
  todas.filter(l => l.aprobada === true).forEach(l => {
    const ord = ordenes.find(o => o.id === l.orden_id);
    const desde = ord && ord.fecha_aprobado;
    if (!desde) return;
    const coincide = cambios.filter(c => c.m_control === l.m_control && String(c.id) !== String(l.componente_id) &&
      fechaOt[c.id_ot] && fechaOt[c.id_ot] >= desde &&
      (l.tipo_componente === "Equipo completo" || l.alcance === "Equipo completo" || canonTipo(c.tipo_componente) === canonTipo(l.tipo_componente)));
    if (coincide.length) detectadoPorLinea[l.id] = { serial: coincide.map(c => c.serial_nuevo).join(", "), ot: coincide[0].id_ot };
  });

  for (let i = 0; i < mcs.length; i += 100) {
    const { data } = await supabaseClient.from("historial_fallas")
      .select("m_control, id_ot, estado").in("m_control", mcs.slice(i, i + 100)).eq("estado", "🚨 ABIERTO");
    (data || []).forEach(t => { if (!otPorMc[t.m_control] || t.id_ot > otPorMc[t.m_control]) otPorMc[t.m_control] = t.id_ot; });
  }
}

// Deja la Orden de reposición coherente: piezas aprobadas -> "Presupuesto aprobado"; rechazadas -> "Presupuesto rechazado"
// (solo si la pieza aún no tiene un estado manual, para no pisar nada)
async function sincronizarReposicion(orden) {
  if (!orden || orden.estado !== "Presupuesto aprobado") return;
  const ls = lineasPorOrden[orden.id] || [];
  const poner = (valor, filtro) => {
    const ids = ls.filter(l => filtro(l) && esClaveComp(l.componente_id) && !(compInfo[String(l.componente_id)] || {}).repo_estado)
      .map(l => String(l.componente_id));
    return ids.length ? supabaseClient.from("componentes_retirados").update({ repo_estado: valor }).in("id", ids).then(r => {
      if (!r.error) ids.forEach(id => { compInfo[id] = Object.assign(compInfo[id] || {}, { repo_estado: valor }); });
    }) : null;
  };
  // Líneas con alcance "Equipo completo": se anota en la Orden de reposición de su OT (sin pisar lo que ya haya)
  const completos = ls.filter(l => l.aprobada === true && l.alcance === "Equipo completo" && l.id_ot);
  if (completos.length) {
    const cod = "PRE-" + String(orden.numero).padStart(3, "0");
    const filas = [...new Map(completos.map(l => [l.id_ot + "|" + l.m_control, { id_ot: l.id_ot, m_control: l.m_control, cambio_completo: true, nota: "Presupuesto " + cod + (orden.numero_oferta ? " (" + orden.numero_oferta + ")" : "") }])).values()];
    await supabaseClient.from("reposicion_equipos").upsert(filas, { onConflict: "id_ot,m_control", ignoreDuplicates: true });
  }
  await Promise.all([poner("Presupuesto aprobado", l => l.aprobada === true), poner("Presupuesto rechazado", l => l.aprobada === false)].filter(Boolean));
}

function claseEstado(e) {
  return { "Borrador": "orep-gris", "Presupuesto enviado": "orep-proc", "Presupuesto aprobado": "orep-ok",
           "Presupuesto rechazado": "orep-falta", "Equipos repuestos": "orep-info" }[e] || "orep-gris";
}

// Solo lo que está marcado como vandalismo (casilla de la pieza en Revisión de Taller / columna Vandalismo del ticket)
const esVandPieza = c => c.vandalismo === true;
// Tickets: la columna Vandalismo de la OT, o la casilla "Vandalismo/robo" del reporte de Ruta
// (esa casilla deja escrito "Vandalismo/robo" en la acción del ticket). Si en la OT se puso "No", se descarta.
const FILTRO_TICKET_VAND = "vandalismo.eq.true,and(vandalismo.is.null,accion_calle.ilike.*Vandalismo/robo*)";

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
  await cargarInfoReposicion();
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
      <td>${ls.length}</td><td>${ls.filter(l => l.aprobada === true).length}${ls.some(estaRepuesta) ? ` (${ls.filter(l => l.aprobada === true && estaRepuesta(l)).length} repuestas)` : ""}</td><td>${mcs}</td>
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
  const { data: tk } = await traerTodo(() => supabaseClient.from("historial_fallas").select("id_registro, cliente").or(FILTRO_TICKET_VAND).order("id_registro"));
  const clientes = [...new Set([...(data || []), ...(tk || [])]
    .flatMap(c => String(c.cliente || "").split(" / ")).map(x => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  await cargarInfoReposicion();
  await sincronizarReposicion(o);
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
    <div class="tarjeta-resumen"><strong>${n(l => l.aprobada === false)}</strong><span>Rechazadas</span></div>
    <div class="tarjeta-resumen"><strong>${n(l => l.aprobada === true && estaRepuesta(l))}</strong><span>Repuestas</span></div>`;

  // Piezas a preparar: aprobadas que aún no se han repuesto, por tipo
  const porTipo = {};
  ls.filter(l => l.aprobada === true && !estaRepuesta(l)).forEach(l => { const t = l.tipo_componente || "Sin tipo"; porTipo[t] = (porTipo[t] || 0) + 1; });
  const prep = Object.entries(porTipo).sort();
  document.getElementById("det-preparar").innerHTML = prep.length
    ? "<strong>Piezas nuevas a preparar (aprobadas, sin reponer):</strong> " + prep.map(([t, n]) => `${esc(t)}: <strong>${n}</strong>`).join(" · ")
    : "Sin piezas pendientes de preparar.";

  // Si todo lo aprobado ya está repuesto, ofrecer cerrar la orden
  const aprobadas = ls.filter(l => l.aprobada === true);
  const todasRepuestas = aprobadas.length > 0 && aprobadas.every(estaRepuesta);
  document.getElementById("det-cerrar-aviso").hidden = !(todasRepuestas && o.estado === "Presupuesto aprobado");
  document.getElementById("det-oferta").value = o.numero_oferta || "";
  document.getElementById("det-estado").value = o.estado;
  document.getElementById("det-notas").value = o.notas || "";
  document.getElementById("det-fechas").textContent =
    `Creada el ${new Date(o.creada_en).toLocaleDateString("es-ES")} por ${nombreUsuario(o.creada_por)} · Enviado: ${fmt(o.fecha_enviado)} · Aprobado: ${fmt(o.fecha_aprobado)} · Repuesto: ${fmt(o.fecha_repuesto)}`;

  const sorted = [...ls].sort((a, b) => a.m_control.localeCompare(b.m_control) || (a.tipo_componente || "").localeCompare(b.tipo_componente || ""));
  document.getElementById("tbody-lineas").innerHTML = sorted.length ? sorted.map(l => `
    <tr data-id="${l.id}">
      <td>${esc(l.m_control)}</td><td>${esc(l.tipo_componente || "—")}</td>
      <td><select class="sel-alcance">
        <option value="Pieza" ${l.alcance !== "Equipo completo" ? "selected" : ""}>Solo la pieza</option>
        <option value="Equipo completo" ${l.alcance === "Equipo completo" ? "selected" : ""}>🔄 Equipo completo</option>
      </select></td><td>${esc(l.serial || "—")}</td>
      <td>${l.id_ot ? `<a href="ot-detalle.html?ot=${encodeURIComponent(l.id_ot)}">${esc(l.id_ot)}</a>` : "—"}</td>
      <td><select class="sel-aprob">
        <option value="" ${l.aprobada === null ? "selected" : ""}>Pendiente de respuesta</option>
        <option value="si" ${l.aprobada === true ? "selected" : ""}>✅ Acepta pagar</option>
        <option value="no" ${l.aprobada === false ? "selected" : ""}>❌ Rechaza</option>
      </select></td>
      <td>${celdaReposicion(l)}</td>
      <td><button type="button" class="btn-quitar-lin" title="Quitar de la orden">✕</button></td>
    </tr>`).join("") : '<tr><td colspan="8">La orden está vacía. Añade piezas abajo.</td></tr>';

  document.querySelectorAll(".sel-aprob").forEach(sel => sel.addEventListener("change", async () => {
    const v = sel.value === "si" ? true : sel.value === "no" ? false : null;
    const id = sel.closest("tr").dataset.id;
    const { error } = await supabaseClient.from("presupuesto_lineas").update({ aprobada: v }).eq("id", id);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    const l = (lineasPorOrden[ordenActual] || []).find(x => x.id === id); if (l) l.aprobada = v;
    await cargarInfoReposicion();
    await sincronizarReposicion(ordenes.find(x => x.id === ordenActual));
    pintarDetalle(); renderLista();
  }));
  document.querySelectorAll(".sel-alcance").forEach(sel => sel.addEventListener("change", async () => {
    const id = sel.closest("tr").dataset.id;
    const { error } = await supabaseClient.from("presupuesto_lineas").update({ alcance: sel.value }).eq("id", id);
    if (error) { alert("No se pudo guardar: " + error.message + "\n(¿Corriste el SQL 86?)"); return; }
    const l = (lineasPorOrden[ordenActual] || []).find(x => x.id === id); if (l) l.alcance = sel.value;
    await cargarInfoReposicion();
    await sincronizarReposicion(ordenes.find(x => x.id === ordenActual));
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

function celdaReposicion(l) {
  if (l.aprobada !== true) return '<span style="color:#888;">—</span>';
  const i = infoLinea(l) || {};
  if (estaRepuesta(l)) {
    const d = detectadoPorLinea[l.id];
    const f = i.repo_fecha_entrega ? " el " + fmt(i.repo_fecha_entrega) : "";
    const serial = i.repo_serial_nuevo || (d && d.serial);
    return `<span class="orep-badge orep-ok">Repuesta${f}</span>${serial ? `<br><small>Serial nuevo: ${esc(serial)}${d ? " (" + esc(d.ot) + ")" : ""}</small>` : ""}`;
  }
  const ot = otPorMc[l.m_control];
  return `<span class="orep-badge orep-proc">Por reponer</span>${ot ? `<br><small>En ${esc(ot)}</small>` : ""}`;
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
    const conComp = aprob.filter(l => esClaveComp(l.componente_id) && !estaRepuesta(l));
    if (!confirm(`Se marcará la orden como repuesta (${aprob.length} pieza(s) aprobadas).\n` +
      (conComp.length ? `Además, ${conComp.length} pieza(s) pasarán a "Repuesto desde stock" en la Orden de reposición. ¿Continuar?` : "¿Continuar?"))) { e.target.value = o.estado; return; }
    cambios.fecha_repuesto = hoy();
    if (conComp.length) {
      const { error } = await supabaseClient.from("componentes_retirados")
        .update({ repo_estado: "Repuesto desde stock" }).in("id", conComp.map(l => l.componente_id));
      if (error) { alert("No se pudo actualizar la reposición: " + error.message); e.target.value = o.estado; return; }
    }
  }
  if (await guardarOrden(cambios)) {
    await cargarInfoReposicion();
    await sincronizarReposicion(o);
    pintarDetalle(); renderLista();
  } else e.target.value = o.estado;
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
  const tb = document.getElementById("tbody-disp");
  tb.innerHTML = '<tr><td colspan="8">Cargando...</td></tr>';
  // Se traen TODAS las piezas/tickets con vandalismo (de cualquier cliente) y luego se filtra en pantalla,
  // para poder ver qué queda fuera y por qué.
  const { data, error } = await traerTodo(() => supabaseClient.from("componentes_retirados")
    .select("id, m_control, tipo_componente, serial_retirado, id_ot, cliente, cliente_original, destino, vandalismo").eq("vandalismo", true).order("id"));
  if (error) { tb.innerHTML = `<tr><td colspan="8">Error: ${esc(error.message)}</td></tr>`; return; }
  const { data: tks } = await traerTodo(() => supabaseClient.from("historial_fallas")
    .select("id_registro, m_control, id_ot, falla, cliente").or(FILTRO_TICKET_VAND).order("id_registro"));
  const { data: usadas } = await traerTodo(() => supabaseClient.from("presupuesto_lineas")
    .select("id, componente_id, orden_id, ordenes_presupuesto(numero)").not("componente_id", "is", null).order("id"));
  const usadaEn = {};
  (usadas || []).forEach(l => { usadaEn[String(l.componente_id)] = l.ordenes_presupuesto ? codigo(l.ordenes_presupuesto.numero) : "otra orden"; });
  const piezasVand = (data || []).filter(esVandPieza).filter(c => c.m_control);
  const mcConPieza = new Set(piezasVand.map(c => c.m_control));
  const lista = piezasVand.map(c => ({ ...c, cliente_ef: c.cliente || c.cliente_original || "", clave: String(c.id) }));
  (tks || []).forEach(t => {
    if (!t.m_control || mcConPieza.has(t.m_control)) return;
    lista.push({ id: "T" + t.id_registro, clave: "T" + t.id_registro, m_control: t.m_control, tipo_componente: "Equipo completo",
      serial_retirado: null, id_ot: t.id_ot, cliente_ef: t.cliente || "", cliente_original: null, destino: "Ticket vandalismo: " + (t.falla || "") });
  });
  lista.forEach(c => { c.usadaEn = usadaEn[c.clave] || null; });
  disponibles = lista.sort((a, b) => a.m_control.localeCompare(b.m_control));
  renderDisponibles();
}

function renderDisponibles() {
  const o = ordenes.find(x => x.id === ordenActual);
  const f = document.getElementById("disp-filtro").value.trim().toLowerCase();
  const todos = document.getElementById("disp-todos-clientes").checked;
  const delCliente = c => !o || [c.cliente_ef, c.cliente_original].filter(Boolean).some(x => x === o.cliente || (o.cliente || "").split(" / ").includes(x));
  const base = disponibles.filter(c => todos || delCliente(c));
  const vis = base.filter(c => !f || c.m_control.toLowerCase().includes(f));
  const libres = base.filter(c => !c.usadaEn).length;
  document.getElementById("disp-contador").textContent =
    `${libres} libres de ${base.length} con vandalismo${todos ? " (todos los clientes)" : ` de ${o ? o.cliente : "este cliente"}`} · ${disponibles.length} en total en la base`;
  document.getElementById("tbody-disp").innerHTML = vis.length ? vis.map(c => `
    <tr ${c.usadaEn ? 'style="opacity:.55;"' : ""}><td><input type="checkbox" class="chk-disp" data-id="${c.id}" ${c.usadaEn ? "disabled" : ""}></td><td>${esc(c.m_control)}</td>
    <td>${esc(c.tipo_componente || "—")}</td><td>${esc(c.serial_retirado || "—")}</td><td>${esc(c.id_ot || "—")}</td>
    <td>${esc(c.cliente_ef || "—")}</td>
    <td>${esc((c.destino || "—").replace(/^[✓❌🚨]\s*/u, ""))}</td>
    <td>${c.usadaEn ? `<strong>Ya en ${esc(c.usadaEn)}</strong>` : ""}</td></tr>`).join("")
    : '<tr><td colspan="8">No hay piezas con vandalismo que coincidan.</td></tr>';
}
document.getElementById("disp-filtro").addEventListener("input", renderDisponibles);
document.getElementById("disp-todos-clientes").addEventListener("change", renderDisponibles);
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
  const filas = disponibles.filter(c => ids.includes(String(c.id)) && !c.usadaEn).map(c => ({
    orden_id: ordenActual, m_control: c.m_control, tipo_componente: c.tipo_componente,
    serial: c.serial_retirado, id_ot: c.id_ot, componente_id: String(c.id), aprobada: null,
    alcance: c.tipo_componente === "Equipo completo" ? "Equipo completo" : "Pieza" }));
  if (await insertarLineas(filas)) cargarDisponibles();
});

document.getElementById("man-anadir").addEventListener("click", async () => {
  const mc = document.getElementById("man-mc").value.trim().toUpperCase();
  if (!/^MC\d+$/.test(mc)) { alert("Escribe un MC válido, por ejemplo MC2500123."); return; }
  const tipo = document.getElementById("man-tipo").value;
  if (await insertarLineas([{ orden_id: ordenActual, m_control: mc, tipo_componente: tipo, aprobada: null, alcance: tipo === "Equipo completo" ? "Equipo completo" : "Pieza" }]))
    document.getElementById("man-mc").value = "";
});

document.getElementById("det-cerrar-btn").addEventListener("click", async () => {
  const o = ordenes.find(x => x.id === ordenActual);
  if (!o || !confirm(`Todas las piezas aprobadas de ${codigo(o.numero)} ya están repuestas. ¿Marcar la orden como "Equipos repuestos"?`)) return;
  if (await guardarOrden({ estado: "Equipos repuestos", fecha_repuesto: hoy() })) { pintarDetalle(); renderLista(); }
});
