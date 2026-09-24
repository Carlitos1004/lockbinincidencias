// =========================================================================
// REGISTRO MAESTRO DE EQUIPOS — listado con filtros
// =========================================================================

let registroData = [];

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
  document.getElementById("resumen-registro").innerHTML = `
    <div class="tarjeta-resumen"><strong>${registroData.length}</strong><span>Equipos en el registro</span></div>
    <div class="tarjeta-resumen"><strong>${instalados}</strong><span>Instalados</span></div>
    <div class="tarjeta-resumen"><strong>${reparados}</strong><span>Con reparación alguna vez</span></div>
  `;
}

function renderTabla() {
  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fCliente = document.getElementById("filtro-cliente").value;
  const fInstalado = document.getElementById("filtro-instalado").value;
  const fReparado = document.getElementById("filtro-reparado").value;
  const orden = document.getElementById("orden-registro").value;

  let filtrados = registroData.filter(r =>
    (!fMc || (r.mc_actual || "").toLowerCase().includes(fMc) || (r.imei || "").toLowerCase().includes(fMc)) &&
    (!fCliente || r.cliente_actual === fCliente) &&
    (!fInstalado || (fInstalado === "si") === r.instalado) &&
    (!fReparado || (fReparado === "si") === r.ha_sido_reparado)
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
    tbody.innerHTML = `<tr><td colspan="8">Ningún equipo coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(r => `
    <tr class="${!r.instalado ? 'fila-alerta' : ''}">
      <td>${r.mc_actual || "—"}</td>
      <td class="celda-mono">${r.imei || "—"}</td>
      <td>${r.cliente_actual || "—"}</td>
      <td>${r.instalado ? "✅ Instalado" : "❌ No instalado"}</td>
      <td>${r.total_incidencias}</td>
      <td>${r.ha_sido_reparado ? "✅ Sí" : "— No"}</td>
      <td>${r.ultima_incidencia_fecha ? new Date(r.ultima_incidencia_fecha).toLocaleDateString("es-ES") : "—"}</td>
      <td>
        ${r.mc_actual ? `<a href="buscar-serial.html" onclick="sessionStorage.setItem('lockbin_prellenar_busqueda', '${r.mc_actual}')">Ver incidencias →</a>` : "—"}
        ${r.imei ? `<br><a href="vida-equipo.html" onclick="sessionStorage.setItem('lockbin_prellenar_busqueda', '${r.imei}')">Ver vida →</a>` : ""}
      </td>
    </tr>
  `).join("");
}

["filtro-mc", "filtro-cliente", "filtro-instalado", "filtro-reparado", "orden-registro"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
