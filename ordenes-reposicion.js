// =========================================================================
// ÓRDENES DE REPOSICIÓN (por OT manual) — solo manager
// La orden de una OT = sus componentes agrupados por MC (4 casillas).
// El estado de cada casilla se deduce de Revisión de Taller y se puede
// ajustar a mano (columna repo_estado).
// =========================================================================

const TIPOS = ["Módulo de Control", "Lector Electrónico", "Cierre Electrónico", "Batería"];
const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

const ESTADOS_MANUALES = [
  "Repuesto desde stock",
  "Listo para entregar",
  "Presupuesto aprobado",
  "Presupuesto rechazado",
  "Reparado recibido",
  "Entregado"
];
// "Repuesto desde stock" se guarda así en la base de datos, pero se muestra como "Reponer desde Stock"
const nombreEstado = e => e === "Repuesto desde stock" ? "Reponer desde Stock" : e;
// Piezas que el operario sí debe tocar: las que hay que reponer, o que ya llevan serial nuevo
const ESTADOS_A_CAMBIAR = new Set(["Repuesto desde stock", "Por reponer de stock", "Presupuesto aprobado"]);
const necesitaCambio = (c, est) => ESTADOS_A_CAMBIAR.has(est) || !!c.repo_serial_nuevo;
// Para una pieza "Módulo de Control" con serial nuevo: ¿el MC nuevo es de la misma fracción que el equipo?
const normFr = f => String(f || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
function avisoFraccion(c) {
  if (!/m[oó]dulo/i.test(c.tipo_componente || "") || !c.repo_serial_nuevo || !c.m_control) return "";
  const nuevo = String(c.repo_serial_nuevo).trim().toUpperCase();
  if (!(nuevo in fraccionesEq)) return `<br><small class="orep-fr-dato" title="El MC nuevo no está en Equipos">⚠️ No se pudo comprobar la fracción</small>`;
  const fa = fraccionesEq[c.m_control], fn = fraccionesEq[nuevo];
  if (!fa || !fn) return `<br><small class="orep-fr-dato">⚠️ Fracción sin dato (equipo: «${esc(fa || "—")}» · nuevo: «${esc(fn || "—")}»)</small>`;
  return normFr(fa) === normFr(fn)
    ? `<br><small class="orep-fr-ok">✅ Misma fracción: ${esc(fa)}</small>`
    : `<br><small class="orep-fr-mal">❌ Fracción distinta: equipo «${esc(fa)}» · MC nuevo «${esc(fn)}»</small>`;
}

// Casillas que ya no bloquean la entrega del equipo
const RESUELTOS = new Set(["Listo para entregar", "Listo (sin cambios)", "Reparado recibido", "Sin reposición (acordado)", "Entregado"]);

let otsManuales = [];
let filaHistoricaHtml = "";
let compsManuales = [];
let faltantes = [];      // decisiones sobre piezas que no llegaron (tabla reposicion_faltantes)
let ordenesPorOt = {};   // id_ot -> fila de ordenes_reposicion
let otActual = null;
let compsOtActual = [];   // componentes de la orden abierta
let clienteOtActual = "";
let subTab = "Piezas";     // pestaña activa: "Piezas" (equipos) o "Batería"
let fraccionesEq = {};     // mc -> fracción configurada (para comprobar que el MC nuevo es de la misma fracción)
let fechasFactura = {};    // mc -> fecha de factura / inicio de contrato (la que suele traer el Excel de Porto)
let fechasEntrega = {};    // mc -> fecha de entrega del equipo al cliente (para ordenar)
let listaSel = "";         // lista seleccionada en pantalla ("" = todas, "__sin" = sin lista)
let equiposCompletos = {}; // mc -> fila de reposicion_equipos (cambio de equipo completo + nota)
let presPorComp = {};      // componente_id -> {numero, oferta, estado, aprobada}

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function codigoOrden(numero) { return "REP-" + String(numero).padStart(3, "0"); }

const CAMPOS = "id, m_control, tipo_componente, serial_retirado, id_ot, cliente, estado, destino, " +
  "vandalismo, garantia_cliente, devuelto, devuelto_en, repo_estado, repo_serial_nuevo, " +
  "repo_fecha_entrega, orden_reposicion_ot, repo_nota, cliente_original, repo_lista, repo_categoria";

// Un "MC" que no tiene forma de MC (p. ej. "NO ENCONTRADO", "desconocido") significa que la pieza no tiene equipo identificado
const esMcValido = v => /^MC\d+$/i.test(String(v || "").trim());
function normalizarMc(lista) {
  (lista || []).forEach(c => {
    if (c.m_control && !esMcValido(c.m_control)) { c.m_control_original = c.m_control; c.m_control = null; }
  });
  return lista;
}

// Supabase devuelve como máximo 1000 filas por consulta: pedimos por páginas
async function traerComps(filtroOr) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from("componentes_retirados").select(CAMPOS)
      .or(filtroOr).order("id").range(desde, desde + 999);
    if (error) return { data: null, error };
    todas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  normalizarMc(todas);
  return { data: todas, error: null };
}

// Estado de una casilla cuya pieza no llegó, según lo acordado con el cliente
function estadoFalt(f) {
  if (!f || !f.decision) return null;
  if (f.entregado) return "Entregado";
  if (f.decision === "Se repone desde stock") return f.serial_nuevo ? "Listo para entregar" : "Repuesto desde stock";
  return "Sin reposición (acordado)";
}

// ---------- Estado de una casilla ----------
function estadoCasilla(c) {
  if (c.repo_estado) return c.repo_estado;
  // Por defecto todo se repone desde stock, salvo lo que está bien o ya entregado
  const auto = estadoAutomatico(c);
  // Batería en buen estado de un equipo en lista "solo batería" (o cuya batería OK se reutiliza en otro): igualmente se entrega una nueva
  if (auto === "Listo (sin cambios)" && c.m_control && tipoCanonico(c.tipo_componente) === "Batería") {
    const eq = equiposCompletos[c.m_control];
    if (eq && (eq.tipo_reposicion === "Batería" || eq.bateria_ok)) return "Repuesto desde stock";
  }
  return (auto === "Listo (sin cambios)" || auto === "Entregado") ? auto : "Repuesto desde stock";
}
function estadoAutomatico(c) {
  const d = c.destino || "";
  if (!d || c.estado === "Pendiente revisión" || d.includes("Sigue en revisión")) return "En revisión";
  if (d.includes("Devolver al cliente")) return c.devuelto ? "Entregado" : "Listo (sin cambios)";
  if (d === DESTINO_AMMI) {
    return (c.vandalismo || c.garantia_cliente === "NO") ? "Presupuesto pendiente" : "En AMMI (garantía)";
  }
  if (d.includes("Stock") || d.includes("Desechar")) return "Por reponer de stock";
  return "Revisar destino";
}

// "Repuesto desde stock" + categoría: p. ej. "Repuesto desde stock · 2ª cat."
const etiquetaEstado = (c, est) => {
  if (est === "Repuesto desde stock" && c && c.repo_serial_nuevo) est = "Serializado · pendiente de OK";
  else if (est === "Repuesto desde stock" || est === "Por reponer de stock") est = "Reponer desde Stock";
  return est + (c && c.repo_categoria ? " · " + c.repo_categoria + "ª cat." : "");
};
const selCategoria = (c, dis = "") => `<select class="sel-cat" ${dis} title="Categoría de la pieza que se entrega">
    <option value="">Categoría…</option>
    <option value="1" ${c.repo_categoria === 1 ? "selected" : ""}>1ª categoría</option>
    <option value="2" ${c.repo_categoria === 2 ? "selected" : ""}>2ª categoría</option></select>`;

function claseEstado(e) {
  if (e === "Entregado") return "orep-info";
  if (RESUELTOS.has(e)) return "orep-ok";
  if (e === "Repuesto desde stock" || e === "Por reponer de stock") return "orep-reponer";
  if (e === "Presupuesto rechazado" || e === "Revisar destino") return "orep-falta";
  return "orep-proc";
}

function categoriaCasilla(c) {
  const d = c.destino || "";
  if (presPorComp[String(c.id)]) return "Presupuesto";
  if (d.includes("Devolver al cliente")) return "Equipo OK";
  if (d === DESTINO_AMMI) return (c.vandalismo || c.garantia_cliente === "NO") ? "Vandalismo sin presupuesto" : "Garantía (AMMI)";
  if (d.includes("Stock") || d.includes("Desechar")) return "Por reponer de stock";
  return "Sin clasificar";
}

function notaCasilla(c) {
  const partes = [];
  const pre = presPorComp[String(c.id)];
  if (pre) partes.push("💰 PRE-" + String(pre.numero).padStart(3, "0") + (pre.oferta ? " (" + pre.oferta + ")" : "") + ": " +
    (pre.aprobada === true ? "aprobada" : pre.aprobada === false ? "rechazada" : "pendiente") + " · " + pre.estado);
  if (c.vandalismo) partes.push("🔨 vandalismo");
  if (c.destino === DESTINO_AMMI) partes.push(c.garantia_cliente === "NO" ? "sin garantía" : (c.garantia_cliente === "SI" ? "con garantía" : ""));
  return partes.filter(Boolean).join(" · ");
}

// "Batería Recargable", "Batería No Recargable", etc. cuentan como la casilla "Batería"
function tipoCanonico(t) {
  const l = (t || "").toLowerCase();
  return l.includes("bater") ? "Batería" : t;
}

// ---------- Tipo de reposición: piezas/equipo vs solo batería ----------
const tipoRep = mc => (equiposCompletos[mc] && equiposCompletos[mc].tipo_reposicion === "Batería") ? "Batería" : "Piezas";

