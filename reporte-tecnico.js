// =========================================================================
// REPORTE DE CAMPO — Panel del Operario
// Busca un equipo por MC, crea el ticket en historial_fallas, y genera
// automáticamente las filas de componentes_retirados según lo que el
// operario marque en las casillas (cambio real / faltante / vandalismo),
// buscando el serial actual en la tabla "equipos".
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
    .select("m_control, cliente, fraccion, serie_lector, serie_cierre, serie_bateria")
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

cancelarBtn.addEventListener("click", limpiarFormulario);

function limpiarFormulario() {
  equipoActual = null;
  mcInput.value = "";
  document.getElementById("falla-select").value = "";
  document.getElementById("accion-input").value = "";
  document.getElementById("comentarios-input").value = "";
  document.querySelectorAll('input[name="estado_equipo"]').forEach(r => r.checked = false);
  ["cambio-le", "cambio-ce", "cambio-ba", "cambio-mc", "cambio-completo", "retirado-cliente",
   "falta-le", "falta-ce", "falta-ba", "falta-mc", "vandalismo-check"].forEach(id => {
    document.getElementById(id).checked = false;
  });
  pasoReporte.hidden = true;
  pasoBuscar.hidden = false;
}

// Mapa de componente -> {columna en "equipos" donde vive su serial, nombre legible}
const MAPA_COMPONENTE = {
  LE: { columnaEquipo: "serie_lector", nombre: "Lector Electrónico" },
  CE: { columnaEquipo: "serie_cierre", nombre: "Cierre Electrónico" },
  BA: { columnaEquipo: "serie_bateria", nombre: "Batería" },
  MC: { columnaEquipo: null, nombre: "Módulo de Control" } // su "serial" es el propio MC
};

function serialDe(codigo) {
  if (codigo === "MC") return equipoActual.m_control;
  return equipoActual[MAPA_COMPONENTE[codigo].columnaEquipo] || "(sin dato en equipos)";
}

