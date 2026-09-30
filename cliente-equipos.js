// =========================================================================
// TUS EQUIPOS (Cliente)
// =========================================================================

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

let equiposCliente = [];

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

async function cargarEquipos() {
  const tbody = document.getElementById("equipos-cliente-tbody");
  try {
    equiposCliente = await traerTodasLasFilas("equipos", "*", (q) => q.order("m_control"));
    renderEquipos();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
  }
}

function renderEquipos() {
  const texto = document.getElementById("filtro-equipos").value.trim().toLowerCase();
  const filtrados = texto
    ? equiposCliente.filter(eq => (eq.m_control || "").toLowerCase().includes(texto) || (eq.fraccion || "").toLowerCase().includes(texto))
    : equiposCliente;

  const tbody = document.getElementById("equipos-cliente-tbody");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">Sin equipos que coincidan.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(eq => {
    const alarmas = Object.keys(MAPA_ALARMAS).filter(col => eq[col]).map(col => MAPA_ALARMAS[col]);
    return `
      <tr class="${alarmas.length > 0 ? 'fila-alerta' : ''}">
        <td>${eq.m_control}</td>
        <td>${eq.fraccion || "—"}</td>
        <td>${eq.estado || "—"}</td>
        <td>${alarmas.length > 0 ? alarmas.join(", ") : "✅ Sin alarmas"}</td>
        <td>${eq.ultima_comunicacion ? new Date(eq.ultima_comunicacion).toLocaleString("es-ES") : "—"}</td>
      </tr>
    `;
  }).join("");
}

document.getElementById("filtro-equipos").addEventListener("input", renderEquipos);

cargarEquipos();
