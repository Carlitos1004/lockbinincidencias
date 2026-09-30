// =========================================================================
// PANEL DEL CLIENTE — página principal
// Solo el saludo y el resumen rápido (equipos totales / con alarma). El
// resto vive en sus propias páginas: cliente-equipos.html,
// cliente-cambios.html, cliente-fallas.html, cliente-historial.html.
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

async function cargarInicioCliente() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("cliente_nombre")
    .eq("id", user.id)
    .single();

  // El saludo usa cliente_nombre en vez de "nombre" — el campo "nombre" del
  // perfil puede tener cosas como "Contacto Porto" (como lo haya escrito
  // el Manager al crear el usuario), mientras que cliente_nombre siempre
  // es el nombre limpio del cliente.
  const spanSaludo = document.getElementById("nombre-usuario");
  if (spanSaludo) spanSaludo.textContent = perfil?.cliente_nombre || "—";

  try {
    const equiposCliente = await traerTodasLasFilas("equipos", "*", (q) => q.order("m_control"));
    const total = equiposCliente.length;
    const conAlarma = equiposCliente.filter(eq => Object.keys(MAPA_ALARMAS).some(col => eq[col])).length;

    document.getElementById("resumen-cliente").innerHTML = `
      <div class="tarjeta-resumen"><strong>${total}</strong><span>Equipos totales</span></div>
      <div class="tarjeta-resumen ${conAlarma > 0 ? 'tarjeta-alerta' : ''}"><strong>${conAlarma}</strong><span>Con alguna alarma activa</span></div>
    `;
  } catch (err) {
    document.getElementById("resumen-cliente").innerHTML = `<div class="tarjeta-resumen"><strong>—</strong><span>Error: ${err.message}</span></div>`;
  }
}

cargarInicioCliente();
