// =========================================================================
// GESTIÓN DE EQUIPOS
// Filtra por cliente los equipos con al menos una alarma activa (o batería
// crítica: las 3 lecturas más recientes por debajo de 6.4V), y genera una
// OT nueva con un ticket en historial_fallas por cada falla detectada —
// igual que hacía "procesarYResaltarFallas" + "generarOrdenTrabajoOficial"
// + "guardarOrdenEnHistorialBD" en Sheets.
// =========================================================================

// Mapa columna booleana en "equipos" -> nombre de Falla legible
// "No comunica" se quitó a propósito — todavía no tienen un criterio
// confiable para esa alarma (según indicó el equipo el 26/08/2026).
const MAPA_ALARMAS = {
  alarma_error_servo: "Error servo",
  alarma_vuelco: "Vuelco",
  alarma_incendio: "Incendio",
  alarma_bloqueado: "Bloqueado",
  alarma_sin_bateria: "Sin batería",
  alarma_tapa_abierta: "Tapa abierta",
  alarma_cambiar_bateria: "Batería Crítica",
  alarma_cambiar_ubicacion: "Cambiar ubicación",
  alarma_revisar_comunicacion: "Revisar comunicación",
  alarma_operacion_erratica: "Operación errática"
};

// Texto de acción por defecto según la falla, para que el operario tenga
// una idea de qué hacer antes de llegar — se sobreescribe cuando reporta
// de verdad en el mapa.
function obtenerAccionPorDefecto(falla) {
  const f = falla.toLowerCase();
  if (f.includes("comunica")) return "Pasar tarjeta RESET. Si no comunica, desconectar y reconectar batería.";
  if (f.includes("servo")) return "Revisar cierre. Evaluar cambio de CIERRE si persiste.";
  if (f.includes("vuelco") || f.includes("incendio")) return "⚠️ Tomar fotos obligatorio. Evaluar cambio de equipo por daños.";
  if (f.includes("bater")) return "Revisar batería. Probar con recargable o evaluar cambio.";
  if (f.includes("bloquead")) return "Revisar mecanismo de cerradura, forzar apertura manual si es necesario.";
  if (f.includes("tapa")) return "Revisar y ajustar tapa/sensor de apertura.";
  if (f.includes("ubicac")) return "Verificar y corregir la ubicación registrada del equipo.";
  if (f.includes("erratic")) return "Inspeccionar sensores y comportamiento del equipo.";
  if (f.includes("añadido") || f.includes("revisión general")) return "Revisión general del equipo.";
  return "Inspeccionar físicamente por la falla reportada.";
}

