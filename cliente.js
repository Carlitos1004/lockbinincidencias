// =========================================================================
// PANEL DEL CLIENTE
// Los datos ya vienen filtrados solos por las políticas de seguridad de
// Supabase (RLS) — este script no necesita filtrar nada por su cuenta,
// solo pedir "todos los equipos" y "todo el historial" y Supabase entrega
// exactamente lo que le corresponde a este cliente, nada más.
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

const ICONOS_ESTADO_CLIENTE = {
  "Nueva": "🆕 Nueva",
  "Vista": "👀 Vista",
  "Atendida": "✅ Atendida",
  "Aplicado en equipos": "✅ Aplicado en equipos"
};

let equiposCliente = [];
let nombreClienteActual = null;

// Trae TODAS las filas sin toparse con el límite de 1000 por página que
// aplica Supabase por defecto — necesario porque "equipos" ya pasa de 5000.
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

async function cargarPanelCliente() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("cliente_nombre")
    .eq("id", user.id)
    .single();

  nombreClienteActual = perfil?.cliente_nombre || null;

  // El saludo usa cliente_nombre en vez de "nombre" — el campo "nombre" del
  // perfil puede tener cosas como "Contacto Porto" (como lo haya escrito
  // el Manager al crear el usuario), mientras que cliente_nombre siempre
  // es el nombre limpio del cliente.
  const spanSaludo = document.getElementById("nombre-usuario");
  if (spanSaludo) spanSaludo.textContent = nombreClienteActual || "—";

  const tbodyEquipos = document.getElementById("equipos-cliente-tbody");
  try {
    equiposCliente = await traerTodasLasFilas("equipos", "*", (q) => q.order("m_control"));
    renderResumen();
    renderEquipos();
    llenarSelectsDeEquipos();
  } catch (err) {
    tbodyEquipos.innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
  }

  const { data: historial, error: errorHistorial } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(100);

  const tbodyHistorial = document.getElementById("historial-cliente-tbody");
  if (errorHistorial) {
    tbodyHistorial.innerHTML = `<tr><td colspan="5">Error: ${errorHistorial.message}</td></tr>`;
  } else if (!historial || historial.length === 0) {
    tbodyHistorial.innerHTML = `<tr><td colspan="5">Sin historial todavía.</td></tr>`;
  } else {
    tbodyHistorial.innerHTML = historial.map(h => `
      <tr>
        <td>${new Date(h.fecha).toLocaleDateString("es-ES")}</td>
        <td>${h.m_control}</td>
        <td>${h.falla}</td>
        <td>${h.estado}${h.estado_equipo ? " — " + h.estado_equipo : ""}</td>
        <td>${[h.accion_calle, h.comentarios].filter(Boolean).join(" | ") || "—"}</td>
      </tr>
    `).join("");
  }

  cargarCambiosPropios();
  cargarAlertasPropias();
}

