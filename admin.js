// =========================================================================
// DASHBOARD DEL MANAGER — 3 estadísticas rápidas al entrar
// =========================================================================

const MAPA_ALARMAS_DASH = [
  "alarma_no_comunica", "alarma_error_servo", "alarma_vuelco", "alarma_incendio",
  "alarma_bloqueado", "alarma_sin_bateria", "alarma_tapa_abierta", "alarma_cambiar_bateria",
  "alarma_cambiar_ubicacion", "alarma_revisar_comunicacion", "alarma_operacion_erratica"
];

async function cargarDashboard() {
  const [{ data: tickets }, { data: equipos }, { data: componentes }] = await Promise.all([
    supabaseClient.from("historial_fallas").select("id_ot, estado"),
    supabaseClient.from("equipos").select(MAPA_ALARMAS_DASH.join(",")),
    supabaseClient.from("componentes_retirados").select("estado")
  ]);

  const otsConPendientes = new Set(
    (tickets || []).filter(t => t.estado === "🚨 ABIERTO").map(t => t.id_ot)
  ).size;

  const equiposConAlarma = (equipos || []).filter(eq =>
    MAPA_ALARMAS_DASH.some(col => eq[col])
  ).length;

  const componentesPendientes = (componentes || []).filter(c => c.estado === "Pendiente revisión").length;

  const tarjetas = document.querySelectorAll("#resumen-dashboard .tarjeta-resumen strong");
  if (tarjetas[0]) tarjetas[0].textContent = otsConPendientes;
  if (tarjetas[1]) tarjetas[1].textContent = equiposConAlarma;
  if (tarjetas[2]) tarjetas[2].textContent = componentesPendientes;

  // Resalta en ámbar si hay algo pendiente
  const contenedores = document.querySelectorAll("#resumen-dashboard .tarjeta-resumen");
  if (otsConPendientes > 0) contenedores[0]?.classList.add("tarjeta-alerta");
  if (equiposConAlarma > 0) contenedores[1]?.classList.add("tarjeta-alerta");
  if (componentesPendientes > 0) contenedores[2]?.classList.add("tarjeta-alerta");
}

cargarDashboard();