// Trae TODAS las filas de una consulta, sin toparse con el límite de 1000
// filas por página que aplica Supabase por defecto. Se usa en cualquier
// consulta a "equipos" que pueda devolver más de eso (ya pasamos los 5000).
async function traerTodasLasFilas(tabla, columnas, aplicarFiltro) {
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todas = [];
  while (true) {
    let query = supabaseClient.from(tabla).select(columnas).range(desde, desde + TAM_PAGINA - 1);
    if (aplicarFiltro) query = aplicarFiltro(query);
    const { data, error } = await query;
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  return todas;
}

let repNuevaPorMC = {};   // {mc: {numero, id_ot}} — MC con piezas aún sin entregar en una orden REP-002 en adelante
let equiposOcultos = [];  // [{eq, motivo}] equipos que no entran en la lista por estar en una reposición
let ocultosPorReposicion = 0;
// Tipo de batería instalada, según el modelo guardado en "equipos" (BA01 / BA02 / BA03)
function etiquetaBateria(eq) {
  const modelo = String(eq.modelo_bateria || "").trim().toUpperCase();
  const serial = String(eq.serie_bateria || "").trim();
  let tipo = "";
  if (modelo.startsWith("BA02")) tipo = "Recargable";
  else if (modelo.startsWith("BA01")) tipo = "No recargable";
  else if (modelo.startsWith("BA03")) tipo = "PKCELL";
  else if (modelo) tipo = modelo;
  if (!tipo && !serial) return '<span style="color:#999;">Sin dato</span>';
  const clase = tipo === "Recargable" ? "orep-ok" : tipo === "No recargable" ? "orep-proc" : "orep-gris";
  return `<strong>🔋 ${tipo || "Sin clasificar"}</strong>` + (serial ? `<br><small>${serial}</small>` : "");
}
let equiposEncontrados = []; // [{m_control, fraccion, cliente, fallas: [...]}]
let notasPorMC = {}; // {mc: [nota1, nota2, ...]}
let reposicionPorMC = {}; // {mc: {...fila de equipos_reposicion + número de orden}}
let presupuestoPorMC = {}; // {mc: [{numero, oferta, estado, aprobada, tipo}]} órdenes de presupuesto (vandalismo) aún sin reponer
let contenedorInfo = { contenedorDe: {}, miembros: {} }; // identidad fija del contenedor (contenedores-core.js)
let vecinosPorMC = {};   // {mc: [{mc, metros, ultima}]} otros equipos a menos de DIST_VECINO_M con visitas previas
let todosEquiposCliente = []; // filas de "equipos" del filtro actual (para buscar equipos cercanos)
const DIST_VECINO_M = 25;
let historialPorMC = {}; // {mc: [{falla, accion_calle, comentarios, fecha, id_ot}, ...]} últimas 3

const clienteSelect = document.getElementById("cliente-select");
const filtrarBtn = document.getElementById("filtrar-btn");
const filtrarMsg = document.getElementById("filtrar-msg");
const resultadoFiltro = document.getElementById("resultado-filtro");
const tbody = document.getElementById("equipos-tbody");
const totalEncontrados = document.getElementById("total-encontrados");
const checkTodos = document.getElementById("check-todos");
const generarBtn = document.getElementById("generar-btn");
const generarMsg = document.getElementById("generar-msg");

cargarClientes();

async function cargarClientes() {
  let data;
  try {
    data = await traerTodasLasFilas("equipos", "cliente", (q) => q.order("m_control"));
  } catch (err) {
    clienteSelect.innerHTML = `<option value="">Error al cargar</option>`;
    return;
  }
  const clientesUnicos = [...new Set(data.map(e => e.cliente).filter(Boolean))].sort();
  clienteSelect.innerHTML =
    `<option value="">— Selecciona un cliente —</option>` +
    `<option value="TODOS">TODOS</option>` +
    clientesUnicos.map(c => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join("");
}

filtrarBtn.addEventListener("click", async () => {
  const cliente = clienteSelect.value;
  filtrarMsg.hidden = true;
  resultadoFiltro.hidden = true;

  if (!cliente) {
    mostrarMensaje(filtrarMsg, "⚠️ Selecciona un cliente.", true);
    return;
  }

  const incluirInstalado = document.getElementById("estado-instalado").checked;
  const incluirPendiente = document.getElementById("estado-pendiente").checked;

  if (!incluirInstalado && !incluirPendiente) {
    mostrarMensaje(filtrarMsg, "⚠️ Elige al menos un estado de montaje (Instalado y/o Pendiente).", true);
    return;
  }

  filtrarBtn.disabled = true;
  filtrarBtn.textContent = "Filtrando...";

  let data;
  try {
    data = await traerTodasLasFilas("equipos", "*", (q) => (cliente !== "TODOS" ? q.eq("cliente", cliente) : q).order("m_control"));
  } catch (err) {
    filtrarBtn.disabled = false;
    filtrarBtn.textContent = "Filtrar equipos con fallas";
    mostrarMensaje(filtrarMsg, "❌ " + err.message, true);
    return;
  }

  filtrarBtn.disabled = false;
  filtrarBtn.textContent = "Filtrar equipos con fallas";

  equiposEncontrados = (data || [])
    .filter(eq => {
      const estado = String(eq.estado_montaje || "").toLowerCase();
      const esInstalado = estado.includes("instala");
      const esPendiente = estado.includes("pendien");
      return (esInstalado && incluirInstalado) || (esPendiente && incluirPendiente);
    })
    .map(eq => {
      const fallas = Object.keys(MAPA_ALARMAS).filter(col => eq[col]).map(col => MAPA_ALARMAS[col]);
      return { m_control: eq.m_control, fraccion: eq.fraccion, cliente: eq.cliente, estado_montaje: eq.estado_montaje, modelo_bateria: eq.modelo_bateria, serie_bateria: eq.serie_bateria, latitud: eq.latitud, longitud: eq.longitud, fallas };
    })
    .filter(eq => eq.fallas.length > 0);

  if (equiposEncontrados.length === 0) {
    mostrarMensaje(filtrarMsg, "No se encontraron equipos con fallas para ese cliente.", false);
    return;
  }

  // Traemos las notas ACTIVAS de estos equipos, para avisar antes de
  // incluirlos en la OT nueva (ej. "no visitar", "ya se le hizo tal cosa")
  const mcsEncontrados = equiposEncontrados.map(e => e.m_control);
  const { data: notas } = await supabaseClient
    .from("notas_equipo")
    .select("mc, nota, foto_url")
    .in("mc", mcsEncontrados)
    .eq("activa", true);

  notasPorMC = {};
  (notas || []).forEach(n => {
    if (!notasPorMC[n.mc]) notasPorMC[n.mc] = [];
    notasPorMC[n.mc].push(n);
  });

  // Historial de OT anteriores — por contenedor (incluye los MC que tuvo antes) y equipos cercanos
  todosEquiposCliente = data || [];
  await recalcularHistorialContenedores();

  // Reposiciones (REP-001 y siguientes): para que se vea en la lista que el
  // equipo salió en una reposición y su falla de comunicación es porque aún
  // no ha llegado al cliente. Si falla la consulta, la lista sigue igual.
  reposicionPorMC = {};
  try {
    const { data: reps, error: errReps } = await supabaseClient
      .from("equipos_reposicion")
      .select("mc, tipo_registro, estado, fecha_reposicion, motivo, ordenes_reposicion(numero)")
      .in("mc", mcsEncontrados);
    if (errReps) throw errReps;
    (reps || []).forEach(r => { reposicionPorMC[r.mc] = r; });
  } catch (err) {
    console.error("No se pudieron cargar las reposiciones:", err);
  }

  // Órdenes de reposición nuevas (REP-002 en adelante, por OT manual): un
  // equipo cuenta como "en reposición" si tiene piezas en una OT con orden y
  // alguna aún no se ha entregado al cliente.
  repNuevaPorMC = {};
  try {
    const { data: ordenes, error: errOrd } = await supabaseClient
      .from("ordenes_reposicion").select("numero, id_ot").not("id_ot", "is", null);
    if (errOrd) throw errOrd;
    const numeroPorOt = {};
    (ordenes || []).forEach(o => { numeroPorOt[o.id_ot] = o.numero; });

    if (Object.keys(numeroPorOt).length > 0) {
      const comps = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await supabaseClient
          .from("componentes_retirados")
          .select("m_control, id_ot, orden_reposicion_ot, destino, devuelto, repo_estado, tipo_componente")
          .in("m_control", mcsEncontrados)
          .order("id").range(desde, desde + 999);
        if (error) throw error;
        comps.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const entregado = c => c.repo_estado
        ? c.repo_estado === "Entregado"
        : ((c.destino || "").includes("Devolver al cliente") && !!c.devuelto);
      comps.forEach(c => {
        const ot = c.orden_reposicion_ot || c.id_ot;
        if (numeroPorOt[ot] === undefined || entregado(c)) return;
        const r = repNuevaPorMC[c.m_control] || (repNuevaPorMC[c.m_control] = { numero: numeroPorOt[ot], id_ot: ot, tipos: new Set(), tieneMC: false, estadoMC: "" });
        const tipo = c.tipo_componente || "pieza";
        r.tipos.add(tipo);
        if (/m[oó]dulo/i.test(tipo)) { r.tieneMC = true; r.estadoMC = (c.repo_estado || c.destino || "sin destino").replace(/^[^A-Za-zÁÉÍÓÚáéíóúñÑ]+/, "").trim(); }
      });
    }
  } catch (err) {
    console.error("No se pudieron cargar las órdenes de reposición nuevas:", err);
  }

  // Órdenes de presupuesto (vandalismo): qué piezas tiene cada equipo en
  // una oferta aún sin reponer. Las aprobadas por el cliente se llevan en la OT.
  presupuestoPorMC = {};
  try {
    const { data: lins, error: errPre } = await supabaseClient
      .from("presupuesto_lineas")
      .select("m_control, tipo_componente, aprobada, ordenes_presupuesto(numero, numero_oferta, estado)")
      .order("id");
    if (errPre) throw errPre;
    (lins || []).forEach(l => {
      const o = l.ordenes_presupuesto;
      if (!o || o.estado === "Equipos repuestos") return;
      (presupuestoPorMC[l.m_control] = presupuestoPorMC[l.m_control] || []).push(
        { numero: o.numero, oferta: o.numero_oferta, estado: o.estado, aprobada: l.aprobada, tipo: l.tipo_componente });
    });
  } catch (err) {
    console.error("No se pudieron cargar las órdenes de presupuesto:", err);
  }

  // Si está marcado, los equipos que están en una reposición (REPONER) no
  // entran en la lista, para no meterlos por error en la OT.
  ocultosPorReposicion = 0;
  equiposOcultos = [];
  if (document.getElementById("ocultar-reposicion")?.checked) {
    const visibles = [];
    equiposEncontrados.forEach(eq => {
      const rp = reposicionPorMC[eq.m_control];
      const rn = repNuevaPorMC[eq.m_control];
      if (tienePresupuestoAprobado(eq.m_control)) {
        // El cliente aceptó pagar piezas de este equipo: va en la OT aunque esté en reposición.
        visibles.push(eq);
      } else if (rp && rp.tipo_registro === "REPONER") {
        equiposOcultos.push({ eq, grupo: "REP-" + String((rp.ordenes_reposicion && rp.ordenes_reposicion.numero) || 1).padStart(3, "0"),
          motivo: "En reposición REP-" + String((rp.ordenes_reposicion && rp.ordenes_reposicion.numero) || 1).padStart(3, "0") + " (" + (rp.estado === "Repuesto" ? "repuesto" : "pendiente") + ")" +
            (rn ? " · también tiene piezas en REP-" + String(rn.numero).padStart(3, "0") + " (" + rn.id_ot + ")" : "") });
      } else if (rn && rn.tieneMC) {
        // Tenemos el módulo de control aquí: el equipo está físicamente con nosotros.
        equiposOcultos.push({ eq, grupo: "REP-" + String(rn.numero).padStart(3, "0"), motivo: "En reposición REP-" + String(rn.numero).padStart(3, "0") + " (" + rn.id_ot + "): tenemos aquí " + [...rn.tipos].join(", ") + " · Módulo de Control: " + rn.estadoMC });
      } else {
        // Si solo tenemos algunas piezas (sin el módulo), el equipo sigue en calle: se queda en la lista.
        visibles.push(eq);
      }
    });
    equiposEncontrados = visibles;
    ocultosPorReposicion = equiposOcultos.length;
  }

  renderTabla();
  renderOcultos();
  resultadoFiltro.hidden = false;
});

// Piezas del equipo que el cliente aceptó pagar (orden de presupuesto aprobada, aún sin reponer)
function tienePresupuestoAprobado(mc) {
  return (presupuestoPorMC[mc] || []).some(l => l.estado === "Presupuesto aprobado" && l.aprobada === true);
}

function etiquetaPresupuesto(mc) {
  const ls = presupuestoPorMC[mc];
  if (!ls || !ls.length) return "";
  const porOrden = {};
  ls.forEach(l => { (porOrden[l.numero] = porOrden[l.numero] || []).push(l); });
  return Object.entries(porOrden).map(([num, items]) => {
    const l0 = items[0];
    const cod = "PRE-" + String(num).padStart(3, "0");
    const partes = items.map(l => (l.tipo || "pieza") + (l.aprobada === true ? " ✅" : l.aprobada === false ? " ❌" : " ⏳")).join(", ");
    const aprobado = l0.estado === "Presupuesto aprobado" && items.some(l => l.aprobada === true);
    const color = aprobado ? "#1d6b32" : "#8a5a00";
    return `<div style="font-size:0.78rem; margin-bottom:4px; color:${color}; font-weight:600;">💰 ${cod}${l0.oferta ? " (oferta " + l0.oferta + ")" : ""} — ${l0.estado}: ${partes}${aprobado ? " → llevar en la OT" : ""}</div>`;
  }).join("");
}

function renderOcultos() {
  const bloque = document.getElementById("bloque-ocultos");
  const tb = document.getElementById("ocultos-tbody");
  if (equiposOcultos.length === 0) { bloque.hidden = true; return; }
  bloque.hidden = false;
  document.getElementById("ocultos-resumen").textContent = `Ver los ${equiposOcultos.length} equipos ocultos por estar en reposición (` +
    Object.entries(equiposOcultos.reduce((a, o) => { a[o.grupo] = (a[o.grupo] || 0) + 1; return a; }, {}))
      .sort().map(([g, n]) => `${g}: ${n}`).join(" · ") + ")";
  tb.innerHTML = equiposOcultos.map(o => `
    <tr>
      <td>${o.eq.m_control}</td>
      <td>${o.eq.fallas.join(", ")}</td>
      <td>${o.motivo}</td>
      <td><button type="button" class="btn-primario btn-compacto btn-incluir-oculto" data-mc="${o.eq.m_control}">Incluir en la OT</button></td>
    </tr>`).join("");
}

document.getElementById("ocultos-tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-incluir-oculto");
  if (!btn) return;
  const i = equiposOcultos.findIndex(o => o.eq.m_control === btn.dataset.mc);
  if (i < 0) return;
  const [quitado] = equiposOcultos.splice(i, 1);
  equiposEncontrados.push(quitado.eq);
  equiposEncontrados.sort((a, b) => a.m_control.localeCompare(b.m_control));
  ocultosPorReposicion = equiposOcultos.length;
  renderTabla();
  renderOcultos();
});