// En una reposición de solo batería, el equipo solo cuenta con la casilla de la batería
function aplicarTipoBateria(m) {
  if (tipoRep(m.mc) !== "Batería") return;
  m.casillas = m.casillas.filter(x => x.tipo === "Batería");
  const x = m.casillas[0];
  const est = x ? (x.comp ? estadoCasilla(x.comp) : estadoFalt(x.falt)) : null;
  m.faltan = (!est) ? ["Batería"] : [];
  if (m.faltan.length) m.estadoMc = "Incompleto";
  else if (est === "Entregado") m.estadoMc = "Entregado";
  else if (RESUELTOS.has(est)) m.estadoMc = "Listo para entregar";
  else m.estadoMc = "En proceso";
}

// ---------- Agrupar por MC ----------
function agruparPorMc(comps, idOt) {
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
      const comp = delTipo.length ? delTipo[delTipo.length - 1] : null;
      const falt = comp ? null : (faltantes.find(f => f.id_ot === idOt && f.m_control === mc && f.tipo_componente === t) || null);
      return { tipo: t, comp, falt };
    });
    const faltan = casillas.filter(x => !x.comp && !estadoFalt(x.falt)).map(x => x.tipo);
    const estados = casillas.map(x => x.comp ? estadoCasilla(x.comp) : estadoFalt(x.falt)).filter(Boolean);
    let estadoMc;
    if (faltan.length) estadoMc = "Incompleto";
    else if (estados.every(e => e === "Entregado")) estadoMc = "Entregado";
    else if (estados.every(e => RESUELTOS.has(e))) estadoMc = "Listo para entregar";
    else estadoMc = "En proceso";
    return { mc, casillas, faltan, estadoMc, cliente: lista[0].cliente };
  }).sort((a, b) => a.mc.localeCompare(b.mc));
}

// ---------- Lista de OTs ----------
let esManager = false;

async function detectarRol() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const { data: perfil } = await supabaseClient.from("perfiles").select("rol").eq("id", session.user.id).single();
    esManager = perfil?.rol === "manager";
  }
  // El operario ve las órdenes y marca entregas; no crea órdenes ni decide excepciones
  document.getElementById("bloque-buscar").hidden = !esManager;
  document.getElementById("bloque-extra").hidden = !esManager;
  document.getElementById("bloque-lote").hidden = !esManager;
  document.getElementById("bloque-listas").hidden = !esManager;
  document.getElementById("orep-tabs").hidden = !esManager;
  document.querySelectorAll(".solo-manager").forEach(el => { el.hidden = !esManager; });
  if (!esManager) {
    const volver = document.querySelector(".btn-volver");
    if (volver) { volver.href = "ruta.html"; volver.innerHTML = '<span class="btn-volver-flecha">←</span> Volver a Ruta'; }
  }
}

