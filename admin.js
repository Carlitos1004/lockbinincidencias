// =========================================================================
// DASHBOARD DEL MANAGER — 3 estadísticas rápidas al entrar
// Se calculan en la base de datos (función estadisticas_dashboard), no
// trayendo filas al navegador — las consultas normales de Supabase se
// limitan a 1000 filas, y con miles de equipos eso daba un conteo mal.
// =========================================================================

async function cargarDashboard() {
  const { data, error } = await supabaseClient.rpc("estadisticas_dashboard");

  if (error || !data || data.length === 0) {
    console.error("Error cargando estadísticas del dashboard:", error);
    return;
  }

  const stats = data[0];
  const otsConPendientes = stats.ots_con_pendientes ?? 0;
  const equiposConAlarma = stats.equipos_con_alarma ?? 0;
  const componentesPendientes = stats.componentes_pendientes ?? 0;

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
