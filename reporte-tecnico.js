// =========================================================================
// REPORTE DE CAMPO — Panel del Operario
// Busca un equipo por MC, arma un nuevo ticket en historial_fallas, y
// permite cerrarlo con Estado Equipo (que es lo que más adelante dispara
// el resto del sistema: Órdenes_Maestro, Componentes_Retirados, etc.)
// =========================================================================

let equipoActual = null;

const mcInput = document.getElementById("mc-input");
const buscarBtn = document.getElementById("buscar-btn");
const buscarError = document.getElementById("buscar-error");
const pasoBuscar = document.getElementById("paso-buscar");
const pasoReporte = document.getElementById("paso-reporte");
const enviarBtn = document.getElementById("enviar-btn");
const cancelarBtn = document.getElementById("cancelar-btn");
const reporteMsg = document.getElementById("reporte-msg");

buscarBtn.addEventListener("click", buscarEquipo);
mcInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscarEquipo(); });

async function buscarEquipo() {
  const mc = mcInput.value.trim().toUpperCase();
  buscarError.hidden = true;

  if (!mc) {
    mostrarErrorBusqueda("Escribe el código del equipo.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("equipos")
    .select("m_control, cliente, fraccion")
    .eq("m_control", mc)
    .maybeSingle();

  if (error || !data) {
    mostrarErrorBusqueda("No se encontró ningún equipo con ese código.");
    return;
  }

  equipoActual = data;
  document.getElementById("eq-mc").textContent = data.m_control;
  document.getElementById("eq-cliente").textContent = data.cliente || "—";
  document.getElementById("eq-fraccion").textContent = data.fraccion || "—";

  pasoBuscar.hidden = true;
  pasoReporte.hidden = false;
  reporteMsg.hidden = true;
}

cancelarBtn.addEventListener("click", () => {
  equipoActual = null;
  mcInput.value = "";
  document.getElementById("falla-select").value = "";
  document.getElementById("accion-input").value = "";
  document.getElementById("comentarios-input").value = "";
  document.querySelectorAll('input[name="estado_equipo"]').forEach(r => r.checked = false);
  pasoReporte.hidden = true;
  pasoBuscar.hidden = false;
});

enviarBtn.addEventListener("click", async () => {
  const falla = document.getElementById("falla-select").value;
  const accion = document.getElementById("accion-input").value.trim();
  const comentarios = document.getElementById("comentarios-input").value.trim();
  const estadoEquipoRadio = document.querySelector('input[name="estado_equipo"]:checked');

  if (!falla) {
    mostrarMensajeReporte("⚠️ Selecciona la falla reportada.", true);
    return;
  }
  if (!estadoEquipoRadio) {
    mostrarMensajeReporte("⚠️ Selecciona el estado final del equipo.", true);
    return;
  }

  enviarBtn.disabled = true;
  enviarBtn.textContent = "Enviando...";

  const { data: { user } } = await supabaseClient.auth.getUser();
  const estadoEquipo = estadoEquipoRadio.value;
  const idRegistro = "TK-" + equipoActual.m_control + "-" + Math.floor(Math.random() * 900 + 100);

  const nuevaFalla = {
    id_registro: idRegistro,
    cliente: equipoActual.cliente,
    m_control: equipoActual.m_control,
    falla: falla,
    estado: estadoEquipo === "🟢 FUNCIONANDO" ? "✅ CERRADO" : "🚨 ABIERTO",
    accion_calle: accion,
    comentarios: comentarios,
    estado_equipo: estadoEquipo,
    fecha_cierre: estadoEquipo === "🟢 FUNCIONANDO" ? new Date().toISOString() : null,
    origen: user.email
  };

  const { error } = await supabaseClient.from("historial_fallas").insert(nuevaFalla);

  enviarBtn.disabled = false;
  enviarBtn.textContent = "Enviar reporte";

  if (error) {
    mostrarMensajeReporte("❌ Error al guardar: " + error.message, true);
    return;
  }

  mostrarMensajeReporte("✅ Reporte guardado (" + idRegistro + ")", false);
  cargarMisReportes();

  setTimeout(() => {
    cancelarBtn.click();
  }, 1200);
});

function mostrarErrorBusqueda(texto) {
  buscarError.textContent = texto;
  buscarError.hidden = false;
}

function mostrarMensajeReporte(texto, esError) {
  reporteMsg.textContent = texto;
  reporteMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  reporteMsg.hidden = false;
}

async function cargarMisReportes() {
  const contenedor = document.getElementById("mis-reportes");
  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data, error } = await supabaseClient
    .from("historial_fallas")
    .select("id_registro, m_control, falla, estado, fecha")
    .eq("origen", user.email)
    .order("fecha", { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) {
    contenedor.innerHTML = "<p>Todavía no tienes reportes.</p>";
    return;
  }

  contenedor.innerHTML = data.map(f => `
    <div class="reporte-item">
      <strong>${f.m_control}</strong> — ${f.falla} — ${f.estado}
      <span class="reporte-fecha">${new Date(f.fecha).toLocaleString("es-ES")}</span>
    </div>
  `).join("");
}

cargarMisReportes();