enviarBtn.addEventListener("click", async () => {
  const falla = document.getElementById("falla-select").value;
  const accion = document.getElementById("accion-input").value.trim();
  const comentarios = document.getElementById("comentarios-input").value.trim();
  const estadoEquipoRadio = document.querySelector('input[name="estado_equipo"]:checked');

  if (!falla) { mostrarMensajeReporte("⚠️ Selecciona la falla reportada.", true); return; }
  if (!estadoEquipoRadio) { mostrarMensajeReporte("⚠️ Selecciona el estado final del equipo.", true); return; }

  // --- Leer las casillas marcadas ---
  const cambioCompleto = document.getElementById("cambio-completo").checked;
  let codigosCambio = cambioCompleto
    ? ["LE", "CE", "BA", "MC"]
    : ["LE", "CE", "BA", "MC"].filter(c => document.getElementById("cambio-" + c.toLowerCase()).checked);

  const codigosFaltantes = ["LE", "CE", "BA", "MC"].filter(c => document.getElementById("falta-" + c.toLowerCase()).checked);
  const retiradoPorCliente = document.getElementById("retirado-cliente").checked;
  const esVandalismo = document.getElementById("vandalismo-check").checked;

  enviarBtn.disabled = true;
  enviarBtn.textContent = "Enviando...";

  const { data: { user } } = await supabaseClient.auth.getUser();
  const estadoEquipo = estadoEquipoRadio.value;
  const idRegistro = "TK-" + equipoActual.m_control + "-" + Math.floor(Math.random() * 900 + 100);

  // Construimos un resumen legible de la acción, para dejar registro en el ticket
  const partesResumen = [];
  if (accion) partesResumen.push(accion);
  if (codigosCambio.length > 0) partesResumen.push("Cambio: " + codigosCambio.map(c => MAPA_COMPONENTE[c].nombre).join(", "));
  if (retiradoPorCliente) partesResumen.push("(retirado por el cliente)");
  if (codigosFaltantes.length > 0) partesResumen.push("Falta: " + codigosFaltantes.map(c => MAPA_COMPONENTE[c].nombre).join(", "));
  if (esVandalismo) partesResumen.push("Vandalismo/robo");
  const accionResumen = partesResumen.join(" — ");

  let comentariosFinal = comentarios;

  // --- 1. Crear el ticket en historial_fallas ---
  const nuevaFalla = {
    id_registro: idRegistro,
    cliente: equipoActual.cliente,
    m_control: equipoActual.m_control,
    falla: falla,
    estado: estadoEquipo === "🟢 FUNCIONANDO" ? "✅ CERRADO" : "🚨 ABIERTO",
    accion_calle: accionResumen,
    comentarios: comentariosFinal,
    estado_equipo: estadoEquipo,
    fecha_cierre: estadoEquipo === "🟢 FUNCIONANDO" ? new Date().toISOString() : null,
    origen: user.email
  };

  const { error: errorFalla } = await supabaseClient.from("historial_fallas").insert(nuevaFalla);
  if (errorFalla) {
    enviarBtn.disabled = false;
    enviarBtn.textContent = "Enviar reporte";
    mostrarMensajeReporte("❌ Error al guardar el ticket: " + errorFalla.message, true);
    return;
  }

  // --- 2. Crear filas en componentes_retirados por cada cambio real ---
  const filasComponentes = [];
  const lineasComentario = [];

  codigosCambio.forEach(codigo => {
    const serial = serialDe(codigo);
    filasComponentes.push({
      cliente: equipoActual.cliente,
      m_control: equipoActual.m_control,
      tipo_componente: MAPA_COMPONENTE[codigo].nombre,
      serial_retirado: serial,
      id_registro: idRegistro,
      estado: retiradoPorCliente ? "Cambiado por el cliente" : "Pendiente revisión",
      excluir_materiales: retiradoPorCliente
    });
    lineasComentario.push("🔧 " + MAPA_COMPONENTE[codigo].nombre + " retirado/asociado: " + serial);
  });

  // --- 3. Componentes faltantes/perdidos ---
  codigosFaltantes.forEach(codigo => {
    const serial = serialDe(codigo);
    filasComponentes.push({
      cliente: equipoActual.cliente,
      m_control: equipoActual.m_control,
      tipo_componente: MAPA_COMPONENTE[codigo].nombre,
      serial_retirado: serial,
      id_registro: idRegistro,
      estado: "Faltante/Perdido",
      excluir_materiales: true
    });
    lineasComentario.push("⚠️ " + MAPA_COMPONENTE[codigo].nombre + " faltante/perdido (serial esperado: " + serial + ")");
  });

  // --- 4. Vandalismo/robo: solo informativo para los que NO se están cambiando ya ---
  if (esVandalismo) {
    ["LE", "CE", "BA", "MC"].forEach(codigo => {
      if (codigosCambio.includes(codigo)) return;
      const serial = serialDe(codigo);
      lineasComentario.push("🔎 " + MAPA_COMPONENTE[codigo].nombre + " presente al momento del incidente: " + serial);
    });
  }

  if (filasComponentes.length > 0) {
    const { error: errorComponentes } = await supabaseClient.from("componentes_retirados").insert(filasComponentes);
    if (errorComponentes) {
      mostrarMensajeReporte("⚠️ El ticket se guardó, pero hubo un error al registrar los componentes: " + errorComponentes.message, true);
    }
  }

  // Si hay líneas de comentario nuevas (por componentes), las agregamos al ticket
  if (lineasComentario.length > 0) {
    const comentarioCompleto = comentariosFinal
      ? comentariosFinal + "\n" + lineasComentario.join("\n")
      : lineasComentario.join("\n");
    await supabaseClient.from("historial_fallas").update({ comentarios: comentarioCompleto }).eq("id_registro", idRegistro);
  }

  enviarBtn.disabled = false;
  enviarBtn.textContent = "Enviar reporte";
  mostrarMensajeReporte("✅ Reporte guardado (" + idRegistro + ")", false);
  cargarMisReportes();

  setTimeout(limpiarFormulario, 1200);
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
