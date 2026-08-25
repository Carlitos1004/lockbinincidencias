// =========================================================================
// PANEL DEL CLIENTE
// Los datos ya vienen filtrados solos por las políticas de seguridad de
// Supabase (RLS) — este script no necesita filtrar nada por su cuenta,
// solo pedir "todos los equipos" y "todo el historial" y Supabase entrega
// exactamente lo que le corresponde a este cliente, nada más.
// =========================================================================

const MAPA_ALARMAS = {
  alarma_no_comunica: "No comunica",
  alarma_error_servo: "Error servo",
  alarma_vuelco: "Vuelco",
  alarma_incendio: "Incendio",
  alarma_bloqueado: "Bloqueado",
  alarma_sin_bateria: "Sin batería",
  alarma_tapa_abierta: "Tapa abierta",
  alarma_cambiar_bateria: "Cambiar batería",
  alarma_cambiar_ubicacion: "Cambiar ubicación",
  alarma_revisar_comunicacion: "Revisar comunicación",
  alarma_operacion_erratica: "Operación errática"
};

let equiposCliente = [];

async function cargarPanelCliente() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("cliente_nombre")
    .eq("id", user.id)
    .single();

  document.getElementById("cliente-meta").textContent = perfil?.cliente_nombre
    ? "Cliente: " + perfil.cliente_nombre
    : "";

  const { data: equipos, error: errorEquipos } = await supabaseClient
    .from("equipos")
    .select("*")
    .order("m_control");

  const tbodyEquipos = document.getElementById("equipos-cliente-tbody");
  if (errorEquipos) {
    tbodyEquipos.innerHTML = `<tr><td colspan="5">Error: ${errorEquipos.message}</td></tr>`;
  } else {
    equiposCliente = equipos || [];
    renderResumen();
    renderEquipos();
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

cargarPanelCliente();
