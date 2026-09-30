// =========================================================================
// CAMBIO DE EQUIPOS Y COMPONENTES (Cliente)
// =========================================================================

let equiposCliente = [];
let nombreClienteActual = null;

const ICONOS_ESTADO_CLIENTE = {
  "Nueva": "🆕 Nueva",
  "Vista": "👀 Vista",
  "Atendida": "✅ Atendida",
  "Aplicado en equipos": "✅ Aplicado en equipos"
};

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

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

async function iniciar() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("cliente_nombre")
    .eq("id", user.id)
    .single();
  nombreClienteActual = perfil?.cliente_nombre || null;

  try {
    equiposCliente = await traerTodasLasFilas("equipos", "m_control, fraccion", (q) => q.order("m_control"));
    document.getElementById("datalist-equipos-cliente").innerHTML = equiposCliente
      .map(eq => `<option value="${eq.m_control}">${eq.fraccion ? eq.m_control + " — " + eq.fraccion : ""}</option>`)
      .join("");
  } catch (err) {
    console.error(err);
  }

  cargarCambiosPropios();
}

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
  const mc = document.getElementById("cambio-mc").value.trim().toUpperCase();
  const tipo = document.getElementById("cambio-tipo").value;
  const serialAnterior = document.getElementById("cambio-serial-anterior").value.trim();
  const serialNuevo = document.getElementById("cambio-serial-nuevo").value.trim();
  const descripcion = document.getElementById("cambio-descripcion").value.trim();
  const msg = document.getElementById("cambio-msg");

  if (!mc || !tipo) {
    mostrarMensaje(msg, "⚠️ Escribe o elige el módulo, y el tipo de componente.", true);
    return;
  }
  if (!equiposCliente.some(eq => eq.m_control === mc)) {
    mostrarMensaje(msg, "⚠️ Ese MC no aparece entre tus equipos. Revisa que esté bien escrito.", true);
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

iniciar();
