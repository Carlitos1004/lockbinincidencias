// =========================================================================
// EQUIPOS POR CLIENTE — solo lectura, con TODAS las columnas de la tabla
// equipos disponibles para elegir, no un subconjunto fijo.
// =========================================================================

const TODAS_LAS_COLUMNAS = [
  { key: "m_control", label: "M. de Control" },
  { key: "cliente", label: "Cliente" },
  { key: "fraccion", label: "Fracción" },
  { key: "modelo", label: "Modelo" },
  { key: "estado", label: "Estado" },
  { key: "estado_montaje", label: "Estado Montaje" },
  { key: "serie_lector", label: "Serie Lector" },
  { key: "serie_cierre", label: "Serie Cierre" },
  { key: "serie_bateria", label: "Serie Batería" },
  { key: "serie_contenedor", label: "Serie Contenedor" },
  { key: "modelo_lector", label: "Modelo Lector" },
  { key: "modelo_cierre", label: "Modelo Cierre" },
  { key: "modelo_bateria", label: "Modelo Batería" },
  { key: "firmware", label: "Firmware" },
  { key: "hardware", label: "Hardware" },
  { key: "fabricante", label: "Fabricante" },
  { key: "lote", label: "Lote" },
  { key: "secuencial", label: "Secuencial" },
  { key: "imei", label: "IMEI" },
  { key: "sim", label: "SIM" },
  { key: "broker", label: "Broker" },
  { key: "tipo_comunicacion", label: "Tipo Comunicación" },
  { key: "tipo_carga", label: "Tipo Carga" },
  { key: "latitud", label: "Latitud" },
  { key: "longitud", label: "Longitud" },
  { key: "fecha_fabricacion", label: "Fecha Fabricación" },
  { key: "fecha_instalacion", label: "Fecha Instalación" },
  { key: "ultima_comunicacion", label: "Última Comunicación" },
  { key: "ultima_apertura", label: "Última Apertura" },
  { key: "lecturas_bateria", label: "Lecturas Batería" },
  { key: "actualizado_en", label: "Actualizado En" },
  { key: "alarma_bloqueado", label: "Alarma: Bloqueado" },
  { key: "alarma_cambiar_bateria", label: "Alarma: Cambiar Batería" },
  { key: "alarma_cambiar_ubicacion", label: "Alarma: Cambiar Ubicación" },
  { key: "alarma_error_servo", label: "Alarma: Error Servo" },
  { key: "alarma_incendio", label: "Alarma: Incendio" },
  { key: "alarma_no_comunica", label: "Alarma: No Comunica" },
  { key: "alarma_operacion_erratica", label: "Alarma: Operación Errática" },
  { key: "alarma_revisar_comunicacion", label: "Alarma: Revisar Comunicación" },
  { key: "alarma_sin_bateria", label: "Alarma: Sin Batería" },
  { key: "alarma_tapa_abierta", label: "Alarma: Tapa Abierta" },
  { key: "alarma_vuelco", label: "Alarma: Vuelco" }
];

const COLUMNAS_VISIBLES_POR_DEFECTO = new Set([
  "m_control", "fraccion", "modelo", "estado_montaje",
  "serie_lector", "serie_cierre", "serie_bateria", "firmware", "imei"
]);

const CLAVE_COLUMNAS = "lockbin_columnas_equipos_cliente_v2";

let equiposCargados = [];
let columnasVisibles = new Set(COLUMNAS_VISIBLES_POR_DEFECTO);

