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

// Solo los equipos con Estado de Montaje = Instalado (no Pendiente ni Revisión).
function esInstalado(eq) {
  const e = String(eq.estado_montaje || "").toLowerCase();
  return e.includes("instala") && !e.includes("pendien");
}

async function cargarEquipos() {
  const tbody = document.getElementById("equipos-cliente-tbody");
  try {
    const todos = await traerTodasLasFilas("equipos", "*", (q) => q.order("m_control"));
    equiposCliente = todos.filter(esInstalado);
    llenarOpcionesFiltros();
    renderEquipos();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
  }
}

function llenarOpcionesFiltros() {
  const unicos = (campo) => [...new Set(equiposCliente.map(eq => (eq[campo] || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
  document.getElementById("filtro-fraccion").innerHTML = `<option value="">Todas las fracciones</option>` +
    unicos("fraccion").map(v => `<option value="${v}">${v}</option>`).join("");
  document.getElementById("filtro-estado").innerHTML = `<option value="">Todos los estados</option>` +
    unicos("estado").map(v => `<option value="${v}">${v}</option>`).join("");
  document.getElementById("filtro-alarma").innerHTML = `<option value="">Todas las alarmas</option>
    <option value="__con">Con alguna alarma</option><option value="__sin">Sin alarmas</option>` +
    Object.keys(MAPA_ALARMAS).map(col => `<option value="${col}">${MAPA_ALARMAS[col]}</option>`).join("");
}

function renderEquipos() {
  const texto = document.getElementById("filtro-equipos").value.trim().toLowerCase();
  const fFraccion = document.getElementById("filtro-fraccion").value;
  const fEstado = document.getElementById("filtro-estado").value;
  const fAlarma = document.getElementById("filtro-alarma").value;
  const fCom = document.getElementById("filtro-comunicacion").value;
  const ahora = Date.now();

  const filtrados = equiposCliente.filter(eq => {
    if (texto && !((eq.m_control || "").toLowerCase().includes(texto) || (eq.fraccion || "").toLowerCase().includes(texto))) return false;
    if (fFraccion && (eq.fraccion || "").trim() !== fFraccion) return false;
    if (fEstado && (eq.estado || "").trim() !== fEstado) return false;
    const tieneAlarma = Object.keys(MAPA_ALARMAS).some(col => eq[col]);
    if (fAlarma === "__con" && !tieneAlarma) return false;
    if (fAlarma === "__sin" && tieneAlarma) return false;
    if (fAlarma && !fAlarma.startsWith("__") && !eq[fAlarma]) return false;
    if (fCom === "__nunca") { if (eq.ultima_comunicacion) return false; }
    else if (fCom) {
      if (!eq.ultima_comunicacion) return true; // sin dato también cuenta como sin comunicar
      const dias = (ahora - new Date(eq.ultima_comunicacion).getTime()) / 86400000;
      if (dias <= Number(fCom)) return false;
    }
    return true;
  });

  document.getElementById("total-equipos-cliente").textContent =
    `Mostrando ${filtrados.length} de ${equiposCliente.length} equipos instalados`;

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

['filtro-fraccion','filtro-estado','filtro-alarma','filtro-comunicacion'].forEach(id =>
  document.getElementById(id).addEventListener("change", renderEquipos));
document.getElementById("filtro-limpiar").addEventListener("click", () => {
  ['filtro-equipos','filtro-fraccion','filtro-estado','filtro-alarma','filtro-comunicacion']
    .forEach(id => { document.getElementById(id).value = ""; });
  renderEquipos();
});

document.getElementById("filtro-equipos").addEventListener("input", renderEquipos);

cargarEquipos();