const normFr = f => String(f || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

// Historial por contenedor (MC actuales y anteriores) + aviso de equipos cercanos con visitas
async function recalcularHistorialContenedores() {
  const mcs = equiposEncontrados.map(e => e.m_control);
  contenedorInfo = await resolverContenedores(supabaseClient, mcs);
  const miembrosTodos = [...new Set(Object.values(contenedorInfo.miembros).flat())];
  const visitas = await visitasPorMc(supabaseClient, miembrosTodos);

  historialPorMC = {};
  mcs.forEach(mc => {
    const ms = contenedorInfo.miembros[contenedorInfo.contenedorDe[mc]] || [mc];
    historialPorMC[mc] = ms.flatMap(m => visitas[m] || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 3);
  });

  // Respaldo por ubicación: otros equipos a pocos metros que ya tengan visitas y no sean del mismo contenedor
  vecinosPorMC = {};
  const conCoords = todosEquiposCliente.filter(e => isFinite(parseFloat(e.latitud)) && isFinite(parseFloat(e.longitud)));
  const candidatos = {};
  equiposEncontrados.forEach(eq => {
    const lat = parseFloat(eq.latitud), lon = parseFloat(eq.longitud);
    if (!isFinite(lat) || !isFinite(lon)) return;
    const propios = new Set(contenedorInfo.miembros[contenedorInfo.contenedorDe[eq.m_control]] || [eq.m_control]);
    const cercanos = conCoords
      .filter(o => o.m_control !== eq.m_control && !propios.has(o.m_control) && (!eq.cliente || o.cliente === eq.cliente))
      .map(o => ({ mc: o.m_control, fraccion: o.fraccion, estado: o.estado_montaje, instalado: o.fecha_instalacion, metros: distanciaMetros(lat, lon, parseFloat(o.latitud), parseFloat(o.longitud)) }))
      .filter(o => o.metros <= DIST_VECINO_M)
      .sort((a, b) => a.metros - b.metros)
      .slice(0, 10);
    if (cercanos.length) candidatos[eq.m_control] = cercanos;
  });
  const mcsVecinos = [...new Set(Object.values(candidatos).flat().map(v => v.mc))];
  if (mcsVecinos.length) {
    const contVecinos = await resolverContenedores(supabaseClient, mcsVecinos);
    const todosMiembrosV = [...new Set(Object.values(contVecinos.miembros).flat())];
    const visitasV = await visitasPorMc(supabaseClient, todosMiembrosV);
    Object.keys(candidatos).forEach(mc => {
      const lista = [];
      candidatos[mc].forEach(v => {
        const ms = contVecinos.miembros[contVecinos.contenedorDe[v.mc]] || [v.mc];
        const ult = ms.flatMap(m => visitasV[m] || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
        lista.push({ mc: v.mc, metros: Math.round(v.metros), fraccion: v.fraccion, estado: v.estado, instalado: v.instalado, ultima: ult || null });
      });
      if (lista.length) vecinosPorMC[mc] = lista;
    });
  }
}

function renderTabla() {
  totalEncontrados.textContent = `${equiposEncontrados.length} equipos encontrados` +
    (ocultosPorReposicion > 0 ? ` (${ocultosPorReposicion} ocultos por estar en reposición)` : "");
  tbody.innerHTML = equiposEncontrados.map((eq, idx) => {
    const notas = notasPorMC[eq.m_control];
    const celdaNota = notas && notas.length > 0
      ? notas.map(n => `<div style="color:#c0392b; font-weight:600;">⚠️ ${n.nota}${n.foto_url ? ` <a href="${n.foto_url}" target="_blank" rel="noopener">📷</a>` : ""}</div>`).join("")
      : "—";

    const historial = historialPorMC[eq.m_control];
    const rp = reposicionPorMC[eq.m_control];
    let etiquetaRepo = "";
    if (rp) {
      const numRep = "REP-" + String((rp.ordenes_reposicion && rp.ordenes_reposicion.numero) || 1).padStart(3, "0");
      let detalle;
      if (rp.tipo_registro === "NO REPONER") detalle = "no se repone" + (rp.motivo ? " (" + rp.motivo + ")" : "");
      else if (rp.estado === "Repuesto") detalle = "repuesto" + (rp.fecha_reposicion ? " el " + new Date(rp.fecha_reposicion).toLocaleDateString("es-ES") : "");
      else detalle = "pendiente de reponer";
      etiquetaRepo = `<div style="font-size:0.78rem; margin-bottom:4px; color:#1f4e8c; font-weight:600;">🔁 En reposición ${numRep}: ${detalle}</div>`;
    }

    const rn = repNuevaPorMC[eq.m_control];
    if (rn) {
      etiquetaRepo += `<div style="font-size:0.78rem; margin-bottom:4px; color:#1f4e8c; font-weight:600;">🔁 En reposición REP-${String(rn.numero).padStart(3, "0")} (${rn.id_ot}): con piezas aún sin entregar al cliente${rn.tieneMC ? "" : " — aquí solo tenemos: " + [...rn.tipos].join(", ") + " (el equipo sigue en calle)"}</div>`;
    }

    etiquetaRepo += etiquetaPresupuesto(eq.m_control);

    // Aviso de contenedor: visita reciente (también con MC anteriores) y equipos cercanos
    let avisoCont = "";
    const ms = contenedorInfo.miembros[contenedorInfo.contenedorDe[eq.m_control]] || [eq.m_control];
    if (ms.length > 1) {
      avisoCont += `<div style="font-size:0.78rem; margin-bottom:4px; color:#555;">🔗 Mismo contenedor que: ${ms.filter(m => m !== eq.m_control).join(", ")}</div>`;
    }
    if (historial && historial.length > 0) {
      const dias = diasDesde(historial[0].fecha);
      if (dias <= DIAS_AVISO_VISITA_RECIENTE) {
        const otroMc = historial[0].m_control !== eq.m_control ? ` (con el MC anterior ${historial[0].m_control})` : "";
        avisoCont += `<div style="font-size:0.8rem; margin-bottom:4px; color:#b35c00; font-weight:700;">⚠️ Contenedor visitado hace ${dias} día(s)${otroMc} — <a href="ot-detalle.html?ot=${historial[0].id_ot}">${historial[0].id_ot}</a></div>`;
      }
    }
    // Varios contenedores pueden estar juntos (uno por fracción): los de la MISMA fracción son candidatos
    // a ser el mismo contenedor; los de otra fracción se muestran apagados, como "probablemente otro".
    const vecinos = (vecinosPorMC[eq.m_control] || []).map(v => ({ ...v, mismaFr: !!eq.fraccion && normFr(v.fraccion) === normFr(eq.fraccion) }))
      .sort((x, y) => (y.mismaFr - x.mismaFr) || (x.metros - y.metros));
    // Solo se destacan los de la misma fracción que YA tienen visitas (máx. 3). El resto (sin visitas, o de
    // otra fracción) va plegado: en campas o naves hay muchos equipos juntos y la ubicación no distingue.
    const fmtVecino = v => {
      const datos = [v.fraccion, v.estado, v.instalado ? "instalado " + new Date(v.instalado).toLocaleDateString("es-ES") : ""].filter(Boolean).join(", ");
      const visita = v.ultima
        ? `última visita ${new Date(v.ultima.fecha).toLocaleDateString("es-ES")} (<a href="ot-detalle.html?ot=${v.ultima.id_ot}">${v.ultima.id_ot}</a>)`
        : "sin visitas registradas";
      const boton = v.mismaFr ? ` <button type="button" class="btn-mismo-contenedor btn-secundario btn-compacto" data-actual="${eq.m_control}" data-vecino="${v.mc}">Es el mismo contenedor</button>` : "";
      return { datos, visita, boton };
    };
    // Los equipos cercanos van SIEMPRE plegados en un solo desplegable: lo principal es la info del propio contenedor.
    if (vecinos.length) {
      const nMismaFr = vecinos.filter(v => v.mismaFr).length;
      avisoCont += `<details style="font-size:0.76rem; color:#7a4b00; margin-bottom:4px;"><summary style="cursor:pointer; font-weight:600;">📍 Hay ${vecinos.length} equipo(s) cerca (≤ ${DIST_VECINO_M} m)${nMismaFr ? " · " + nMismaFr + " de la misma fracción" : ""}</summary>` +
        vecinos.map(v => {
          const f = fmtVecino(v);
          return `<div style="margin:3px 0 3px 10px; ${v.mismaFr ? "" : "color:#999;"}">A ${v.metros} m: ${v.mc}${f.datos ? " (" + f.datos + ")" : ""} — ${f.visita}${f.boton}</div>`;
        }).join("") + `</details>`;
    }

    const celdaHistorial = etiquetaRepo + avisoCont + (historial && historial.length > 0
      ? historial.map(h => {
          const accion = [h.accion_calle, h.comentarios].filter(Boolean).join(" — ") || "sin acción registrada";
          return `<div style="font-size:0.78rem; margin-bottom:2px;">📅 ${new Date(h.fecha).toLocaleDateString("es-ES")} (<a href="ot-detalle.html?ot=${h.id_ot}">${h.id_ot}</a>)${h.m_control !== eq.m_control ? " · MC anterior " + h.m_control : ""} — ${h.falla}: ${accion}</div>`;
        }).join("")
      : `<span style="color:var(--gris-700); font-size:0.8rem;">Sin historial previo</span>`);

    return `
    <tr class="${notas ? 'fila-alerta' : ''}">
      <td><input type="checkbox" class="check-equipo" data-idx="${idx}" checked></td>
      <td>${eq.m_control}</td>
      <td>${eq.estado_montaje || "—"}</td>
      <td>${eq.fraccion || "—"}</td>
      <td>${etiquetaBateria(eq)}</td>
      <td>${eq.fallas.join(", ")}</td>
      <td>${celdaNota}</td>
      <td>${celdaHistorial}</td>
    </tr>
  `;
  }).join("");
}

checkTodos.addEventListener("change", () => {
  document.querySelectorAll(".check-equipo").forEach(c => { c.checked = checkTodos.checked; });
});

generarBtn.addEventListener("click", async () => {
  const seleccionados = [...document.querySelectorAll(".check-equipo:checked")]
    .map(c => equiposEncontrados[parseInt(c.dataset.idx, 10)]);

  // --- Procesar equipos manuales agregados a mano ---
  const textoManuales = document.getElementById("manuales-textarea").value.trim();
  const mcsManualesTexto = textoManuales
    ? textoManuales.split(/[,\n]/).map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  const mcsYaIncluidos = new Set(seleccionados.map(e => e.m_control));
  const mcsManualesNuevos = mcsManualesTexto.filter(mc => !mcsYaIncluidos.has(mc));

  let equiposManuales = [];
  if (mcsManualesNuevos.length > 0) {
    const { data: datosManuales, error: errorManuales } = await supabaseClient
      .from("equipos")
      .select("m_control, cliente, fraccion, modelo_bateria, serie_bateria")
      .in("m_control", mcsManualesNuevos);

    if (errorManuales) {
      mostrarMensaje(generarMsg, "❌ Error al buscar los equipos manuales: " + errorManuales.message, true);
      return;
    }

    const encontrados = new Set((datosManuales || []).map(e => e.m_control));
    const noEncontrados = mcsManualesNuevos.filter(mc => !encontrados.has(mc));
    if (noEncontrados.length > 0) {
      mostrarMensaje(generarMsg, "⚠️ Estos equipos no existen en la base: " + noEncontrados.join(", ") + " — corrígelos o quítalos e intenta de nuevo.", true);
      return;
    }

    equiposManuales = (datosManuales || []).map(eq => ({
      m_control: eq.m_control, fraccion: eq.fraccion, cliente: eq.cliente, modelo_bateria: eq.modelo_bateria, serie_bateria: eq.serie_bateria,
      fallas: ["Revisión general (añadido manualmente)"]
    }));
  }

  const todosLosEquipos = [...seleccionados, ...equiposManuales];

  if (todosLosEquipos.length === 0) {
    mostrarMensaje(generarMsg, "⚠️ Selecciona al menos un equipo o agrega uno manual.", true);
    return;
  }

  generarBtn.disabled = true;
  generarBtn.textContent = "Generando...";

  const { data: { user } } = await supabaseClient.auth.getUser();

  // --- Calcular el siguiente número de OT disponible ---
  const { data: otsExistentes } = await supabaseClient.from("ordenes_trabajo").select("id_ot");
  let maxNum = 0;
  (otsExistentes || []).forEach(o => {
    const m = String(o.id_ot).match(/OT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const nuevoIdOt = "OT-" + String(maxNum + 1).padStart(3, "0");

  const { error: errorOt } = await supabaseClient
    .from("ordenes_trabajo")
    .insert({
      id_ot: nuevoIdOt, creado_por: user.email,
      // Cliente de la OT: el de sus equipos (si hay varios, se unen) — así sale en el buscador de OTs
      cliente: [...new Set(todosLosEquipos.map(e => e.cliente).filter(Boolean))].join(" / ") || null
    });

  if (errorOt) {
    mostrarMensaje(generarMsg, "❌ Error al crear la OT: " + errorOt.message, true);
    generarBtn.disabled = false;
    generarBtn.textContent = "Generar OT con los equipos seleccionados";
    return;
  }

  // --- Un solo ticket por equipo, combinando todas sus fallas activas ---
  // (antes creaba uno por cada falla — resultaba en tickets duplicados del
  // mismo equipo, con la misma acción repetida varias veces)
  //
  // Antes de crear un ticket nuevo, revisamos si ese equipo YA tiene uno
  // abierto de una visita anterior sin resolver — si es así, lo vinculamos
  // a esta OT nueva en vez de duplicarlo (mismo ticket, dos OT).
  const mcsSeleccionados = todosLosEquipos.map(eq => eq.m_control);
  const { data: ticketsAbiertosExistentes } = await supabaseClient
    .from("historial_fallas")
    .select("id_registro, m_control")
    .in("m_control", mcsSeleccionados)
    .eq("estado", "🚨 ABIERTO");

  const mapaTicketAbiertoPorMC = {};
  (ticketsAbiertosExistentes || []).forEach(t => { mapaTicketAbiertoPorMC[t.m_control] = t.id_registro; });

  const nuevosTickets = [];
  const idsAVincular = [];

  todosLosEquipos.forEach(eq => {
    const ticketYaAbierto = mapaTicketAbiertoPorMC[eq.m_control];
    if (ticketYaAbierto) {
      idsAVincular.push(ticketYaAbierto);
      return; // no se crea uno nuevo, se vincula el que ya existía
    }

    const accionesUnicas = [...new Set(eq.fallas.map(obtenerAccionPorDefecto))];
    nuevosTickets.push({
      id_registro: "TK-" + eq.m_control + "-" + Math.floor(Math.random() * 900 + 100),
      cliente: eq.cliente,
      m_control: eq.m_control,
      falla: eq.fallas.join(", "),
      estado: "🚨 ABIERTO",
      accion_calle: accionesUnicas.join(" / "),
      origen: user.email,
      id_ot: nuevoIdOt
    });
  });

  if (idsAVincular.length > 0) {
    await supabaseClient
      .from("historial_fallas")
      .update({ id_ot_relacionada: nuevoIdOt })
      .in("id_registro", idsAVincular);
  }

  const { error: errorTickets } = nuevosTickets.length > 0
    ? await supabaseClient.from("historial_fallas").insert(nuevosTickets)
    : { error: null };

  generarBtn.disabled = false;
  generarBtn.textContent = "Generar OT con los equipos seleccionados";

  if (errorTickets) {
    mostrarMensaje(generarMsg, "❌ La OT se creó, pero hubo un error al generar los tickets: " + errorTickets.message, true);
    return;
  }

  generarMsg.innerHTML = `✅ ${nuevoIdOt} generada con ${nuevosTickets.length} ticket(s) para ${todosLosEquipos.length} equipo(s) (${equiposManuales.length} manual(es)).<br><a href="ot-detalle.html?ot=${nuevoIdOt}" class="btn-ver-tabla" style="margin-top:10px;display:inline-block;">Ver / editar esta OT →</a>`;
  generarMsg.className = "resultado-msg resultado-ok";
  generarMsg.hidden = false;
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}


// "Es el mismo contenedor": enlaza el MC del equipo con el del vecino (hereda su ID de contenedor)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-mismo-contenedor");
  if (!btn) return;
  const actual = btn.dataset.actual, vecino = btn.dataset.vecino;
  if (!confirm(`¿Confirmas que ${actual} y ${vecino} son el MISMO contenedor?\nA partir de ahora comparten historial.`)) return;
  btn.disabled = true;
  const r = await vincularMcContenedor(supabaseClient, vecino, actual, null, "manual");
  if (!r.ok) { alert("No se pudo enlazar: " + r.error + "\n(¿Corriste el SQL 93?)"); btn.disabled = false; return; }
  await recalcularHistorialContenedores();
  renderTabla();
});
