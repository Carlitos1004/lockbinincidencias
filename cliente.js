// =========================================================================
// PANEL DEL CLIENTE — página principal
// Por ahora solo el saludo y el acceso a "Cambio de equipos y componentes".
// (La vista de equipos, las alarmas y el reporte de fallas se retiraron del
// panel; sus páginas siguen en el proyecto: cliente-equipos.html,
// cliente-fallas.html.)
// =========================================================================

async function cargarInicioCliente() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("cliente_nombre")
    .eq("id", user.id)
    .single();

  // El saludo usa cliente_nombre (nombre limpio del cliente), no "nombre".
  const spanSaludo = document.getElementById("nombre-usuario");
  if (spanSaludo) spanSaludo.textContent = perfil?.cliente_nombre || "—";
}

cargarInicioCliente();
