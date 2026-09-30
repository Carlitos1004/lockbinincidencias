// =========================================================================
// REGISTRO MAESTRO DE EQUIPOS — listado con filtros
// =========================================================================

let registroData = [];

// Clientes internos/de prueba que se excluyen de todos los conteos y
// registros (mismo criterio que Estadísticas Generales y el Registro
// Maestro de Componentes) — la tabla registro_maestro_equipos en la base
// no filtra esto sola, así que se hace aquí al mostrarla.
const CLIENTES_EXCLUIDOS_EXACTOS = ["comercial", "frutos", "interno", "carmen", "municipalia"];
function esClienteExcluido(cliente) {
  const c = (cliente || "").toLowerCase();
  return CLIENTES_EXCLUIDOS_EXACTOS.includes(c) || c.includes("villanueva");
}

cargarRegistro();

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

async function cargarRegistro() {
  try {
    registroData = await traerTodasLasFilas("registro_maestro_equipos", "*", (q) => q.order("actualizado_en", { ascending: false }));
  } catch (err) {
    document.getElementById("tbody-registro").innerHTML = `<tr><td colspan="8">Error: ${err.message}</td></tr>`;
    return;
  }
  registroData = registroData.filter(r => !esClienteExcluido(r.cliente_actual));
  renderResumen();
  llenarFiltroCliente();
  renderTabla();
}

function llenarFiltroCliente() {
  const clientesUnicos = [...new Set(registroData.map(r => r.cliente_actual).filter(Boolean))].sort();
  const select = document.getElementById("filtro-cliente");
  select.innerHTML = `<option value="">Todos los clientes</option>` +
    clientesUnicos.map(c => `<option value="${c}">${c}</option>`).join("");
}

function renderResumen() {
  const instalados = registroData.filter(r => r.instalado).length;
  const reparados = registroData.filter(r => r.ha_sido_reparado).length;
  const mismoImei = registroData.filter(r => (r.mcs_historicos || []).length > 1).length;
  document.getElementById("resumen-registro").innerHTML = `
    <div class="tarjeta-resumen"><strong>${registroData.length}</strong><span>Equipos en el registro</span></div>
    <div class="tarjeta-resumen"><strong>${instalados}</strong><span>Instalados</span></div>
    <div class="tarjeta-resumen"><strong>${reparados}</strong><span>Con reparación alguna vez</span></div>
    <div class="tarjeta-resumen ${mismoImei > 0 ? 'tarjeta-alerta' : ''}"><strong>${mismoImei}</strong><span>Mismo IMEI con más de un MC</span></div>
  `;
}

function renderTabla() {
  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fCliente = document.getElementById("filtro-cliente").value;
  const fInstalado = document.getElementById("filtro-instalado").value;
  const fReparado = document.getElementById("filtro-reparado").value;
  const fMismoImei = document.getElementById("filtro-mismo-imei").value;
  const orden = document.getElementById("orden-registro").value;

  let filtrados = registroData.filter(r =>
    (!fMc || (r.mc_actual || "").toLowerCase().includes(fMc) || (r.imei || "").toLowerCase().includes(fMc)) &&
    (!fCliente || r.cliente_actual === fCliente) &&
    (!fInstalado || (fInstalado === "si") === r.instalado) &&
    (!fReparado || (fReparado === "si") === r.ha_sido_reparado) &&
    (!fMismoImei || (fMismoImei === "si") === ((r.mcs_historicos || []).length > 1))
  );

  const comparadores = {
    cliente: (a, b) => (a.cliente_actual || "").localeCompare(b.cliente_actual || ""),
    mc: (a, b) => (a.mc_actual || "").localeCompare(b.mc_actual || ""),
    incidencias: (a, b) => b.total_incidencias - a.total_incidencias,
    reciente: (a, b) => new Date(b.actualizado_en) - new Date(a.actualizado_en),
  };
  filtrados = filtrados.sort(comparadores[orden] || comparadores.cliente);

  const tbody = document.getElementById("tbody-registro");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">Ningún equipo coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(r => {
    const historicos = r.mcs_historicos || [];
    const tieneVarios = historicos.length > 1;
    // Los demás MC que ha tenido este mismo IMEI, sin repetir el actual —
    // cada uno con su propio enlace a "Ver incidencias" en Buscar por Serial.
    const otros = historicos.filter(mc => mc !== r.mc_actual);
    return `
    <tr class="${!r.instalado ? 'fila-alerta' : ''}">
      <td>${r.mc_actual || "—"}</td>
      <td class="celda-mono">${r.imei || "—"}</td>
      <td>${r.cliente_actual || "—"}</td>
      <td>${r.instalado ? "✅ Instalado" : "❌ No instalado"}</td>
      <td>${tieneVarios
        ? otros.map(mc => `<a href="buscar-serial.html" class="link-mc-historico" data-mc="${mc}">${mc}</a>`).join(", ")
        : "—"
      }</td>
      <td>${r.total_incidencias}</td>
      <td>${r.ha_sido_reparado ? "✅ Sí" : "— No"}</td>
      <td>${r.ultima_incidencia_fecha ? new Date(r.ultima_incidencia_fecha).toLocaleDateString("es-ES") : "—"}</td>
      <td>
        ${r.mc_actual ? `<a href="buscar-serial.html" class="link-ver-incidencias" data-mc="${r.mc_actual}">Ver incidencias →</a>` : "—"}
        ${r.imei ? `<br><a href="vida-equipo.html" class="link-ver-vida" data-imei="${r.imei}">Ver vida →</a>` : ""}
      </td>
    </tr>
  `;
  }).join("");

  // Los 3 enlaces que salen de esta tabla (Ver incidencias / Ver vida / MC
  // histórico) dejan dicho, además del MC o IMEI a buscar, que el botón de
  // "←" de la página destino debe volver aquí — no al lugar de siempre.
  tbody.querySelectorAll(".link-mc-historico, .link-ver-incidencias").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      irConVolverAlRegistro(a.dataset.mc, "buscar-serial.html");
    });
  });
  tbody.querySelectorAll(".link-ver-vida").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      irConVolverAlRegistro(a.dataset.imei, "vida-equipo.html");
    });
  });
}

function irConVolverAlRegistro(valorBusqueda, url) {
  sessionStorage.setItem("lockbin_prellenar_busqueda", valorBusqueda);
  sessionStorage.setItem("lockbin_volver_url", "registro-maestro.html");
  sessionStorage.setItem("lockbin_volver_texto", "Volver al Registro Maestro de Equipos");
  window.location.href = url;
}

["filtro-mc", "filtro-cliente", "filtro-instalado", "filtro-reparado", "filtro-mismo-imei", "orden-registro"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
