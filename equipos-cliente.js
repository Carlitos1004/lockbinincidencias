// =========================================================================
// EQUIPOS POR CLIENTE — solo lectura, con filtro por columna
// =========================================================================

let equiposCargados = [];

cargarClientes();

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

async function cargarClientes() {
  const select = document.getElementById("cliente-select");
  try {
    const todos = await traerTodasLasFilas("equipos", "cliente");
    const clientesUnicos = [...new Set(todos.map(e => e.cliente).filter(Boolean))].sort();
    select.innerHTML = `<option value="">— Selecciona un cliente —</option>` +
      clientesUnicos.map(c => `<option value="${c}">${c}</option>`).join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error al cargar</option>`;
  }
}

document.getElementById("cliente-select").addEventListener("change", cargarEquiposDelCliente);

async function cargarEquiposDelCliente() {
  const cliente = document.getElementById("cliente-select").value;
  const tbody = document.getElementById("equipos-tbody");
  const totalTexto = document.getElementById("total-equipos");

  if (!cliente) {
    tbody.innerHTML = `<tr><td colspan="9">Elige un cliente arriba.</td></tr>`;
    totalTexto.textContent = "";
    return;
  }

  tbody.innerHTML = `<tr><td colspan="9">Cargando...</td></tr>`;

  try {
    equiposCargados = await traerTodasLasFilas(
      "equipos",
      "m_control, fraccion, modelo, estado_montaje, serie_lector, serie_cierre, serie_bateria, firmware, imei",
      (q) => q.eq("cliente", cliente).order("m_control")
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9">Error: ${err.message}</td></tr>`;
    return;
  }

  totalTexto.textContent = `${equiposCargados.length} equipo(s) para ${cliente}`;
  renderTabla();
}

function renderTabla() {
  const filtros = {
    mc: document.getElementById("f-mc").value.trim().toLowerCase(),
    fraccion: document.getElementById("f-fraccion").value.trim().toLowerCase(),
    modelo: document.getElementById("f-modelo").value.trim().toLowerCase(),
    estado: document.getElementById("f-estado").value.trim().toLowerCase(),
    lector: document.getElementById("f-lector").value.trim().toLowerCase(),
    cierre: document.getElementById("f-cierre").value.trim().toLowerCase(),
    bateria: document.getElementById("f-bateria").value.trim().toLowerCase(),
    firmware: document.getElementById("f-firmware").value.trim().toLowerCase(),
    imei: document.getElementById("f-imei").value.trim().toLowerCase()
  };

  const filtrados = equiposCargados.filter(e =>
    (e.m_control || "").toLowerCase().includes(filtros.mc) &&
    (e.fraccion || "").toLowerCase().includes(filtros.fraccion) &&
    (e.modelo || "").toLowerCase().includes(filtros.modelo) &&
    (e.estado_montaje || "").toLowerCase().includes(filtros.estado) &&
    (e.serie_lector || "").toLowerCase().includes(filtros.lector) &&
    (e.serie_cierre || "").toLowerCase().includes(filtros.cierre) &&
    (e.serie_bateria || "").toLowerCase().includes(filtros.bateria) &&
    (e.firmware || "").toLowerCase().includes(filtros.firmware) &&
    (e.imei || "").toLowerCase().includes(filtros.imei)
  );

  const tbody = document.getElementById("equipos-tbody");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">Ningún equipo coincide con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(e => `
    <tr>
      <td>${e.m_control}</td>
      <td>${e.fraccion || "—"}</td>
      <td>${e.modelo || "—"}</td>
      <td>${e.estado_montaje || "—"}</td>
      <td class="celda-mono">${e.serie_lector || "—"}</td>
      <td class="celda-mono">${e.serie_cierre || "—"}</td>
      <td class="celda-mono">${e.serie_bateria || "—"}</td>
      <td>${e.firmware || "—"}</td>
      <td class="celda-mono">${e.imei || "—"}</td>
    </tr>
  `).join("");
}

["f-mc", "f-fraccion", "f-modelo", "f-estado", "f-lector", "f-cierre", "f-bateria", "f-firmware", "f-imei"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
