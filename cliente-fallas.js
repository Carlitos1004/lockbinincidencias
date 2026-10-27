// =========================================================================
// REPORTE DE FALLAS (Cliente)
// =========================================================================

let equiposCliente = [];
let nombreClienteActual = null;

const ICONOS_ESTADO_CLIENTE = {
  "Nueva": "🆕 Nueva",
  "Vista": "👀 Vista",
  "Atendida": "✅ Atendida"
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

// Solo los equipos con Estado de Montaje = Instalado (no Pendiente ni Revisión).
function esInstalado(eq) {
  const e = String(eq.estado_montaje || "").toLowerCase();
  return e.includes("instala") && !e.includes("pendien");
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
    const todos = await traerTodasLasFilas("equipos", "m_control, fraccion, estado_montaje", (q) => q.order("m_control"));
    equiposCliente = todos.filter(esInstalado);
    document.getElementById("datalist-equipos-cliente").innerHTML = equiposCliente
      .map(eq => `<option value="${eq.m_control}">${eq.fraccion ? eq.m_control + " — " + eq.fraccion : ""}</option>`)
      .join("");
  } catch (err) {
    console.error(err);
  }

  cargarAlertasPropias();
}

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
  const mc = document.getElementById("falla-mc").value.trim().toUpperCase();
  const mensaje = document.getElementById("falla-mensaje").value.trim();
  const msg = document.getElementById("falla-msg");

  if (!mc || !mensaje) {
    mostrarMensaje(msg, "⚠️ Escribe o elige el módulo y describe la falla.", true);
    return;
  }
  if (!equiposCliente.some(eq => eq.m_control === mc)) {
    mostrarMensaje(msg, "⚠️ Ese MC no aparece entre tus equipos. Revisa que esté bien escrito.", true);
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

iniciar();