(async () => {
  await detectarRol();
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

  // Solo cargamos piezas de las OTs que ya tienen orden (las demás no muestran contadores)
  const ids = otsManuales.filter(o => ordenesPorOt[o.id_ot]).map(o => o.id_ot);
  const comps = [];
  for (let i = 0; i < ids.length; i += 20) {
    const trozo = ids.slice(i, i + 20);
    const { data } = await traerComps(`id_ot.in.(${trozo.join(",")}),orden_reposicion_ot.in.(${trozo.join(",")})`);
    (data || []).forEach(c => comps.push(c));
  }

  faltantes = [];
  for (let i = 0; i < ids.length; i += 20) {
    const { data: fl } = await supabaseClient.from("reposicion_faltantes").select("*").in("id_ot", ids.slice(i, i + 20));
    (fl || []).forEach(f => faltantes.push(f));
  }
  compsManuales = comps;
  renderLista();
}

// Fila de una OT con sus contadores
function filaOt(o) {
  const delOt = compsManuales.filter(c => (c.orden_reposicion_ot || c.id_ot) === o.id_ot);
  const mcs = agruparPorMc(delOt, o.id_ot);
  const n = e => mcs.filter(m => m.estadoMc === e).length;
  const orden = ordenesPorOt[o.id_ot];
  const num = v => orden ? v : "—";
  return `<tr class="orep-fila" data-ot="${esc(o.id_ot)}">
    <td>${orden ? `<strong>${codigoOrden(orden.numero)}</strong>` : '<em>Sin crear</em>'}</td><td>${esc(o.id_ot)}</td><td>${esc(o.cliente || "—")}</td>
    <td>${num(mcs.length)}</td><td>${num(n("Incompleto"))}</td><td>${num(n("En proceso"))}</td>
    <td>${num(n("Listo para entregar"))}</td><td>${num(n("Entregado"))}</td></tr>`;
}

// La lista principal solo muestra REP-001 y las OTs que YA tienen orden.
// Las demás OTs manuales (incluidas las HIST-) se encuentran con el buscador.
function renderLista() {
  const tbody = document.getElementById("tbody-ots");
  const conOrden = otsManuales.filter(o => ordenesPorOt[o.id_ot] && (esManager || ordenesPorOt[o.id_ot].lista_activa));
  conOrden.sort((a, b) => ordenesPorOt[a.id_ot].numero - ordenesPorOt[b.id_ot].numero);
  tbody.innerHTML = filaHistoricaHtml + (conOrden.length || esManager ? conOrden.map(filaOt).join("") : '<tr><td colspan="8">No hay ninguna lista de reposición activa por ahora.</td></tr>');
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
    if (!esManager) { alert("Esta OT todavía no tiene orden de reposición. Pídele al manager que la cree."); return; }
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
  listaSel = (ordenesPorOt[idOt] && ordenesPorOt[idOt].lista_activa) || "";
  if (typeof mostrarPestana === "function") mostrarPestana("equipos");
  document.querySelectorAll("tr.orep-fila").forEach(tr =>
    tr.classList.toggle("orep-activa", tr.dataset.ot === idOt));
  document.getElementById("detalle").hidden = false;
  document.getElementById("detalle-titulo").textContent = `Orden ${codigoOrden(ordenesPorOt[idOt].numero)} — ${idOt}`;
  document.getElementById("lista-mc").innerHTML = "<p>Cargando...</p>";
  await recargarOt();
  document.getElementById("detalle").scrollIntoView({ behavior: "smooth" });
}

async function recargarOt() {
  const { data, error } = await traerComps(`id_ot.eq.${otActual},orden_reposicion_ot.eq.${otActual}`);
  if (error) { document.getElementById("lista-mc").innerHTML = `<p>Error: ${esc(error.message)}</p>`; return; }
  const { data: fl } = await supabaseClient.from("reposicion_faltantes").select("*").eq("id_ot", otActual);
  faltantes = faltantes.filter(f => f.id_ot !== otActual).concat(fl || []);
  // Fuera: piezas de esta OT que se cuentan en la orden de otra OT
  compsOtActual = (data || []).filter(c => (c.orden_reposicion_ot || c.id_ot) === otActual);
  clienteOtActual = (otsManuales.find(o => o.id_ot === otActual) || {}).cliente || "";
  equiposCompletos = {};
  try {
    const { data: eqs } = await supabaseClient.from("reposicion_equipos").select("*").eq("id_ot", otActual);
    (eqs || []).forEach(e => { equiposCompletos[e.m_control] = e; });
  } catch (err) { console.error(err); }
  fechasEntrega = {};
  fechasFactura = {};
  try {
    const mcsOt = [...new Set(compsOtActual.map(c => c.m_control).filter(Boolean))];
    for (let i = 0; i < mcsOt.length; i += 100) {
      const { data: fe } = await supabaseClient.from("fechas_entrega").select("identificador, fecha_entrega, fecha_factura").in("identificador", mcsOt.slice(i, i + 100));
      (fe || []).forEach(f => { if (f.fecha_entrega) fechasEntrega[f.identificador] = f.fecha_entrega; if (f.fecha_factura) fechasFactura[f.identificador] = f.fecha_factura; });
    }
    const sinFecha = mcsOt.filter(m => !fechasEntrega[m]);
    for (let i = 0; i < sinFecha.length; i += 100) {
      const { data: eq } = await supabaseClient.from("equipos").select("m_control, fecha_instalacion").in("m_control", sinFecha.slice(i, i + 100));
      (eq || []).forEach(e => { if (e.fecha_instalacion) fechasEntrega[e.m_control] = e.fecha_instalacion; });
    }
  } catch (err) { console.error("No se pudieron cargar las fechas de entrega:", err); }
  fraccionesEq = {};
  try {
    const mcsNuevos = compsOtActual.filter(c => /m[oó]dulo/i.test(c.tipo_componente || "") && c.repo_serial_nuevo).map(c => String(c.repo_serial_nuevo).trim().toUpperCase());
    const todosMc = [...new Set([...compsOtActual.map(c => c.m_control).filter(Boolean), ...mcsNuevos])];
    for (let i = 0; i < todosMc.length; i += 100) {
      const { data: fr } = await supabaseClient.from("equipos").select("m_control, fraccion").in("m_control", todosMc.slice(i, i + 100));
      (fr || []).forEach(f => { fraccionesEq[f.m_control] = f.fraccion || ""; });
    }
  } catch (err) { console.error("No se pudieron cargar las fracciones:", err); }
  try { await cargarSerialesBok(); } catch (err) { console.error(err); }
  presPorComp = {};
  try {
    const ids = [...new Set(compsOtActual.map(c => String(c.id)))];
    for (let i = 0; i < ids.length; i += 100) {
      const { data: pl } = await supabaseClient.from("presupuesto_lineas")
        .select("componente_id, aprobada, ordenes_presupuesto(numero, numero_oferta, estado)").in("componente_id", ids.slice(i, i + 100));
      (pl || []).forEach(l => { if (l.ordenes_presupuesto) presPorComp[String(l.componente_id)] = { numero: l.ordenes_presupuesto.numero, oferta: l.ordenes_presupuesto.numero_oferta, estado: l.ordenes_presupuesto.estado, aprobada: l.aprobada }; });
    }
  } catch (err) { console.error(err); }
  renderDetalle();
}

function renderDetalle() {
  const mcs = agruparPorMc(compsOtActual, otActual);
  mcs.forEach(aplicarTipoBateria);
  const activa = (ordenesPorOt[otActual] || {}).lista_activa || "";
  // El operario solo ve la lista activa: no puede cambiarla ni ver el resto de la orden
  if (!esManager) listaSel = activa;
  const sinListaActiva = !esManager && !activa;
  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fEst = document.getElementById("filtro-estado-mc").value;
  // Selector de listas (con contador) y orden
  const nombresListas = {};
  Object.values(equiposCompletos).forEach(e => { if (e.lista) nombresListas[e.lista] = (nombresListas[e.lista] || 0) + 1; });
  const selLista = document.getElementById("filtro-lista");
  selLista.innerHTML = '<option value="">Todos los equipos de la orden</option><option value="__sin">Sin lista</option>' +
    Object.keys(nombresListas).sort().map(n => `<option value="${esc(n)}">📋 ${esc(n)} (${nombresListas[n]})${n === activa ? " ★ activa" : ""}</option>`).join("");
  if (listaSel && listaSel !== "__sin" && !nombresListas[listaSel]) listaSel = "";
  selLista.value = listaSel;
  const fCat = document.getElementById("filtro-categoria").value;
  const cumpleCat = m => {
    if (!fCat) return true;
    if (fCat === "Con piezas faltantes") return m.faltan.length > 0 || m.casillas.some(x => !x.comp && x.falt);
    if (fCat === "Cambio de equipo completo") return !!(equiposCompletos[m.mc] && equiposCompletos[m.mc].cambio_completo);
    if (fCat === "Presupuesto aprobado") return m.casillas.some(x => x.comp && presPorComp[String(x.comp.id)] && presPorComp[String(x.comp.id)].aprobada === true);
    return m.casillas.some(x => x.comp && categoriaCasilla(x.comp) === fCat);
  };
  const cumpleTipo = m => (tipoRep(m.mc) === "Batería") === (subTab === "Batería");
  const cumpleLista = m => !listaSel || (listaSel === "__sin" ? !(equiposCompletos[m.mc] && equiposCompletos[m.mc].lista) : (equiposCompletos[m.mc] && equiposCompletos[m.mc].lista) === listaSel);
  // Tarjetas: cuentan solo los equipos de la lista mostrada
  const mcsLista = sinListaActiva ? [] : mcs.filter(cumpleLista);
  // Baterías sin MC que están en la lista mostrada
  const sinMcBat = sinListaActiva ? [] : compsOtActual.filter(c => !c.m_control && tipoCanonico(c.tipo_componente) === "Batería" && c.repo_lista &&
    (!listaSel || (listaSel !== "__sin" && c.repo_lista === listaSel)));
  const estSinMc = c => { const e = estadoCasilla(c); return e === "Entregado" ? "Entregado" : RESUELTOS.has(e) ? "Listo para entregar" : "En proceso"; };
  const delSub = mcsLista.filter(cumpleTipo);
  const nPiezas = mcsLista.filter(m => tipoRep(m.mc) !== "Batería").length;
  const nBat = mcsLista.filter(m => tipoRep(m.mc) === "Batería").length + sinMcBat.length;
  document.getElementById("sub-piezas").textContent = `📦 Equipos (${nPiezas})`;
  document.getElementById("sub-bat").textContent = `🔋 Baterías (${nBat})`;
  document.getElementById("sub-piezas").classList.toggle("orep-tab-activa", subTab === "Piezas");
  document.getElementById("sub-bat").classList.toggle("orep-tab-activa", subTab === "Batería");
  const n = e => delSub.filter(m => m.estadoMc === e).length + (subTab === "Batería" ? sinMcBat.filter(c => estSinMc(c) === e).length : 0);
  const totalSub = delSub.length + (subTab === "Batería" ? sinMcBat.length : 0);
  document.getElementById("detalle-resumen").innerHTML = `
    <div class="tarjeta-resumen"><strong>${totalSub}</strong><span>${subTab === "Batería" ? "Baterías" : "Equipos"}</span></div>
    <div class="tarjeta-resumen"><strong>${n("Incompleto")}</strong><span>Incompletos</span></div>
    <div class="tarjeta-resumen"><strong>${n("En proceso")}</strong><span>En proceso</span></div>
    <div class="tarjeta-resumen"><strong>${n("Listo para entregar")}</strong><span>Listos para entregar</span></div>
    <div class="tarjeta-resumen"><strong>${n("Entregado")}</strong><span>Entregados</span></div>`;
  const nombreMostrado = listaSel === "__sin" ? "Equipos sin lista" : listaSel ? "📋 " + listaSel + (listaSel === activa ? " ★ activa" : "") : "Todos los equipos de la orden";
  document.getElementById("lista-banner").innerHTML = sinListaActiva
    ? "Esta orden todavía no tiene una lista de reposición activa."
    : `Mostrando: <strong>${esc(nombreMostrado)}</strong> · ${nPiezas} equipos y ${nBat} baterías` + (esManager && activa && listaSel !== activa ? ` · <em>la lista activa para el operario es "${esc(activa)}"</em>` : "");
  const visibles = sinListaActiva ? [] : mcs.filter(m => (!fMc || m.mc.toLowerCase().includes(fMc)) && (!fEst || m.estadoMc === fEst) && cumpleCat(m) && cumpleLista(m) && cumpleTipo(m));
  // Orden: por fecha de entrega al cliente, de la más antigua a la más reciente (sin fecha, al final)
  const modoOrden = document.getElementById("orden-mc").value;
  if (modoOrden === "factura") {
    visibles.sort((a, b) => {
      const fa = fechasFactura[a.mc] || "9999", fb = fechasFactura[b.mc] || "9999";
      return fa.localeCompare(fb) || a.mc.localeCompare(b.mc);
    });
  } else if (modoOrden === "fecha") {
    visibles.sort((a, b) => {
      const fa = fechasEntrega[a.mc] || "9999", fb = fechasEntrega[b.mc] || "9999";
      return fa.localeCompare(fb) || a.mc.localeCompare(b.mc);
    });
  }

  const visSinMc = sinMcBat.filter(c => (!fMc || (c.serial_retirado || "").toLowerCase().includes(fMc)) && (!fEst || estSinMc(c) === fEst || (fEst === "Incompleto" && false)));
  const htmlLista = subTab === "Batería" ? visibles.map(htmlMc).join("") + visSinMc.map(htmlBateriaSinMc).join("") : visibles.map(htmlMc).join("");
  document.getElementById("lista-mc").innerHTML = (visibles.length || (subTab === "Batería" && visSinMc.length))
    ? htmlLista
    : `<p>${sinListaActiva ? "No hay nada que reponer por ahora." : "Ningún elemento coincide."}</p>`;

  ctxResumen = { nombre: sinListaActiva ? "" : nombreMostrado, equipos: sinListaActiva ? [] : mcsLista, sinMc: sinMcBat };
  const btnRes = document.getElementById("btn-resumen-comp");
  if (btnRes) btnRes.onclick = abrirResumenComponentes;

  enlazarEventos();
  if (esManager) { renderListas(); renderBok(); }
}

// ---------- Resumen de componentes (ventana de informe) ----------
let ctxResumen = { nombre: "", equipos: [], sinMc: [] };

// Una pieza cuenta como "a reponer / repuesta" salvo que esté bien, rechazada o reparada
function cuentaComoReposicion(c, est) {
  if (["Listo (sin cambios)", "Sin reposición (acordado)", "Presupuesto rechazado", "Reparado recibido"].includes(est)) return false;
  if (est === "Entregado") return !!c.repo_serial_nuevo || !!c.repo_estado;
  return true;
}

function calcularResumenComponentes() {
  const filas = {};
  const fila = tipo => (filas[tipo] = filas[tipo] || { total: 0, pend: 0, serial: 0, listo: 0, entregado: 0, c1: 0, c2: 0, sinCat: 0 });
  const sumar = (tipo, est, serial, cat) => {
    const f = fila(tipo);
    f.total++;
    if (est === "Entregado") f.entregado++;
    else if (est === "Listo para entregar") f.listo++;
    else if (serial) f.serial++;
    else f.pend++;
    if (cat === 1) f.c1++; else if (cat === 2) f.c2++; else f.sinCat++;
  };
  let equiposCompletos_n = 0;
  ctxResumen.equipos.forEach(m => {
    if (equiposCompletos[m.mc] && equiposCompletos[m.mc].cambio_completo) equiposCompletos_n++;
    m.casillas.forEach(x => {
      if (x.comp) {
        const est = estadoCasilla(x.comp);
        if (cuentaComoReposicion(x.comp, est)) sumar(tipoCanonico(x.comp.tipo_componente || x.tipo), est, x.comp.repo_serial_nuevo, x.comp.repo_categoria);
      } else if (x.falt && x.falt.decision === "Se repone desde stock") {
        sumar(x.tipo, estadoFalt(x.falt), x.falt.serial_nuevo, null);
      }
    });
  });
  ctxResumen.sinMc.forEach(c => {
    const est = estadoCasilla(c);
    if (cuentaComoReposicion(c, est)) sumar("Batería", est, c.repo_serial_nuevo, c.repo_categoria);
  });
  const orden = [...TIPOS, ...Object.keys(filas).filter(t => !TIPOS.includes(t))];
  return { filas, orden: orden.filter(t => filas[t]), equiposCompletos_n };
}

function abrirResumenComponentes() {
  const r = calcularResumenComponentes();
  const tot = { total: 0, pend: 0, serial: 0, listo: 0, entregado: 0, c1: 0, c2: 0, sinCat: 0 };
  r.orden.forEach(t => Object.keys(tot).forEach(k => { tot[k] += r.filas[t][k]; }));
  const cab = ["Componente", "A reponer", "Pendientes", "Serializados (pend. OK)", "Listos", "Entregados", "1ª cat.", "2ª cat.", "Sin categoría"];
  const lin = (t, f) => [t, f.total, f.pend, f.serial, f.listo, f.entregado, f.c1, f.c2, f.sinCat];
  const datos = r.orden.map(t => lin(t, r.filas[t])).concat([lin("TOTAL", tot)]);
  const cuerpo = datos.map((d, i) => `<tr class="${i === datos.length - 1 ? "res-total" : ""}">` +
    d.map((v, j) => `<td ${j ? "" : ""}>${j ? v : esc(v)}</td>`).join("") + "</tr>").join("");
  const textoPlano = [cab, ...datos].map(f => f.join("\t")).join("\n");
  document.getElementById("modal-resumen")?.remove();
  const m = document.createElement("div");
  m.id = "modal-resumen";
  m.className = "modal-resumen";
  m.innerHTML = `<div class="modal-resumen-caja">
    <div class="modal-resumen-cab"><h3>📊 Resumen de componentes</h3><button type="button" class="modal-x" aria-label="Cerrar">✕</button></div>
    <p class="modal-sub">${esc(ctxResumen.nombre || "—")} · ${ctxResumen.equipos.length} equipos${ctxResumen.sinMc.length ? " y " + ctxResumen.sinMc.length + " baterías sin MC" : ""}${r.equiposCompletos_n ? " · " + r.equiposCompletos_n + " con cambio de equipo completo" : ""}</p>
    ${r.orden.length ? `<div class="scroll-x-tabla" style="max-height:none;"><table class="tabla-resumen-comp"><thead><tr>${cab.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${cuerpo}</tbody></table></div>` : "<p>No hay componentes por reponer en esta lista.</p>"}
    <p class="modal-nota">«A reponer» incluye lo pendiente, lo serializado a la espera de OK, lo listo y lo ya entregado. No cuenta lo que está «Listo (sin cambios)», rechazado o reparado. La categoría es la que se elige en «Serial a entregar».</p>
    <div class="modal-acciones"><button type="button" class="modal-copiar">📋 Copiar tabla</button><button type="button" class="modal-cerrar">Cerrar</button></div>
  </div>`;
  document.body.appendChild(m);
  const cerrar = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m || e.target.closest(".modal-x, .modal-cerrar")) cerrar(); });
  m.querySelector(".modal-copiar").addEventListener("click", async e => {
    try { await navigator.clipboard.writeText(textoPlano); e.target.textContent = "✅ Copiado"; } catch { e.target.textContent = "No se pudo copiar"; }
  });
}

