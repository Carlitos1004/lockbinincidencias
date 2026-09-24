// =========================================================================
// ESTADÍSTICAS GENERALES
// =========================================================================

cargarEstadisticas();

async function cargarEstadisticas() {
  const { data, error } = await supabaseClient.rpc("estadisticas_generales");

  if (error) {
    document.getElementById("resumen-general").innerHTML = `<p>Error: ${error.message}</p>`;
    return;
  }

  renderResumen(data.resumen);
  renderCausasCondiciones(data.causas, data.condiciones);
  renderPorCliente(data.por_cliente);
  renderTendencia(data.tendencia_mensual);
}

function renderResumen(r) {
  document.getElementById("resumen-general").innerHTML = `
    <div class="tarjeta-resumen"><strong>${r.total_equipos_con_incidencia}</strong><span>Equipos con incidencia</span></div>
    <div class="tarjeta-resumen"><strong>${r.instalados}</strong><span>Instalados</span></div>
    <div class="tarjeta-resumen"><strong>${r.en_revision}</strong><span>En revisión</span></div>
    <div class="tarjeta-resumen"><strong>${r.pendientes}</strong><span>Pendientes</span></div>
    <div class="tarjeta-resumen"><strong>${r.desvinculados_no_en_equipos}</strong><span>Desvinculados (fuera de Equipos)</span></div>
    <div class="tarjeta-resumen"><strong>${r.total_incidencias}</strong><span>Incidencias totales</span></div>
    <div class="tarjeta-resumen"><strong>${r.promedio_incidencias_por_equipo ?? "—"}</strong><span>Promedio por equipo</span></div>
  `;
}

function renderCausasCondiciones(causas, condiciones) {
  const tbodyCausas = document.getElementById("tbody-causas");
  tbodyCausas.innerHTML = causas.length > 0
    ? causas.map(c => `<tr><td>${c.causa}</td><td>${c.cantidad}</td></tr>`).join("")
    : `<tr><td colspan="2">Sin datos todavía.</td></tr>`;

  const tbodyCondiciones = document.getElementById("tbody-condiciones");
  tbodyCondiciones.innerHTML = condiciones.length > 0
    ? condiciones.map(c => `<tr><td>${c.condicion}</td><td>${c.cantidad}</td></tr>`).join("")
    : `<tr><td colspan="2">Sin datos todavía.</td></tr>`;
}

function renderPorCliente(porCliente) {
  const tbody = document.getElementById("tbody-cliente");
  tbody.innerHTML = porCliente.length > 0
    ? porCliente.map(c => `<tr><td>${c.cliente}</td><td>${c.incidencias}</td></tr>`).join("")
    : `<tr><td colspan="2">Sin datos todavía.</td></tr>`;
}

function renderTendencia(tendencia) {
  const tbody = document.getElementById("tbody-tendencia");
  tbody.innerHTML = tendencia.length > 0
    ? tendencia.map(t => `<tr><td>${t.mes}</td><td>${t.incidencias}</td></tr>`).join("")
    : `<tr><td colspan="2">Sin datos todavía.</td></tr>`;
}

// --- Pestañas ---
function cambiarPestana(cual) {
  document.getElementById("vista-causas-box").hidden = cual !== "causas";
  document.getElementById("vista-cliente-box").hidden = cual !== "cliente";
  document.getElementById("vista-tendencia-box").hidden = cual !== "tendencia";
  document.getElementById("tab-causas-btn").classList.toggle("tab-vista-activa", cual === "causas");
  document.getElementById("tab-cliente-btn").classList.toggle("tab-vista-activa", cual === "cliente");
  document.getElementById("tab-tendencia-btn").classList.toggle("tab-vista-activa", cual === "tendencia");
}
document.getElementById("tab-causas-btn").addEventListener("click", () => cambiarPestana("causas"));
document.getElementById("tab-cliente-btn").addEventListener("click", () => cambiarPestana("cliente"));
document.getElementById("tab-tendencia-btn").addEventListener("click", () => cambiarPestana("tendencia"));