function renderResumen() {
  const total = equiposCliente.length;
  const conAlarma = equiposCliente.filter(eq => Object.keys(MAPA_ALARMAS).some(col => eq[col])).length;

  document.getElementById("resumen-cliente").innerHTML = `
    <div class="tarjeta-resumen"><strong>${total}</strong><span>Equipos totales</span></div>
    <div class="tarjeta-resumen ${conAlarma > 0 ? 'tarjeta-alerta' : ''}"><strong>${conAlarma}</strong><span>Con alguna alarma activa</span></div>
  `;
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

// Llena los 2 desplegables de "elige tu módulo" (cambios y fallas) con la
// lista de equipos que ya tenemos cargada — evita que el cliente tenga que
// escribir el MC a mano y se equivoque.
function llenarSelectsDeEquipos() {
  const opciones = equiposCliente
    .map(eq => `<option value="${eq.m_control}">${eq.m_control}${eq.fraccion ? " — " + eq.fraccion : ""}</option>`)
    .join("");

  const selectCambio = document.getElementById("cambio-mc");
  const selectFalla = document.getElementById("falla-mc");
  selectCambio.innerHTML = `<option value="">Selecciona el módulo (MC)...</option>` + opciones;
  selectFalla.innerHTML = `<option value="">Selecciona el módulo (MC)...</option>` + opciones;
}

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

// ================= CAMBIO DE EQUIPOS Y COMPONENTES =================

async function cargarCambiosPropios() {
  const tbody = document.getElementById("cambios-cliente-tbody");
  const { data, error } = await supabaseClient
    .from("cambios_cliente")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">Todavía no has reportado ningún cambio.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
      <td>${c.m_control}</td>
      <td>${c.tipo_componente || "—"}</td>
      <td>${c.serial_anterior || "—"} → ${c.serial_nuevo || "—"}</td>
      <td>${c.descripcion || "—"}</td>
      <td>${ICONOS_ESTADO_CLIENTE[c.estado] || c.estado}</td>
    </tr>
  `).join("");
}

document.getElementById("cambio-btn").addEventListener("click", async () => {
  const mc = document.getElementById("cambio-mc").value;
  const tipo = document.getElementById("cambio-tipo").value;
  const serialAnterior = document.getElementById("cambio-serial-anterior").value.trim();
  const serialNuevo = document.getElementById("cambio-serial-nuevo").value.trim();
  const descripcion = document.getElementById("cambio-descripcion").value.trim();
  const msg = document.getElementById("cambio-msg");

  if (!mc || !tipo) {
    mostrarMensaje(msg, "⚠️ Selecciona el módulo y el tipo de componente.", true);
    return;
  }
  if (!serialAnterior && !serialNuevo && !descripcion) {
    mostrarMensaje(msg, "⚠️ Cuéntanos al menos algo: un serial o una descripción del cambio.", true);
    return;
  }

  const btn = document.getElementById("cambio-btn");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const { error } = await supabaseClient.from("cambios_cliente").insert({
    cliente: nombreClienteActual,
    m_control: mc,
    tipo_componente: tipo,
    serial_anterior: serialAnterior || null,
    serial_nuevo: serialNuevo || null,
    descripcion: descripcion || null
  });

  btn.disabled = false;
  btn.textContent = "Enviar reporte de cambio";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, "✅ Cambio reportado. Lo revisaremos y actualizaremos el sistema.", false);
  document.getElementById("cambio-mc").value = "";
  document.getElementById("cambio-tipo").value = "";
  document.getElementById("cambio-serial-anterior").value = "";
  document.getElementById("cambio-serial-nuevo").value = "";
  document.getElementById("cambio-descripcion").value = "";
  cargarCambiosPropios();
});

// ================= REPORTE / FORMULARIO DE FALLAS =================

async function cargarAlertasPropias() {
  const tbody = document.getElementById("alertas-cliente-tbody");
  const { data, error } = await supabaseClient
    .from("alertas_cliente")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">Todavía no has reportado ninguna falla.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(a => `
    <tr>
      <td>${new Date(a.fecha).toLocaleDateString("es-ES")}</td>
      <td>${a.m_control}</td>
      <td>${a.mensaje}</td>
      <td>${ICONOS_ESTADO_CLIENTE[a.estado] || a.estado}</td>
    </tr>
  `).join("");
}

document.getElementById("falla-btn").addEventListener("click", async () => {
  const mc = document.getElementById("falla-mc").value;
  const mensaje = document.getElementById("falla-mensaje").value.trim();
  const msg = document.getElementById("falla-msg");

  if (!mc || !mensaje) {
    mostrarMensaje(msg, "⚠️ Selecciona el módulo y describe la falla.", true);
    return;
  }

  const btn = document.getElementById("falla-btn");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const { error } = await supabaseClient.from("alertas_cliente").insert({
    cliente: nombreClienteActual,
    m_control: mc,
    mensaje: mensaje
  });

  btn.disabled = false;
  btn.textContent = "Enviar reporte de falla";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, "✅ Falla reportada. La revisaremos pronto.", false);
  document.getElementById("falla-mc").value = "";
  document.getElementById("falla-mensaje").value = "";
  cargarAlertasPropias();
});

cargarPanelCliente();