cargarPreferenciaColumnas();
construirChecklistColumnas();
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
    tbody.innerHTML = `<tr><td>Elige un cliente arriba.</td></tr>`;
    totalTexto.textContent = "";
    return;
  }

  tbody.innerHTML = `<tr><td>Cargando...</td></tr>`;

  try {
    equiposCargados = await traerTodasLasFilas(
      "equipos", "*",
      (q) => q.eq("cliente", cliente).order("m_control")
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td>Error: ${err.message}</td></tr>`;
    return;
  }

  totalTexto.textContent = `${equiposCargados.length} equipo(s) para ${cliente}`;
  renderEncabezado();
  renderTabla();
}

// --- Selector de columnas ---
function construirChecklistColumnas() {
  const cont = document.getElementById("columnas-checklist");
  cont.innerHTML = TODAS_LAS_COLUMNAS.map(col => `
    <label class="opcion-check">
      <input type="checkbox" class="check-columna" data-col="${col.key}" ${columnasVisibles.has(col.key) ? "checked" : ""}>
      ${col.label}
    </label>
  `).join("");

  cont.querySelectorAll(".check-columna").forEach(chk => {
    chk.addEventListener("change", () => {
      if (chk.checked) columnasVisibles.add(chk.dataset.col);
      else columnasVisibles.delete(chk.dataset.col);
      guardarPreferenciaColumnas();
      renderEncabezado();
      renderTabla();
    });
  });
}

document.getElementById("toggle-columnas-btn").addEventListener("click", () => {
  const panel = document.getElementById("columnas-panel");
  panel.hidden = !panel.hidden;
});

document.getElementById("marcar-todas-btn").addEventListener("click", () => {
  columnasVisibles = new Set(TODAS_LAS_COLUMNAS.map(c => c.key));
  construirChecklistColumnas();
  guardarPreferenciaColumnas();
  renderEncabezado();
  renderTabla();
});

document.getElementById("desmarcar-todas-btn").addEventListener("click", () => {
  columnasVisibles = new Set();
  construirChecklistColumnas();
  guardarPreferenciaColumnas();
  renderEncabezado();
  renderTabla();
});

function cargarPreferenciaColumnas() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS));
    if (guardado && Array.isArray(guardado)) columnasVisibles = new Set(guardado);
  } catch (e) { /* se queda con las de por defecto */ }
}

function guardarPreferenciaColumnas() {
  localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify([...columnasVisibles]));
}

// --- Encabezado + fila de filtros, generados según las columnas activas ---
function renderEncabezado() {
  const activas = TODAS_LAS_COLUMNAS.filter(c => columnasVisibles.has(c.key));
  const head = document.getElementById("tabla-equipos-head");

  head.innerHTML = `
    <tr>${activas.map(c => `<th>${c.label}</th>`).join("")}</tr>
    <tr class="fila-filtros">${activas.map(c => `<th><input type="text" class="filtro-col" data-col="${c.key}" placeholder="Filtrar..."></th>`).join("")}</tr>
  `;

  head.querySelectorAll(".filtro-col").forEach(input => {
    input.addEventListener("input", renderTabla);
  });
}

function renderTabla() {
  const activas = TODAS_LAS_COLUMNAS.filter(c => columnasVisibles.has(c.key));
  const tbody = document.getElementById("equipos-tbody");

  if (activas.length === 0) {
    tbody.innerHTML = `<tr><td>Elige al menos una columna en "⚙️ Columnas".</td></tr>`;
    return;
  }

  const filtros = {};
  document.querySelectorAll(".filtro-col").forEach(input => {
    filtros[input.dataset.col] = input.value.trim().toLowerCase();
  });

  const filtrados = equiposCargados.filter(e =>
    activas.every(c => {
      const filtro = filtros[c.key];
      if (!filtro) return true;
      return String(e[c.key] ?? "").toLowerCase().includes(filtro);
    })
  );

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td>Ningún equipo coincide con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(e => `
    <tr>${activas.map(c => `<td class="${esColumnaSerial(c.key) ? 'celda-mono' : ''}">${formatearValor(e[c.key])}</td>`).join("")}</tr>
  `).join("");
}

function esColumnaSerial(key) {
  return key.startsWith("serie_") || key === "imei" || key === "sim" || key === "m_control";
}

function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "✅" : "—";
  return valor;
}
