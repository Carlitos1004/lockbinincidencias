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
      <td data-col="mc">${e.m_control}</td>
      <td data-col="fraccion">${e.fraccion || "—"}</td>
      <td data-col="modelo">${e.modelo || "—"}</td>
      <td data-col="estado">${e.estado_montaje || "—"}</td>
      <td data-col="lector" class="celda-mono">${e.serie_lector || "—"}</td>
      <td data-col="cierre" class="celda-mono">${e.serie_cierre || "—"}</td>
      <td data-col="bateria" class="celda-mono">${e.serie_bateria || "—"}</td>
      <td data-col="firmware">${e.firmware || "—"}</td>
      <td data-col="imei" class="celda-mono">${e.imei || "—"}</td>
    </tr>
  `).join("");

  aplicarColumnasVisibles();
}

["f-mc", "f-fraccion", "f-modelo", "f-estado", "f-lector", "f-cierre", "f-bateria", "f-firmware", "f-imei"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});

// --- Columnas visibles: se guardan en el navegador, para no repetir la
// elección cada vez que entras ---
const CLAVE_COLUMNAS = "lockbin_columnas_equipos_cliente";

document.getElementById("toggle-columnas-btn").addEventListener("click", () => {
  const panel = document.getElementById("columnas-panel");
  panel.hidden = !panel.hidden;
});

function cargarPreferenciaColumnas() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) || "{}");
    document.querySelectorAll(".check-columna").forEach(chk => {
      if (guardado[chk.dataset.col] === false) chk.checked = false;
    });
  } catch (e) { /* si algo sale mal, se queda con todas visibles */ }
}

function aplicarColumnasVisibles() {
  document.querySelectorAll(".check-columna").forEach(chk => {
    const visible = chk.checked;
    document.querySelectorAll(`[data-col="${chk.dataset.col}"]`).forEach(celda => {
      celda.style.display = visible ? "" : "none";
    });
  });
}

document.querySelectorAll(".check-columna").forEach(chk => {
  chk.addEventListener("change", () => {
    aplicarColumnasVisibles();
    const estado = {};
    document.querySelectorAll(".check-columna").forEach(c => { estado[c.dataset.col] = c.checked; });
    localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(estado));
  });
});

cargarPreferenciaColumnas();
