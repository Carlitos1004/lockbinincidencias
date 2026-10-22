// =========================================================================
// ÓRDENES DE REPOSICIÓN (por OT manual) — solo manager
// La orden de una OT = sus componentes agrupados por MC (4 casillas).
// El estado de cada casilla se deduce de Revisión de Taller y se puede
// ajustar a mano (columna repo_estado).
// =========================================================================

const TIPOS = ["Módulo de Control", "Lector Electrónico", "Cierre Electrónico", "Batería"];
const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

const ESTADOS_MANUALES = [
  "Presupuesto aprobado",
  "Presupuesto rechazado",
  "Reparado recibido",
  "Repuesto desde stock",
  "Entregado"
];
// Casillas que ya no bloquean la entrega del equipo
const RESUELTOS = new Set(["Listo (sin cambios)", "Reparado recibido", "Repuesto desde stock", "Entregado"]);

let otsManuales = [];
let filaHistoricaHtml = "";
let compsManuales = [];
let ordenesPorOt = {};   // id_ot -> fila de ordenes_reposicion
let otActual = null;
let compsOtActual = [];   // componentes de la orden abierta
let clienteOtActual = "";

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function codigoOrden(numero) { return "REP-" + String(numero).padStart(3, "0"); }

const CAMPOS = "id, m_control, tipo_componente, serial_retirado, id_ot, cliente, estado, destino, " +
  "vandalismo, garantia_cliente, devuelto, devuelto_en, repo_estado, repo_serial_nuevo, " +
  "repo_fecha_entrega, orden_reposicion_ot";

// ---------- Estado de una casilla ----------
function estadoCasilla(c) {
  if (c.repo_estado) return c.repo_estado;
  const d = c.destino || "";
  if (!d || c.estado === "Pendiente revisión" || d.includes("Sigue en revisión")) return "En revisión";
  if (d.includes("Devolver al cliente")) return c.devuelto ? "Entregado" : "Listo (sin cambios)";
  if (d === DESTINO_AMMI) {
    return (c.vandalismo || c.garantia_cliente === "NO") ? "Presupuesto pendiente" : "En AMMI (garantía)";
  }
  if (d.includes("Stock") || d.includes("Desechar")) return "Por reponer de stock";
  return "Revisar destino";
}

function claseEstado(e) {
  if (e === "Entregado") return "orep-info";
  if (RESUELTOS.has(e)) return "orep-ok";
  if (e === "Por reponer de stock" || e === "Presupuesto rechazado" || e === "Revisar destino") return "orep-falta";
  return "orep-proc";
}

function notaCasilla(c) {
  const partes = [];
  if (c.vandalismo) partes.push("🔨 vandalismo");
  if (c.destino === DESTINO_AMMI) partes.push(c.garantia_cliente === "NO" ? "sin garantía" : (c.garantia_cliente === "SI" ? "con garantía" : ""));
  return partes.filter(Boolean).join(" · ");
}

// "Batería Recargable", "Batería No Recargable", etc. cuentan como la casilla "Batería"
function tipoCanonico(t) {
  const l = (t || "").toLowerCase();
  return l.includes("bater") ? "Batería" : t;
}

// ---------- Agrupar por MC ----------
function agruparPorMc(comps) {
  const grupos = {};
  comps.forEach(c => {
    if (!c.m_control) return;
    (grupos[c.m_control] = grupos[c.m_control] || []).push(c);
  });
  return Object.entries(grupos).map(([mc, lista]) => {
    const casillas = TIPOS.map(t => {
      const delTipo = lista.filter(c => tipoCanonico(c.tipo_componente) === t);
      // si hay dos del mismo tipo (ej. una batería desechada y otra nueva), preferimos la que no se desechó
      delTipo.sort((a, b) => ((a.destino || "").includes("Desechar") ? 0 : 1) - ((b.destino || "").includes("Desechar") ? 0 : 1));
      return { tipo: t, comp: delTipo.length ? delTipo[delTipo.length - 1] : null };
    });
    const faltan = casillas.filter(x => !x.comp).map(x => x.tipo);
    const estados = casillas.filter(x => x.comp).map(x => estadoCasilla(x.comp));
    let estadoMc;
    if (faltan.length) estadoMc = "Incompleto";
    else if (estados.every(e => e === "Entregado")) estadoMc = "Entregado";
    else if (estados.every(e => RESUELTOS.has(e))) estadoMc = "Listo para entregar";
    else estadoMc = "En proceso";
    return { mc, casillas, faltan, estadoMc, cliente: lista[0].cliente };
  }).sort((a, b) => a.mc.localeCompare(b.mc));
}