function claseMc(e) {
  return { "Entregado": "orep-info", "Listo para entregar": "orep-ok", "En proceso": "orep-proc", "Incompleto": "orep-falta" }[e];
}

const tipoCanon2 = t => /bater/i.test(t || "") ? "Batería" : (t || "");
function bateriaDe(mc) { return compsOtActual.find(c => c.m_control === mc && tipoCanon2(c.tipo_componente) === "Batería") || null; }

// Batería sin MC (caso "desconocido"): fila propia con los mismos campos que las demás
function htmlBateriaSinMc(c) {
  const est = estadoCasilla(c);
  const opciones = ['<option value="">Automático</option>']
    .concat(ESTADOS_MANUALES.map(e => `<option value="${e}" ${(c.repo_estado || (est === "Repuesto desde stock" ? "Repuesto desde stock" : "")) === e ? "selected" : ""}>${nombreEstado(e)}</option>`)).join("");
  const boton = est !== "Entregado" ? `<button type="button" class="btn-bat-entregada-id" data-id="${c.id}">🔋 Marcar batería entregada</button>` : "";
  return `<div class="orep-mc">
    <div class="orep-mc-cab"><strong>Sin MC</strong>
      <span class="orep-badge orep-info">🔋 Solo batería</span>
      <span class="orep-badge ${claseEstado(est)}">${esc(est)}</span>
      <span>${esc(c.cliente || "")} · batería retirada ${esc(c.serial_retirado || "—")}${c.repo_lista ? " · 📋 " + esc(c.repo_lista) : ""}</span></div>
    <div class="scroll-x-tabla" style="max-height:none;"><table>
      <thead><tr><th>Componente</th><th>Serial retirado</th><th>Destino</th><th>Estado</th><th>Ajuste manual</th><th>Serial a entregar</th><th>Nota</th></tr></thead>
      <tbody><tr data-id="${c.id}">
        <td data-label="Componente">${esc(c.tipo_componente || "Batería")}<br><small>desde ${esc(c.id_ot || "—")}</small></td>
        <td data-label="Serial retirado">${esc(c.serial_retirado || "—")}</td>
        <td data-label="Destino">${esc((c.destino || "Sin destino").replace(/^[✓❌🚨]\s*/u, ""))}</td>
        <td data-label="Estado"><span class="orep-badge ${claseEstado(est)}">${esc(etiquetaEstado(c, est))}</span></td>
        <td data-label="Ajuste manual"><select class="sel-estado-manual" ${esManager ? "" : "disabled"}>${opciones}</select></td>
        <td data-label="Serial a entregar"><input type="text" class="inp-serial-nuevo" placeholder="Serial entregado" value="${esc(c.repo_serial_nuevo || "")}"><br>${selCategoria(c)}</td>
        <td data-label="Nota"><input type="text" class="inp-nota" placeholder="Nota" value="${esc(c.repo_nota || "")}"></td>
      </tr></tbody></table></div>
    <div class="orep-acciones">${boton}</div>
  </div>`;
}