// ---------- Lista de OTs ----------
(async () => {
  await cargarOts();
  const ot = new URLSearchParams(location.search).get("ot");
  if (ot) abrirOt(ot);
})();

async function cargarOts() {
  const tbody = document.getElementById("tbody-ots");
  const { data: ots, error } = await supabaseClient
    .from("ordenes_trabajo").select("id_ot, cliente, origen, fecha")
    .eq("origen", "libre").order("fecha", { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="8">Error: ${esc(error.message)}</td></tr>`; return; }
  otsManuales = ots || [];

  const { data: ordenes, error: errOrd } = await supabaseClient.from("ordenes_reposicion").select("*");
  if (errOrd) { tbody.innerHTML = `<tr><td colspan="8">Error: ${esc(errOrd.message)} (¿Corriste los SQL 76 y 77?)</td></tr>`; return; }
  ordenesPorOt = {};
  (ordenes || []).forEach(o => { if (o.id_ot) ordenesPorOt[o.id_ot] = o; });
  const historica = (ordenes || []).find(o => !o.id_ot);

  let filaHistorica = "";
  if (historica) {
    const { data: reps } = await supabaseClient.from("equipos_reposicion").select("tipo_registro, estado").eq("orden_id", historica.id);
    const aReponer = (reps || []).filter(r => r.tipo_registro === "REPONER");
    filaHistorica = `<tr class="orep-fila" data-historica="1">
      <td><strong>${codigoOrden(historica.numero)}</strong></td><td>Histórica (sin OT)</td><td>${esc(historica.cliente || "Varios")}</td>
      <td>${(reps || []).length}</td><td>—</td><td>${aReponer.filter(r => r.estado === "Pendiente").length} pendientes</td>
      <td>—</td><td>${aReponer.filter(r => r.estado === "Repuesto").length}</td></tr>`;
  }
  filaHistoricaHtml = filaHistorica;
  if (!otsManuales.length) { compsManuales = []; renderLista(); return; }

  const ids = otsManuales.map(o => o.id_ot);
  const comps = [];
  for (let i = 0; i < ids.length; i += 60) {
    const trozo = ids.slice(i, i + 60);
    const { data } = await supabaseClient.from("componentes_retirados").select(CAMPOS)
      .or(`id_ot.in.(${trozo.join(",")}),orden_reposicion_ot.in.(${trozo.join(",")})`);
    (data || []).forEach(c => comps.push(c));
  }

  compsManuales = comps;
  renderLista();
}

// Fila de una OT con sus contadores
function filaOt(o) {
  const delOt = compsManuales.filter(c => (c.orden_reposicion_ot || c.id_ot) === o.id_ot);
  const mcs = agruparPorMc(delOt);
  const n = e => mcs.filter(m => m.estadoMc === e).length;
  const orden = ordenesPorOt[o.id_ot];
  return `<tr class="orep-fila" data-ot="${esc(o.id_ot)}">
    <td>${orden ? `<strong>${codigoOrden(orden.numero)}</strong>` : '<em>Sin crear</em>'}</td><td>${esc(o.id_ot)}</td><td>${esc(o.cliente || "—")}</td>
    <td>${mcs.length}</td><td>${n("Incompleto")}</td><td>${n("En proceso")}</td>
    <td>${n("Listo para entregar")}</td><td>${n("Entregado")}</td></tr>`;
}

// La lista principal solo muestra REP-001 y las OTs que YA tienen orden.
// Las demás OTs manuales (incluidas las HIST-) se encuentran con el buscador.
function renderLista() {
  const tbody = document.getElementById("tbody-ots");
  const conOrden = otsManuales.filter(o => ordenesPorOt[o.id_ot]);
  conOrden.sort((a, b) => ordenesPorOt[a.id_ot].numero - ordenesPorOt[b.id_ot].numero);
  tbody.innerHTML = filaHistoricaHtml + conOrden.map(filaOt).join("");
  enlazarFilas(tbody);
  renderBusqueda();
}

function renderBusqueda() {
  const q = document.getElementById("buscar-ot").value.trim().toLowerCase();
  const cont = document.getElementById("buscar-ot-resultado");
  if (q.length < 2) { cont.innerHTML = ""; return; }
  const coincid = otsManuales.filter(o => !ordenesPorOt[o.id_ot] &&
    (o.id_ot.toLowerCase().includes(q) || (o.cliente || "").toLowerCase().includes(q))).slice(0, 30);
  if (!coincid.length) { cont.innerHTML = "<p>Ninguna OT manual sin orden coincide.</p>"; return; }
  cont.innerHTML = `<table class="tabla-revision orep-lista"><thead><tr><th>Orden</th><th>OT</th><th>Cliente</th><th>Equipos</th><th>Incompletos</th><th>En proceso</th><th>Listos para entregar</th><th>Entregados</th></tr></thead><tbody>` +
    coincid.map(filaOt).join("") + "</tbody></table>";
  enlazarFilas(cont);
}

function enlazarFilas(tbody) {
  tbody.querySelectorAll("tr.orep-fila").forEach(tr =>
    tr.addEventListener("click", () => {
      if (tr.dataset.historica) { location.href = "reposiciones.html"; return; }
      abrirOt(tr.dataset.ot);
    }));
}

// ---------- Detalle de una OT ----------
async function abrirOt(idOt) {
  if (!ordenesPorOt[idOt]) {
    if (!confirm(`La OT ${idOt} todavía no tiene orden de reposición. ¿Crearla ahora? Se le asignará el siguiente número.`)) return;
    const { data: { user } } = await supabaseClient.auth.getUser();
    const ot = otsManuales.find(o => o.id_ot === idOt) || {};
    const { data: nueva, error } = await supabaseClient.from("ordenes_reposicion")
      .insert({ id_ot: idOt, cliente: ot.cliente || null, creada_por: user ? user.email : null }).select().single();
    if (error) { alert("No se pudo crear la orden: " + error.message); return; }
    ordenesPorOt[idOt] = nueva;
    cargarOts();
  }
  otActual = idOt;
  document.querySelectorAll("tr.orep-fila").forEach(tr =>
    tr.classList.toggle("orep-activa", tr.dataset.ot === idOt));
  document.getElementById("detalle").hidden = false;
  document.getElementById("detalle-titulo").textContent = `Orden ${codigoOrden(ordenesPorOt[idOt].numero)} — ${idOt}`;
  document.getElementById("lista-mc").innerHTML = "<p>Cargando...</p>";
  await recargarOt();
  document.getElementById("detalle").scrollIntoView({ behavior: "smooth" });
}

async function recargarOt() {
  const { data, error } = await supabaseClient.from("componentes_retirados").select(CAMPOS)
    .or(`id_ot.eq.${otActual},orden_reposicion_ot.eq.${otActual}`);
  if (error) { document.getElementById("lista-mc").innerHTML = `<p>Error: ${esc(error.message)}</p>`; return; }
  // Fuera: piezas de esta OT que se cuentan en la orden de otra OT
  compsOtActual = (data || []).filter(c => (c.orden_reposicion_ot || c.id_ot) === otActual);
  clienteOtActual = (otsManuales.find(o => o.id_ot === otActual) || {}).cliente || "";
  renderDetalle();
}

function renderDetalle() {
  const mcs = agruparPorMc(compsOtActual);
  const n = e => mcs.filter(m => m.estadoMc === e).length;
  document.getElementById("detalle-resumen").innerHTML = `
    <div class="tarjeta-resumen"><strong>${mcs.length}</strong><span>Equipos</span></div>
    <div class="tarjeta-resumen"><strong>${n("Incompleto")}</strong><span>Incompletos</span></div>
    <div class="tarjeta-resumen"><strong>${n("En proceso")}</strong><span>En proceso</span></div>
    <div class="tarjeta-resumen"><strong>${n("Listo para entregar")}</strong><span>Listos para entregar</span></div>
    <div class="tarjeta-resumen"><strong>${n("Entregado")}</strong><span>Entregados</span></div>`;

  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fEst = document.getElementById("filtro-estado-mc").value;
  const visibles = mcs.filter(m => (!fMc || m.mc.toLowerCase().includes(fMc)) && (!fEst || m.estadoMc === fEst));

  document.getElementById("lista-mc").innerHTML = visibles.length
    ? visibles.map(htmlMc).join("")
    : "<p>Ningún equipo coincide.</p>";

  const sinMc = compsOtActual.filter(c => !c.m_control);
  document.getElementById("sin-mc").hidden = sinMc.length === 0;
  document.getElementById("sin-mc-lista").innerHTML = sinMc.map(c =>
    `<li>${esc(c.tipo_componente)} — serial ${esc(c.serial_retirado || "—")} (${esc(estadoCasilla(c))})</li>`).join("");

  enlazarEventos();
}

function claseMc(e) {
  return { "Entregado": "orep-info", "Listo para entregar": "orep-ok", "En proceso": "orep-proc", "Incompleto": "orep-falta" }[e];
}

function htmlMc(m) {
  const filas = m.casillas.map(x => {
    if (!x.comp) {
      return `<tr><td>${esc(x.tipo)}</td><td colspan="5"><span class="orep-badge orep-falta">Falta — aclarar con el cliente</span></td></tr>`;
    }
    const c = x.comp;
    const est = estadoCasilla(c);
    const opciones = ['<option value="">Automático</option>']
      .concat(ESTADOS_MANUALES.map(e => `<option value="${e}" ${c.repo_estado === e ? "selected" : ""}>${e}</option>`)).join("");
    const extra = c.orden_reposicion_ot
      ? ` <button type="button" class="btn-quitar-extra" data-id="${c.id}" title="Quitar de esta orden">✕ de esta orden</button>` : "";
    return `<tr data-id="${c.id}">
      <td>${esc(c.tipo_componente || x.tipo)}${c.orden_reposicion_ot ? `<br><small>desde ${esc(c.id_ot)}</small>` : ""}</td>
      <td>${esc(c.serial_retirado || "—")}</td>
      <td>${esc((c.destino || "Sin destino").replace(/^[✓❌🚨]\s*/, ""))}<br><small>${esc(notaCasilla(c))}</small></td>
      <td><span class="orep-badge ${claseEstado(est)}">${esc(est)}</span></td>
      <td><select class="sel-estado-manual">${opciones}</select></td>
      <td><input type="text" class="inp-serial-nuevo" placeholder="Serial entregado" value="${esc(c.repo_serial_nuevo || "")}">${extra}</td>
    </tr>`;
  }).join("");

  const fechaEnt = m.casillas.map(x => x.comp && x.comp.repo_fecha_entrega).filter(Boolean)[0];
  const botonEntrega = m.estadoMc === "Listo para entregar"
    ? `<button type="button" class="btn-entregar" data-mc="${esc(m.mc)}">📦 Marcar equipo entregado</button>` : "";
  const detalleFaltan = m.faltan.length ? ` · faltan: ${esc(m.faltan.join(", "))}` : "";

  return `<div class="orep-mc">
    <div class="orep-mc-cab"><strong>${esc(m.mc)}</strong>
      <span class="orep-badge ${claseMc(m.estadoMc)}">${esc(m.estadoMc)}</span>
      <span>${esc(m.cliente || "")}${detalleFaltan}${fechaEnt ? ` · entregado el ${esc(fechaEnt)}` : ""}</span></div>
    <div class="scroll-x-tabla" style="max-height:none;"><table>
      <thead><tr><th>Componente</th><th>Serial retirado</th><th>Destino</th><th>Estado</th><th>Ajuste manual</th><th>Serial a entregar</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    <div class="orep-acciones">${botonEntrega}</div>
  </div>`;
}

// ---------- Guardar cambios ----------
function enlazarEventos() {
  document.querySelectorAll(".sel-estado-manual").forEach(sel =>
    sel.addEventListener("change", async () => {
      const id = sel.closest("tr").dataset.id;
      const valor = sel.value || null;
      const cambios = { repo_estado: valor };
      if (valor === "Entregado") cambios.repo_fecha_entrega = hoy();
      if (!valor) cambios.repo_fecha_entrega = null;
      await guardarComp(id, cambios);
    }));

  document.querySelectorAll(".inp-serial-nuevo").forEach(inp =>
    inp.addEventListener("change", async () => {
      const id = inp.closest("tr").dataset.id;
      await guardarComp(id, { repo_serial_nuevo: inp.value.trim() || null }, false);
    }));

  document.querySelectorAll(".btn-entregar").forEach(btn =>
    btn.addEventListener("click", () => entregarEquipo(btn.dataset.mc)));

  document.querySelectorAll(".btn-quitar-extra").forEach(btn =>
    btn.addEventListener("click", async () => {
      await guardarComp(btn.dataset.id, { orden_reposicion_ot: null });
    }));
}

function hoy() { return new Date().toISOString().slice(0, 10); }

async function guardarComp(id, cambios, recargar = true) {
  const { error } = await supabaseClient.from("componentes_retirados").update(cambios).eq("id", id);
  if (error) {
    alert("No se pudo guardar: " + error.message + "\n(¿Corriste el SQL 76?)");
    return false;
  }
  const c = compsOtActual.find(x => x.id === id);
  if (c) Object.assign(c, cambios);
  if (recargar) { await recargarOt(); cargarOts(); }
  return true;
}

async function entregarEquipo(mc) {
  const grupo = agruparPorMc(compsOtActual).find(m => m.mc === mc);
  if (!grupo || grupo.estadoMc !== "Listo para entregar") return;
  if (!confirm(`¿Marcar ${mc} como entregado al cliente? Se marcarán sus 4 componentes.`)) return;
  const fecha = hoy();
  for (const x of grupo.casillas) {
    const cambios = { repo_estado: "Entregado", repo_fecha_entrega: fecha };
    // Mantener sincronizado el seguimiento "devuelto" que ya existe
    if ((x.comp.destino || "").includes("Devolver al cliente")) {
      cambios.devuelto = true;
      cambios.devuelto_en = new Date().toISOString();
    }
    const ok = await guardarComp(x.comp.id, cambios, false);
    if (!ok) break;
  }
  await recargarOt();
  cargarOts();
}

// ---------- Excepción: añadir pieza de otra OT ----------
document.getElementById("filtro-mc").addEventListener("input", () => otActual && renderDetalle());
document.getElementById("filtro-estado-mc").addEventListener("change", () => otActual && renderDetalle());

document.getElementById("extra-buscar").addEventListener("click", async () => {
  const mc = document.getElementById("extra-mc").value.trim().toUpperCase();
  const cont = document.getElementById("extra-resultado");
  if (!mc) return;
  const { data, error } = await supabaseClient.from("componentes_retirados").select(CAMPOS)
    .eq("m_control", mc);
  if (error) { cont.innerHTML = `<p>Error: ${esc(error.message)}</p>`; return; }
  const otras = (data || []).filter(c => (c.orden_reposicion_ot || c.id_ot) !== otActual);
  if (!otras.length) { cont.innerHTML = "<p>No hay piezas de ese MC fuera de esta orden.</p>"; return; }
  cont.innerHTML = `<table class="tabla-revision"><thead><tr><th>Componente</th><th>Serial</th><th>OT</th><th>Destino</th><th></th></tr></thead><tbody>` +
    otras.map(c => `<tr><td>${esc(c.tipo_componente)}</td><td>${esc(c.serial_retirado || "—")}</td>
      <td>${esc(c.orden_reposicion_ot || c.id_ot || "—")}</td><td>${esc(c.destino || "Sin destino")}</td>
      <td><button type="button" class="btn-add-extra" data-id="${c.id}">Añadir a ${esc(otActual)}</button></td></tr>`).join("") +
    `</tbody></table>`;
  cont.querySelectorAll(".btn-add-extra").forEach(b => b.addEventListener("click", async () => {
    if (await guardarComp(b.dataset.id, { orden_reposicion_ot: otActual }, false)) {
      cont.innerHTML = "<p>✅ Pieza añadida a esta orden.</p>";
      await recargarOt(); cargarOts();
    }
  }));
});

document.getElementById("buscar-ot").addEventListener("input", renderBusqueda);