function htmlMc(m) {
  const filas = m.casillas.map(x => {
    if (!x.comp) {
      const f = x.falt;
      const estF = estadoFalt(f);
      const dec = f && f.decision;
      return `<tr class="fila-falt" data-mc="${esc(m.mc)}" data-tipo="${esc(x.tipo)}">
        <td data-label="Componente">${esc(x.tipo)}</td><td data-label="Serial retirado">—</td><td data-label="Destino"><small>No llegó</small></td>
        <td data-label="Estado">${estF ? `<span class="orep-badge ${claseEstado(estF)}">${esc(estF)}</span>` : '<span class="orep-badge orep-falta">Falta — aclarar con el cliente</span>'}</td>
        <td data-label="Decisión"><select class="sel-falt" ${esManager ? "" : "disabled"}>
          <option value="">Pendiente de aclarar</option>
          <option value="Se repone desde stock" ${dec === "Se repone desde stock" ? "selected" : ""}>Se repone desde stock</option>
          <option value="Sin reposición" ${dec === "Sin reposición" ? "selected" : ""}>Sin reposición (el cliente lo acepta)</option>
        </select></td>
        <td data-label="Serial a entregar"><input type="text" class="inp-falt-serial" placeholder="Serial entregado" ${esManager ? "" : "disabled"} value="${esc((f && f.serial_nuevo) || "")}"></td></tr>`;
    }
    const c = x.comp;
    const est = estadoCasilla(c);
    const opciones = ['<option value="">Automático</option>']
      .concat(ESTADOS_MANUALES.map(e => `<option value="${e}" ${(c.repo_estado || (est === "Repuesto desde stock" ? "Repuesto desde stock" : "")) === e ? "selected" : ""}>${nombreEstado(e)}</option>`)).join("");
    const extra = c.orden_reposicion_ot
      ? ` <button type="button" class="btn-quitar-extra" data-id="${c.id}" title="Quitar de esta orden">✕ de esta orden</button>` : "";
    const bloq = est === "Listo (sin cambios)" && !esManager; // el operario no toca lo que no se cambia
    const dis = bloq ? "disabled" : "";
    return `<tr data-id="${c.id}" class="${bloq ? "fila-bloq" : ""}">
      <td data-label="Componente">${esc(c.tipo_componente || x.tipo)}${c.orden_reposicion_ot ? `<br><small>desde ${esc(c.id_ot)}</small>` : ""}</td>
      <td data-label="Serial retirado">${esc(c.serial_retirado || "—")}</td>
      <td data-label="Destino">${esc((c.destino || "Sin destino").replace(/^[✓❌🚨]\s*/u, ""))}<br><small>${esc(notaCasilla(c))}</small></td>
      <td data-label="Estado"><span class="orep-badge ${claseEstado(est)}">${esc(etiquetaEstado(c, est))}</span></td>
      <td data-label="Ajuste manual"><select class="sel-estado-manual" ${esManager ? "" : "disabled"}>${opciones}</select></td>
      <td data-label="Serial a entregar"><input type="text" class="inp-serial-nuevo" placeholder="Serial entregado" ${dis} value="${esc(c.repo_serial_nuevo || "")}">${avisoFraccion(c)}<br>${selCategoria(c, dis)}${esManager && c.repo_serial_nuevo && est === "Repuesto desde stock" ? ` <button type="button" class="btn-ok-pieza" data-id="${c.id}">✅ Dar OK</button>` : ""}${esManager ? extra : ""}</td>
    </tr>`;
  }).join("");

  const fechaEnt = m.casillas.map(x => x.comp && x.comp.repo_fecha_entrega).filter(Boolean)[0];
  const esBat = tipoRep(m.mc) === "Batería";
  const botonEntrega = esBat
    ? (m.estadoMc !== "Entregado" ? `<button type="button" class="btn-bat-entregada" data-mc="${esc(m.mc)}">🔋 Marcar batería entregada</button>` : "")
    : (m.estadoMc === "Listo para entregar"
      ? `<button type="button" class="btn-entregar" data-mc="${esc(m.mc)}">📦 Marcar equipo entregado</button>` : "");
  const detalleFaltan = m.faltan.length ? ` · faltan: ${esc(m.faltan.join(", "))}` : "";

  const eqc = equiposCompletos[m.mc] || {};
  // Batería OK de otro equipo que se instala en este
  const recibeDe = Object.values(equiposCompletos).filter(e => e.bateria_ok && e.bateria_ok_destino === m.mc);
  const bloqueRecibe = recibeDe.map(e => {
    const serial = serialBok(e.m_control);
    return `<span class="orep-badge orep-info">🔁 Recibe la batería OK ${esc(serial)} de ${esc(e.m_control)}</span>` +
      (serial && !esBat ? ` <button type="button" class="btn-usar-bok" data-mc="${esc(m.mc)}" data-serial="${esc(serial)}">Usar como serial a entregar</button>` : "");
  }).join(" ");
  const nPorOk = esManager ? m.casillas.filter(x => x.comp && x.comp.repo_serial_nuevo && estadoCasilla(x.comp) === "Repuesto desde stock").length : 0;
  const botonOkTodo = nPorOk > 1 ? `<button type="button" class="btn-ok-equipo" data-mc="${esc(m.mc)}">✅ Dar OK a las ${nPorOk} piezas serializadas</button>` : "";
  const aCambiar = m.casillas.map(x => {
    if (x.comp) return necesitaCambio(x.comp, estadoCasilla(x.comp)) ? (x.comp.tipo_componente || x.tipo) : null;
    return x.falt && x.falt.decision === "Se repone desde stock" ? x.tipo : null;
  }).filter(Boolean);
  const chipCambiar = aCambiar.length
    ? `<span class="orep-chip-cambiar">🔧 Cambiar: ${esc(aCambiar.join(", "))}</span>`
    : '<span class="orep-chip-nada">Nada que cambiar</span>';
  const otsOrigen = [...new Set(m.casillas.map(x => x.comp && x.comp.id_ot).filter(Boolean))].sort();
  const fFac = fechasFactura[m.mc] ? new Date(fechasFactura[m.mc] + "T00:00:00").toLocaleDateString("es-ES") : "";
  const fEnt = fechasEntrega[m.mc];
  const fEntTxt = fEnt ? new Date(fEnt + "T00:00:00").toLocaleDateString("es-ES") : "sin fecha de entrega";
  return `<div class="orep-mc">
    <div class="orep-mc-cab">
      <strong>${esc(m.mc)}</strong>
      ${otsOrigen.length ? `<span class="orep-badge orep-gris" title="OT de la que vienen las piezas">📍 ${esc(otsOrigen.join(" · "))}</span>` : ""}
      <span class="orep-badge ${claseMc(m.estadoMc)}">${esc(m.estadoMc)}</span>
      ${esBat ? '<span class="orep-badge orep-info">🔋 Solo batería</span>' : ""}
      ${eqc.bateria_ok ? `<span class="orep-badge orep-ok">🔁 Batería OK: se usa en ${esc(eqc.bateria_ok_destino || "otro equipo")} · este equipo recibe una nueva</span>` : ""}
      ${bloqueRecibe}
      ${eqc.cambio_completo && !esBat ? '<span class="orep-badge orep-info">🔄 Equipo completo</span>' : ""}
      ${esBat ? chipCambiar : ""}
      ${eqc.lista ? `<span class="orep-badge orep-gris">📋 ${esc(eqc.lista)}</span>` : ""}
      <span>${esc(m.cliente || "")}${detalleFaltan}${fechaEnt ? ` · entregado el ${esc(fechaEnt)}` : ""}</span>
      <span class="orep-fecha-ent" title="Fecha real de entrega del equipo al cliente">📅 Entrega: ${esc(fEntTxt)}${fFac ? ` · <span title="Fecha de factura / inicio de contrato (la del Excel de Porto)">🧾 Factura: ${esc(fFac)}</span>` : ""}</span></div>
    ${esBat ? (esManager ? `<div class="orep-mc-sub">
      <label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="chk-bok" data-mc="${esc(m.mc)}" ${eqc.bateria_ok ? "checked" : ""}> 🔁 Batería OK: reutilizar en otro equipo</label>
      <input type="text" class="inp-bok-dest" data-mc="${esc(m.mc)}" placeholder="MC al que va" value="${esc(eqc.bateria_ok_destino || "")}" style="width:160px;">
    </div>` : "") : `<div class="orep-mc-sub">
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" class="chk-eqc" data-mc="${esc(m.mc)}" ${eqc.cambio_completo ? "checked" : ""} ${esManager ? "" : "disabled"}> 🔄 Se cambia el equipo completo</label>
      <input type="text" class="inp-eqc-nota" data-mc="${esc(m.mc)}" placeholder="Nota general del equipo (faltantes, observaciones…)" value="${esc(eqc.nota || "")}">
      ${chipCambiar}${botonOkTodo}
    </div>`}
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
      const val = inp.value.trim() || null;
      const c = compsOtActual.find(x => String(x.id) === String(id)) || {};
      const cambios = { repo_serial_nuevo: val };
      // Con el serial puesto, la pieza queda lista para entregar; si se borra, vuelve a su estado automático
      // El serial no cambia el estado: la pieza queda "pendiente de OK" hasta que el manager la marque lista
      if (!val && c.repo_estado === "Listo para entregar") cambios.repo_estado = null;
      await guardarComp(id, cambios, true);
    }));

  const guardarFalt = async (tr) => {
    const mc = tr.dataset.mc, tipo = tr.dataset.tipo;
    const decision = tr.querySelector(".sel-falt").value || null;
    const serial = tr.querySelector(".inp-falt-serial").value.trim() || null;
    const notaEl = tr.querySelector(".inp-falt-nota");
    const nota = notaEl ? (notaEl.value.trim() || null) : undefined; // sin campo: se conserva la nota existente
    const { error } = await supabaseClient.from("reposicion_faltantes").upsert({
      id_ot: otActual, m_control: mc, tipo_componente: tipo, decision,
      serial_nuevo: decision === "Se repone desde stock" ? serial : null, nota,
      actualizado_en: new Date().toISOString()
    }, { onConflict: "id_ot,m_control,tipo_componente" });
    if (error) { alert("No se pudo guardar: " + error.message + "\n(¿Corriste el SQL 78?)"); return; }
    await recargarOt(); cargarOts();
  };
  document.querySelectorAll(".fila-falt .sel-falt").forEach(sel =>
    sel.addEventListener("change", () => guardarFalt(sel.closest("tr"))));
  document.querySelectorAll(".fila-falt .inp-falt-nota").forEach(inp =>
    inp.addEventListener("change", () => guardarFalt(inp.closest("tr"))));
  document.querySelectorAll(".fila-falt .inp-falt-serial").forEach(inp =>
    inp.addEventListener("change", () => guardarFalt(inp.closest("tr"))));

  document.querySelectorAll(".sel-cat").forEach(sel =>
    sel.addEventListener("change", async () => {
      const id = sel.closest("tr").dataset.id;
      const c = compsOtActual.find(x => String(x.id) === String(id)) || {};
      const cambios = { repo_categoria: sel.value ? parseInt(sel.value, 10) : null };
      // Elegir categoría = se repone desde stock (si aún no tenía un estado manual)
      if (sel.value && (!c.repo_estado || c.repo_estado === "Presupuesto aprobado")) {
        cambios.repo_estado = "Repuesto desde stock";
      }
      if (await guardarComp(id, cambios, true)) cargarOts();
    }));

  document.querySelectorAll(".inp-nota").forEach(inp =>
    inp.addEventListener("change", async () => {
      await guardarComp(inp.closest("tr").dataset.id, { repo_nota: inp.value.trim() || null }, false);
    }));

  const guardarEqc = async (mc) => {
    const chk = document.querySelector(`.chk-eqc[data-mc="${mc}"]`);
    const nota = document.querySelector(`.inp-eqc-nota[data-mc="${mc}"]`).value.trim() || null;
    const { error } = await supabaseClient.from("reposicion_equipos").upsert({
      id_ot: otActual, m_control: mc, cambio_completo: chk.checked, nota, actualizado_en: new Date().toISOString()
    }, { onConflict: "id_ot,m_control" });
    if (error) { alert("No se pudo guardar: " + error.message + "\n(¿Corriste el SQL 86?)"); return; }
    equiposCompletos[mc] = Object.assign({}, equiposCompletos[mc], { id_ot: otActual, m_control: mc, cambio_completo: chk.checked, nota });
    renderDetalle();
  };
  document.querySelectorAll(".chk-eqc").forEach(c => c.addEventListener("change", () => guardarEqc(c.dataset.mc)));
  document.querySelectorAll(".inp-eqc-nota").forEach(i => i.addEventListener("change", () => guardarEqc(i.dataset.mc)));

  document.querySelectorAll(".btn-ok-pieza").forEach(btn =>
    btn.addEventListener("click", async () => {
      if (await guardarComp(btn.dataset.id, { repo_estado: "Listo para entregar" }, true)) cargarOts();
    }));
  document.querySelectorAll(".btn-ok-equipo").forEach(btn =>
    btn.addEventListener("click", async () => {
      const grupo = agruparPorMc(compsOtActual, otActual).find(m => m.mc === btn.dataset.mc);
      const ids = (grupo ? grupo.casillas : []).filter(x => x.comp && x.comp.repo_serial_nuevo && estadoCasilla(x.comp) === "Repuesto desde stock").map(x => x.comp.id);
      for (const id of ids) { if (!(await guardarComp(id, { repo_estado: "Listo para entregar" }, false))) return; }
      await recargarOt(); cargarOts();
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
  const grupo = agruparPorMc(compsOtActual, otActual).find(m => m.mc === mc);
  if (grupo) aplicarTipoBateria(grupo);
  if (!grupo || grupo.estadoMc !== "Listo para entregar") return;
  if (!confirm(`¿Marcar ${mc} como entregado al cliente? Se marcarán sus 4 componentes.`)) return;
  const fecha = hoy();
  for (const x of grupo.casillas) {
    if (!x.comp) {
      if (x.falt && estadoFalt(x.falt)) {
        const { error } = await supabaseClient.from("reposicion_faltantes")
          .update({ entregado: true, fecha_entrega: fecha }).eq("id", x.falt.id);
        if (error) { alert("No se pudo guardar: " + error.message); break; }
      }
      continue;
    }
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
document.getElementById("filtro-categoria").addEventListener("change", () => otActual && renderDetalle());
document.getElementById("sub-piezas").addEventListener("click", () => { subTab = "Piezas"; if (otActual) renderDetalle(); });
document.getElementById("sub-bat").addEventListener("click", () => { subTab = "Batería"; if (otActual) renderDetalle(); });
document.getElementById("orden-mc").addEventListener("change", () => otActual && renderDetalle());
document.getElementById("filtro-lista").addEventListener("change", e => { listaSel = e.target.value; if (otActual) renderDetalle(); });

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

// ---------- Añadir por lotes piezas de otras OT del mismo cliente ----------
let loteCandidatas = [];

document.getElementById("lote-cargar").addEventListener("click", async () => {
  const cont = document.getElementById("lote-resultado");
  const cli = clienteOtActual;
  if (!cli) { cont.innerHTML = "<p>Esta OT no tiene cliente asignado. Corre el SQL 85 o usa la búsqueda por MC.</p>"; return; }
  cont.innerHTML = "<p>Cargando piezas de " + esc(cli) + "...</p>";
  const { data, error } = await traerComps(`cliente.eq."${cli}",cliente_original.eq."${cli}"`);
  if (error) { cont.innerHTML = `<p>Error: ${esc(error.message)}</p>`; return; }
  const entregada = c => c.repo_estado === "Entregado" || ((c.destino || "").includes("Devolver al cliente") && !!c.devuelto);
  loteCandidatas = (data || []).filter(c => c.m_control && (c.orden_reposicion_ot || c.id_ot) !== otActual && !entregada(c));
  const ots = [...new Set(loteCandidatas.map(c => c.orden_reposicion_ot || c.id_ot || "—"))].sort();
  document.getElementById("lote-filtro-ot").innerHTML = '<option value="">Todas las OT</option>' + ots.map(o => `<option>${esc(o)}</option>`).join("");
  document.getElementById("lote-filtros").hidden = false;
  renderLote();
});

function renderLote() {
  const cont = document.getElementById("lote-resultado");
  const fOt = document.getElementById("lote-filtro-ot").value;
  const fCat = document.getElementById("lote-filtro-cat").value;
  const fMc = document.getElementById("lote-filtro-mc").value.trim().toLowerCase();
  const vis = loteCandidatas.filter(c => (!fOt || (c.orden_reposicion_ot || c.id_ot || "—") === fOt) &&
    (!fCat || categoriaCasilla(c) === fCat) && (!fMc || c.m_control.toLowerCase().includes(fMc)))
    .sort((a, b) => a.m_control.localeCompare(b.m_control));
  document.getElementById("lote-contador").textContent = `${vis.length} piezas pendientes de ${clienteOtActual} en otras OT (${loteCandidatas.length} en total)`;
  if (!vis.length) { cont.innerHTML = "<p>Ninguna pieza coincide.</p>"; return; }
  cont.innerHTML = `<div style="max-height:360px;overflow:auto;border:1px solid #e8eee9;border-radius:8px;"><table class="tabla-revision"><thead><tr><th></th><th>MC</th><th>Componente</th><th>Serial</th><th>OT</th><th>Categoría</th><th>Destino</th></tr></thead><tbody>` +
    vis.map(c => `<tr><td><input type="checkbox" class="chk-lote" data-id="${c.id}"></td><td>${esc(c.m_control)}</td><td>${esc(c.tipo_componente || "—")}</td>
      <td>${esc(c.serial_retirado || "—")}</td><td>${esc(c.orden_reposicion_ot || c.id_ot || "—")}</td>
      <td>${esc(categoriaCasilla(c))}</td><td>${esc((c.destino || "Sin destino").replace(/^[✓❌🚨]\s*/u, ""))}</td></tr>`).join("") + "</tbody></table></div>";
}
["lote-filtro-ot", "lote-filtro-cat"].forEach(id => document.getElementById(id).addEventListener("change", renderLote));
document.getElementById("lote-filtro-mc").addEventListener("input", renderLote);
document.getElementById("lote-marcar").addEventListener("click", () =>
  document.querySelectorAll(".chk-lote").forEach(c => { c.checked = true; }));
document.getElementById("lote-anadir").addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".chk-lote:checked")].map(c => c.dataset.id);
  if (!ids.length) { alert("Marca al menos una pieza."); return; }
  if (!confirm(`¿Añadir ${ids.length} pieza(s) a la orden de ${otActual}? Se quedan en su OT original y se cuentan aquí.`)) return;
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabaseClient.from("componentes_retirados").update({ orden_reposicion_ot: otActual }).in("id", ids.slice(i, i + 100));
    if (error) { alert("No se pudo añadir: " + error.message); return; }
  }
  document.getElementById("lote-resultado").innerHTML = `<p>✅ ${ids.length} pieza(s) añadidas a esta orden.</p>`;
  loteCandidatas = loteCandidatas.filter(c => !ids.includes(String(c.id)));
  await recargarOt(); cargarOts();
});

// ---------- Listas de reposición (lo que se repone ahora) ----------
const entregadaC = c => c.repo_estado === "Entregado" || ((c.destino || "").includes("Devolver al cliente") && !!c.devuelto);

async function guardarListaEquipos(mcs, lista, tipo) {
  const filas = mcs.map(mc => {
    const f = { id_ot: otActual, m_control: mc, lista, actualizado_en: new Date().toISOString() };
    if (tipo) f.tipo_reposicion = tipo;
    return f;
  });
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await supabaseClient.from("reposicion_equipos").upsert(filas.slice(i, i + 200), { onConflict: "id_ot,m_control" });
    if (error) { alert("No se pudo guardar la lista: " + error.message + "\n(¿Corriste los SQL 87 y 88?)"); return false; }
  }
  return true;
}

async function ponerListaActiva(nombre) {
  const { error } = await supabaseClient.from("ordenes_reposicion").update({ lista_activa: nombre || null }).eq("id_ot", otActual);
  if (error) { alert("No se pudo guardar la lista activa: " + error.message + "\n(¿Corriste el SQL 87?)"); return false; }
  ordenesPorOt[otActual].lista_activa = nombre || null;
  return true;
}

// ---------- Pestañas (solo manager): Equipos / Listas / Añadir piezas ----------
function mostrarPestana(id) {
  ["equipos", "listas", "anadir"].forEach(n => { document.getElementById("tab-" + n).hidden = n !== (esManager ? id : "equipos"); });
  document.querySelectorAll("#orep-tabs button").forEach(b => b.classList.toggle("orep-tab-activa", b.dataset.tab === id));
}
document.querySelectorAll("#orep-tabs button").forEach(b => b.addEventListener("click", () => mostrarPestana(b.dataset.tab)));

// Entrega directa de una reposición de solo batería
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-bat-entregada");
  if (!btn) return;
  const mc = btn.dataset.mc;
  const grupo = agruparPorMc(compsOtActual, otActual).find(m => m.mc === mc);
  const comp = grupo && (grupo.casillas.find(x => x.tipo === "Batería") || {}).comp;
  if (!comp) { alert("Este equipo no tiene una batería registrada en la orden. Usa la decisión de la pieza que no llegó."); return; }
  const cambios = { repo_estado: "Entregado", repo_fecha_entrega: hoy() };
  if ((comp.destino || "").includes("Devolver al cliente")) { cambios.devuelto = true; cambios.devuelto_en = new Date().toISOString(); }
  if (await guardarComp(comp.id, cambios, false)) { await recargarOt(); cargarOts(); }
});

// ---------- Batería OK reutilizable ----------
async function guardarBok(mc, cont) {
  const chk = cont.querySelector(".chk-bok");
  const dest = ((cont.querySelector(".inp-bok-dest") || {}).value || "").toUpperCase().match(/MC\d+/);
  const destino = chk.checked && dest ? dest[0] : null;
  const { error } = await supabaseClient.from("reposicion_equipos").upsert({
    id_ot: otActual, m_control: mc, bateria_ok: chk.checked, bateria_ok_destino: destino, actualizado_en: new Date().toISOString()
  }, { onConflict: "id_ot,m_control" });
  if (error) { alert("No se pudo guardar: " + error.message + "\n(¿Corriste el SQL 89?)"); return; }
  equiposCompletos[mc] = Object.assign({}, equiposCompletos[mc], { id_ot: otActual, m_control: mc, bateria_ok: chk.checked, bateria_ok_destino: destino });
  await cargarSerialesBok();
  renderDetalle();
}
document.addEventListener("change", e => {
  const el = e.target.closest && e.target.closest(".chk-bok, .inp-bok-dest");
  if (!el) return;
  const cont = el.closest("tr, .orep-mc-sub");
  if (cont) guardarBok(el.dataset.mc, cont);
});

// Serial de la batería OK de cada equipo marcado (puede estar en otra OT: solo se lee, no se mueve)
let bokSerial = {};
async function cargarSerialesBok() {
  bokSerial = {};
  const mcs = Object.values(equiposCompletos).filter(e => e.bateria_ok).map(e => e.m_control);
  for (let i = 0; i < mcs.length; i += 100) {
    const { data } = await supabaseClient.from("componentes_retirados")
      .select("m_control, tipo_componente, serial_retirado, repo_estado, destino, devuelto").in("m_control", mcs.slice(i, i + 100));
    (data || []).filter(c => /bater/i.test(c.tipo_componente || "") && c.serial_retirado).forEach(c => {
      if (!bokSerial[c.m_control] || c.repo_estado !== "Entregado") bokSerial[c.m_control] = c.serial_retirado;
    });
  }
}
const serialBok = mc => { const b = bateriaDe(mc); return (b && b.serial_retirado) || bokSerial[mc] || ""; };

// Tabla de baterías OK reutilizables (pestaña Listas)
function renderBok() {
  const tb = document.getElementById("tbody-bok");
  if (!tb) return;
  const owners = Object.values(equiposCompletos).filter(e => e.bateria_ok).sort((a, b) => a.m_control.localeCompare(b.m_control));
  // Posibles destinos: equipos de la orden que llevan batería por reponer
  const posibles = agruparPorMc(compsOtActual, otActual).filter(m => tipoRep(m.mc) !== "Batería").map(m => m.mc).sort();
  document.getElementById("bok-destinos").innerHTML = posibles.map(m => `<option value="${esc(m)}">`).join("");
  tb.innerHTML = owners.length ? owners.map(e => `<tr data-mc="${esc(e.m_control)}">
      <td><input type="checkbox" class="chk-bok" data-mc="${esc(e.m_control)}" checked title="Quitar la marca"></td>
      <td>${esc(e.m_control)}</td>
      <td>${esc(serialBok(e.m_control) || "—")}</td>
      <td><input type="text" class="inp-bok-dest" data-mc="${esc(e.m_control)}" list="bok-destinos" placeholder="MC al que va" value="${esc(e.bateria_ok_destino || "")}" style="width:150px;"></td>
      <td>${e.bateria_ok_destino ? "✅ asignada" : '<span class="orep-badge orep-proc">Sin destino</span>'}</td></tr>`).join("")
    : '<tr><td colspan="5">Aún no hay baterías OK marcadas. Pega abajo los MC de los equipos cuya batería está OK.</td></tr>';
}

// Usar la batería OK de otro equipo como serial a entregar de este
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-usar-bok");
  if (!btn) return;
  const grupo = agruparPorMc(compsOtActual, otActual).find(m => m.mc === btn.dataset.mc);
  const comp = grupo && (grupo.casillas.find(x => x.tipo === "Batería") || {}).comp;
  if (!comp) { alert("Este equipo no tiene la batería registrada en la orden."); return; }
  const cambios = { repo_serial_nuevo: btn.dataset.serial, repo_categoria: 2 };
  if (await guardarComp(comp.id, cambios, true)) cargarOts();
});

// Entrega directa de una batería sin MC
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-bat-entregada-id");
  if (!btn) return;
  const comp = compsOtActual.find(c => String(c.id) === String(btn.dataset.id));
  if (!comp) return;
  const cambios = { repo_estado: "Entregado", repo_fecha_entrega: hoy() };
  if ((comp.destino || "").includes("Devolver al cliente")) { cambios.devuelto = true; cambios.devuelto_en = new Date().toISOString(); }
  if (await guardarComp(comp.id, cambios, true)) cargarOts();
});

// Marcar varios equipos como "batería OK reutilizable" pegando MC
document.getElementById("lista-bok-aplicar").addEventListener("click", async () => {
  const msg = document.getElementById("lista-msg");
  const mcs = [...new Set(document.getElementById("lista-bok").value.toUpperCase().match(/MC\d+/g) || [])];
  if (!mcs.length) { msg.textContent = "⚠️ Pega los MC cuya batería está OK."; return; }
  const filas = mcs.map(mc => ({ id_ot: otActual, m_control: mc, bateria_ok: true, actualizado_en: new Date().toISOString() }));
  const { error } = await supabaseClient.from("reposicion_equipos").upsert(filas, { onConflict: "id_ot,m_control" });
  if (error) { msg.textContent = "❌ " + error.message + " (¿SQL 89?)"; return; }
  msg.textContent = `✅ ${mcs.length} equipos marcados con batería OK reutilizable. Indica abajo, en la tabla, el MC al que va cada una.`;
  document.getElementById("lista-bok").value = "";
  await recargarOt();
});

// =========================================================================
// PESTAÑA "LISTAS": cada lista es una fila; al pulsarla se despliega su contenido
// =========================================================================
let listaAbierta = null;

function nombresDeListas() {
  const n = new Set();
  Object.values(equiposCompletos).forEach(e => { if (e.lista) n.add(e.lista); });
  compsOtActual.forEach(c => { if (!c.m_control && c.repo_lista) n.add(c.repo_lista); });
  return [...n].sort();
}

function renderListas() {
  const tb = document.getElementById("tbody-listas");
  if (!tb) return;
  const grupos = agruparPorMc(compsOtActual, otActual);
  grupos.forEach(aplicarTipoBateria);
  const activa = (ordenesPorOt[otActual] || {}).lista_activa || "";
  const nombres = nombresDeListas();
  if (!nombres.length) { tb.innerHTML = '<tr><td colspan="7">Aún no hay listas en esta orden. Crea la primera con "➕ Nueva lista".</td></tr>'; return; }
  const estS = c => { const e = estadoCasilla(c); return e === "Entregado" ? "Entregado" : RESUELTOS.has(e) ? "Listo para entregar" : "En proceso"; };
  tb.innerHTML = nombres.map(nombre => {
    const eq = grupos.filter(m => (equiposCompletos[m.mc] || {}).lista === nombre);
    const sinMc = compsOtActual.filter(c => !c.m_control && c.repo_lista === nombre);
    const nEq = eq.filter(m => tipoRep(m.mc) !== "Batería").length;
    const nBat = eq.filter(m => tipoRep(m.mc) === "Batería").length + sinMc.length;
    const listos = eq.filter(m => m.estadoMc === "Listo para entregar").length + sinMc.filter(c => estS(c) === "Listo para entregar").length;
    const entregados = eq.filter(m => m.estadoMc === "Entregado").length + sinMc.filter(c => estS(c) === "Entregado").length;
    const total = eq.length + sinMc.length;
    const fila = `<tr class="orep-fila ${listaAbierta === nombre ? "orep-activa" : ""}" data-lista="${esc(nombre)}">
      <td><strong>📋 ${esc(nombre)}</strong>${nombre === activa ? ' <span class="orep-badge orep-ok">★ activa</span>' : ""}</td>
      <td>${nEq}</td><td>${nBat}</td><td>${listos}</td><td>${entregados}</td>
      <td>${total ? Math.round(entregados * 100 / total) : 0}% entregado</td><td>${listaAbierta === nombre ? "▲" : "▼"}</td></tr>`;
    if (listaAbierta !== nombre) return fila;

    const items = eq.sort((a, b) => (fechasEntrega[a.mc] || "9999").localeCompare(fechasEntrega[b.mc] || "9999") || a.mc.localeCompare(b.mc)).map(m => {
      const e = equiposCompletos[m.mc] || {};
      const f = fechasEntrega[m.mc];
      return `<tr><td><input type="checkbox" class="chk-item" data-mc="${esc(m.mc)}"></td><td>${esc(m.mc)}</td>
        <td>${tipoRep(m.mc) === "Batería" ? "🔋 Batería" : "📦 Equipo"}${e.bateria_ok ? " · 🔁 batería OK" : ""}</td>
        <td><span class="orep-badge ${claseMc(m.estadoMc)}">${esc(m.estadoMc)}</span></td>
        <td>${f ? new Date(f + "T00:00:00").toLocaleDateString("es-ES") : "—"}</td></tr>`;
    }).join("") + sinMc.map(c => `<tr><td><input type="checkbox" class="chk-item" data-id="${c.id}"></td><td>Sin MC · ${esc(c.serial_retirado || "—")}</td>
        <td>🔋 Batería</td><td><span class="orep-badge ${claseEstado(estadoCasilla(c))}">${esc(estadoCasilla(c))}</span></td><td>—</td></tr>`).join("");

    return fila + `<tr class="orep-detalle-fila" data-detalle="${esc(nombre)}"><td colspan="7">
      <div class="materiales-controles">
        ${nombre === activa
          ? '<button type="button" data-act="desactivar">Quitar como lista activa</button>'
          : '<button type="button" data-act="activa" class="btn-primario">★ Dejar como lista activa (la que ve el operario)</button>'}
        <button type="button" data-act="eliminar" style="color:#a3261c;">🗑 Eliminar la lista</button>
      </div>
      <div style="max-height:320px;overflow:auto;border:1px solid #e8eee9;border-radius:8px;margin:8px 0;">
        <table class="tabla-revision"><thead><tr><th></th><th>Equipo</th><th>Tipo</th><th>Estado</th><th>Entrega</th></tr></thead>
        <tbody>${items || '<tr><td colspan="5">La lista está vacía.</td></tr>'}</tbody></table></div>
      <div class="materiales-controles">
        <span>Con los marcados:</span>
        <button type="button" data-act="quitar">Quitar de la lista</button>
        <select class="sel-pasar-tipo"><option value="Piezas">Pasar a: equipos / piezas</option><option value="Batería">Pasar a: solo batería</option></select>
        <button type="button" data-act="tipo">Aplicar</button>
      </div>
      <p class="ot-meta" style="margin-top:10px;">Añadir a esta lista (pega MC y/o seriales de batería BA…):</p>
      <textarea class="txt-anadir" rows="3" style="width:100%;max-width:520px;" placeholder="MC2500123&#10;BA2500123"></textarea>
      <div class="materiales-controles">
        <select class="sel-anadir-tipo"><option value="Piezas">Son equipos / piezas</option><option value="Batería">Son solo batería</option></select>
        <button type="button" data-act="anadir" class="btn-primario">Añadir a la lista</button>
      </div></td></tr>`;
  }).join("");
}

// Pegar MC y/o seriales BA: los pone en una lista (y trae a la orden las piezas pendientes de otras OT)
async function procesarPegado(nombre, texto, tipo, activar, msg) {
  const tokens = [...new Set(texto.toUpperCase().match(/(MC|BA)\d+/g) || [])];
  const mcs = tokens.filter(t => t.startsWith("MC"));
  const mcsDeBateria = [];   // equipos que entran por el serial de su batería: solo se les cambia la batería
  const serialesBA = tokens.filter(t => t.startsWith("BA"));
  if (!nombre) { msg.textContent = "⚠️ Ponle un nombre a la lista."; return false; }
  if (!tokens.length) { msg.textContent = "⚠️ Pega al menos un MC (MC2500123…) o un serial de batería (BA2500123…)."; return false; }
  msg.textContent = "Procesando...";
  const batSinMc = [], batNoEncontradas = [];
  if (serialesBA.length) {
    const piezasBA = [];
    for (let i = 0; i < serialesBA.length; i += 100) {
      const { data } = await supabaseClient.from("componentes_retirados").select(CAMPOS).in("serial_retirado", serialesBA.slice(i, i + 100));
      (data || []).forEach(c => piezasBA.push(c));
    }
    normalizarMc(piezasBA);
    for (const ba of serialesBA) {
      const c = piezasBA.find(x => x.serial_retirado === ba && !entregadaC(x)) || piezasBA.find(x => x.serial_retirado === ba);
      if (!c) { batNoEncontradas.push(ba); continue; }
      if (c.m_control) { if (!mcs.includes(c.m_control) && !mcsDeBateria.includes(c.m_control)) mcsDeBateria.push(c.m_control); continue; }
      const { error } = await supabaseClient.from("componentes_retirados").update({ orden_reposicion_ot: otActual, repo_lista: nombre }).eq("id", c.id);
      if (error) { msg.textContent = "❌ No se pudo añadir la batería " + ba + ": " + error.message + " (¿SQL 89?)"; return false; }
      batSinMc.push(ba);
    }
  }
  const enOrden = new Set(compsOtActual.map(c => c.m_control));
  const fuera = [...mcs, ...mcsDeBateria].filter(m => !enOrden.has(m));
  const anadidos = [], sinPiezas = [];
  if (fuera.length) {
    const pendientes = [];
    for (let i = 0; i < fuera.length; i += 100) {
      const { data } = await supabaseClient.from("componentes_retirados").select(CAMPOS).in("m_control", fuera.slice(i, i + 100));
      (data || []).forEach(c => pendientes.push(c));
    }
    normalizarMc(pendientes);
    const porMc = {};
    pendientes.filter(c => !entregadaC(c)).forEach(c => { (porMc[c.m_control] = porMc[c.m_control] || []).push(c.id); });
    for (const mc of fuera) {
      if (!porMc[mc]) { sinPiezas.push(mc); continue; }
      const { error } = await supabaseClient.from("componentes_retirados").update({ orden_reposicion_ot: otActual }).in("id", porMc[mc]);
      if (error) { msg.textContent = "❌ No se pudieron añadir piezas de " + mc + ": " + error.message; return false; }
      anadidos.push(mc);
    }
  }
  const listables = mcs.filter(m => !sinPiezas.includes(m));
  const listablesBat = mcsDeBateria.filter(m => !sinPiezas.includes(m));
  if (listables.length && !(await guardarListaEquipos(listables, nombre, tipo))) { msg.textContent = ""; return false; }
  if (listablesBat.length && !(await guardarListaEquipos(listablesBat, nombre, "Batería"))) { msg.textContent = ""; return false; }
  if (activar) await ponerListaActiva(nombre);
  listaSel = nombre; listaAbierta = nombre;
  msg.innerHTML = `✅ Lista "${esc(nombre)}": ${listables.length} equipos` +
    (listablesBat.length ? `, ${listablesBat.length} baterías de equipos con MC como solo batería (${esc(listablesBat.join(", "))})` : "") +
    (batSinMc.length ? `, ${batSinMc.length} baterías sin MC (${esc(batSinMc.join(", "))})` : "") + " añadidos." +
    (anadidos.length ? ` ${anadidos.length} se trajeron desde otras OT.` : "") +
    (sinPiezas.length ? `<br>⚠️ Sin piezas pendientes en la base, no entran: ${esc(sinPiezas.join(", "))}` : "") +
    (batNoEncontradas.length ? `<br>⚠️ Baterías no encontradas: ${esc(batNoEncontradas.join(", "))}` : "");
  await recargarOt(); cargarOts();
  return true;
}

// Nueva lista
document.getElementById("lista-nueva-btn").addEventListener("click", () => {
  const f = document.getElementById("lista-nueva-form");
  f.hidden = !f.hidden;
});
document.getElementById("nl-cancelar").addEventListener("click", () => { document.getElementById("lista-nueva-form").hidden = true; });
document.getElementById("nl-crear").addEventListener("click", async () => {
  if (!otActual) { document.getElementById("lista-msg").textContent = "Abre primero una orden."; return; }
  const ok = await procesarPegado(document.getElementById("nl-nombre").value.trim(), document.getElementById("nl-mcs").value,
    document.getElementById("nl-tipo").value, document.getElementById("nl-activa").checked, document.getElementById("lista-msg"));
  if (ok) { document.getElementById("lista-nueva-form").hidden = true; document.getElementById("nl-mcs").value = ""; }
});

// Filas de listas: desplegar / acciones
document.getElementById("tbody-listas").addEventListener("click", async (e) => {
  const msg = document.getElementById("lista-msg");
  const btn = e.target.closest("button[data-act]");
  const fila = e.target.closest("tr.orep-fila[data-lista]");
  if (!btn) {
    if (fila) { listaAbierta = listaAbierta === fila.dataset.lista ? null : fila.dataset.lista; renderListas(); }
    return;
  }
  const detalle = btn.closest("tr.orep-detalle-fila");
  const nombre = detalle.dataset.detalle;
  const marcados = [...detalle.querySelectorAll(".chk-item:checked")];
  const mcsMarc = marcados.filter(c => c.dataset.mc).map(c => c.dataset.mc);
  const idsMarc = marcados.filter(c => c.dataset.id).map(c => c.dataset.id);
  const act = btn.dataset.act;

  if (act === "activa" || act === "desactivar") {
    if (await ponerListaActiva(act === "activa" ? nombre : "")) {
      msg.textContent = act === "activa" ? `★ "${nombre}" es ahora la lista activa: es la que ve el operario.` : "Sin lista activa: el operario no verá nada por ahora.";
      renderDetalle();
    }
  } else if (act === "eliminar") {
    if (!confirm(`¿Eliminar la lista "${nombre}"? Los equipos y las piezas no se borran, solo dejan de estar en la lista.`)) return;
    const mcs = Object.values(equiposCompletos).filter(x => x.lista === nombre).map(x => x.m_control);
    const ids = compsOtActual.filter(c => !c.m_control && c.repo_lista === nombre).map(c => c.id);
    if (mcs.length && !(await guardarListaEquipos(mcs, null))) return;
    if (ids.length) await supabaseClient.from("componentes_retirados").update({ repo_lista: null }).in("id", ids);
    if (((ordenesPorOt[otActual] || {}).lista_activa || "") === nombre) await ponerListaActiva("");
    listaAbierta = null; if (listaSel === nombre) listaSel = "";
    await recargarOt(); msg.textContent = `Lista "${nombre}" eliminada.`;
  } else if (act === "quitar") {
    if (!mcsMarc.length && !idsMarc.length) { msg.textContent = "⚠️ Marca primero los equipos de la lista."; return; }
    if (mcsMarc.length && !(await guardarListaEquipos(mcsMarc, null))) return;
    if (idsMarc.length) await supabaseClient.from("componentes_retirados").update({ repo_lista: null }).in("id", idsMarc);
    await recargarOt(); msg.textContent = `✅ ${mcsMarc.length + idsMarc.length} quitados de la lista.`;
  } else if (act === "tipo") {
    if (!mcsMarc.length) { msg.textContent = "⚠️ Marca primero equipos con MC (las baterías sin MC siempre son de batería)."; return; }
    const tipo = detalle.querySelector(".sel-pasar-tipo").value;
    const filas = mcsMarc.map(mc => ({ id_ot: otActual, m_control: mc, tipo_reposicion: tipo, actualizado_en: new Date().toISOString() }));
    const { error } = await supabaseClient.from("reposicion_equipos").upsert(filas, { onConflict: "id_ot,m_control" });
    if (error) { alert("No se pudo guardar: " + error.message + "\n(¿SQL 88?)"); return; }
    await recargarOt(); msg.textContent = `✅ ${mcsMarc.length} equipos pasados a "${tipo === "Batería" ? "solo batería" : "equipos / piezas"}".`;
  } else if (act === "anadir") {
    await procesarPegado(nombre, detalle.querySelector(".txt-anadir").value, detalle.querySelector(".sel-anadir-tipo").value, false, msg);
  }
});
