// =========================================================================
// GESTIÓN DE EQUIPOS
// Filtra por cliente los equipos con al menos una alarma activa (o batería
// crítica: las 3 lecturas más recientes por debajo de 6.4V), y genera una
// OT nueva con un ticket en historial_fallas por cada falla detectada —
// igual que hacía "procesarYResaltarFallas" + "generarOrdenTrabajoOficial"
// + "guardarOrdenEnHistorialBD" en Sheets.
// =========================================================================

// Mapa columna booleana en "equipos" -> nombre de Falla legible
// "No comunica" se quitó a propósito — todavía no tienen un criterio
// confiable para esa alarma (según indicó el equipo el 26/08/2026).
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

// Texto de acción por defecto según la falla, para que el operario tenga
// una idea de qué hacer antes de llegar — se sobreescribe cuando reporta
// de verdad en el mapa.
function obtenerAccionPorDefecto(falla) {
  const f = falla.toLowerCase();
  if (f.includes("comunica")) return "Pasar tarjeta ACTIVACIÓN. Si no comunica, desconectar y reconectar batería.";
  if (f.includes("servo")) return "Revisar cierre. Evaluar cambio de CIERRE si persiste.";
  if (f.includes("vuelco") || f.includes("incendio")) return "⚠️ Tomar fotos obligatorio. Evaluar cambio de equipo por daños.";
  if (f.includes("bater")) return "Revisar batería. Probar con recargable o evaluar cambio.";
  if (f.includes("bloquead")) return "Revisar mecanismo de cerradura, forzar apertura manual si es necesario.";
  if (f.includes("tapa")) return "Revisar y ajustar tapa/sensor de apertura.";
  if (f.includes("ubicac")) return "Verificar y corregir la ubicación registrada del equipo.";
  if (f.includes("erratic")) return "Inspeccionar sensores y comportamiento del equipo.";
  if (f.includes("añadido") || f.includes("revisión general")) return "Revisión general del equipo.";
  return "Inspeccionar físicamente por la falla reportada.";
}

// Trae TODAS las filas de una consulta, sin toparse con el límite de 1000
// filas por página que aplica Supabase por defecto. Se usa en cualquier
// consulta a "equipos" que pueda devolver más de eso (ya pasamos los 5000).
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

let equiposEncontrados = []; // [{m_control, fraccion, cliente, fallas: [...]}]

const clienteSelect = document.getElementById("cliente-select");
const filtrarBtn = document.getElementById("filtrar-btn");
const filtrarMsg = document.getElementById("filtrar-msg");
const resultadoFiltro = document.getElementById("resultado-filtro");
const tbody = document.getElementById("equipos-tbody");
const totalEncontrados = document.getElementById("total-encontrados");
const checkTodos = document.getElementById("check-todos");
const generarBtn = document.getElementById("generar-btn");
const generarMsg = document.getElementById("generar-msg");

cargarClientes();

async function cargarClientes() {
  let data;
  try {
    data = await traerTodasLasFilas("equipos", "cliente");
  } catch (err) {
    clienteSelect.innerHTML = `<option value="">Error al cargar</option>`;
    return;
  }
  const clientesUnicos = [...new Set(data.map(e => e.cliente).filter(Boolean))].sort();
  clienteSelect.innerHTML =
    `<option value="">— Selecciona un cliente —</option>` +
    `<option value="TODOS">TODOS</option>` +
    clientesUnicos.map(c => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join("");
}

filtrarBtn.addEventListener("click", async () => {
  const cliente = clienteSelect.value;
  filtrarMsg.hidden = true;
  resultadoFiltro.hidden = true;

  if (!cliente) {
    mostrarMensaje(filtrarMsg, "⚠️ Selecciona un cliente.", true);
    return;
  }

  const incluirInstalado = document.getElementById("estado-instalado").checked;
  const incluirPendiente = document.getElementById("estado-pendiente").checked;

  if (!incluirInstalado && !incluirPendiente) {
    mostrarMensaje(filtrarMsg, "⚠️ Elige al menos un estado de montaje (Instalado y/o Pendiente).", true);
    return;
  }

  filtrarBtn.disabled = true;
  filtrarBtn.textContent = "Filtrando...";

  let data;
  try {
    data = await traerTodasLasFilas("equipos", "*", (q) => cliente !== "TODOS" ? q.eq("cliente", cliente) : q);
  } catch (err) {
    filtrarBtn.disabled = false;
    filtrarBtn.textContent = "Filtrar equipos con fallas";
    mostrarMensaje(filtrarMsg, "❌ " + err.message, true);
    return;
  }

  filtrarBtn.disabled = false;
  filtrarBtn.textContent = "Filtrar equipos con fallas";

  equiposEncontrados = (data || [])
    .filter(eq => {
      const estado = String(eq.estado_montaje || "").toLowerCase();
      const esInstalado = estado.includes("instala");
      const esPendiente = estado.includes("pendien");
      return (esInstalado && incluirInstalado) || (esPendiente && incluirPendiente);
    })
    .map(eq => {
      const fallas = Object.keys(MAPA_ALARMAS).filter(col => eq[col]).map(col => MAPA_ALARMAS[col]);
      return { m_control: eq.m_control, fraccion: eq.fraccion, cliente: eq.cliente, estado_montaje: eq.estado_montaje, fallas };
    })
    .filter(eq => eq.fallas.length > 0);

  if (equiposEncontrados.length === 0) {
    mostrarMensaje(filtrarMsg, "No se encontraron equipos con fallas para ese cliente.", false);
    return;
  }

  renderTabla();
  resultadoFiltro.hidden = false;
});

function renderTabla() {
  totalEncontrados.textContent = `${equiposEncontrados.length} equipos encontrados`;
  tbody.innerHTML = equiposEncontrados.map((eq, idx) => `
    <tr>
      <td><input type="checkbox" class="check-equipo" data-idx="${idx}" checked></td>
      <td>${eq.m_control}</td>
      <td>${eq.estado_montaje || "—"}</td>
      <td>${eq.fraccion || "—"}</td>
      <td>${eq.fallas.join(", ")}</td>
    </tr>
  `).join("");
}

checkTodos.addEventListener("change", () => {
  document.querySelectorAll(".check-equipo").forEach(c => { c.checked = checkTodos.checked; });
});

generarBtn.addEventListener("click", async () => {
  const seleccionados = [...document.querySelectorAll(".check-equipo:checked")]
    .map(c => equiposEncontrados[parseInt(c.dataset.idx, 10)]);

  // --- Procesar equipos manuales agregados a mano ---
  const textoManuales = document.getElementById("manuales-textarea").value.trim();
  const mcsManualesTexto = textoManuales
    ? textoManuales.split(/[,\n]/).map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  const mcsYaIncluidos = new Set(seleccionados.map(e => e.m_control));
  const mcsManualesNuevos = mcsManualesTexto.filter(mc => !mcsYaIncluidos.has(mc));

  let equiposManuales = [];
  if (mcsManualesNuevos.length > 0) {
    const { data: datosManuales, error: errorManuales } = await supabaseClient
      .from("equipos")
      .select("m_control, cliente, fraccion")
      .in("m_control", mcsManualesNuevos);

    if (errorManuales) {
      mostrarMensaje(generarMsg, "❌ Error al buscar los equipos manuales: " + errorManuales.message, true);
      return;
    }

    const encontrados = new Set((datosManuales || []).map(e => e.m_control));
    const noEncontrados = mcsManualesNuevos.filter(mc => !encontrados.has(mc));
    if (noEncontrados.length > 0) {
      mostrarMensaje(generarMsg, "⚠️ Estos equipos no existen en la base: " + noEncontrados.join(", ") + " — corrígelos o quítalos e intenta de nuevo.", true);
      return;
    }

    equiposManuales = (datosManuales || []).map(eq => ({
      m_control: eq.m_control, fraccion: eq.fraccion, cliente: eq.cliente,
      fallas: ["Revisión general (añadido manualmente)"]
    }));
  }

  const todosLosEquipos = [...seleccionados, ...equiposManuales];

  if (todosLosEquipos.length === 0) {
    mostrarMensaje(generarMsg, "⚠️ Selecciona al menos un equipo o agrega uno manual.", true);
    return;
  }

  generarBtn.disabled = true;
  generarBtn.textContent = "Generando...";

  const { data: { user } } = await supabaseClient.auth.getUser();

  // --- Calcular el siguiente número de OT disponible ---
  const { data: otsExistentes } = await supabaseClient.from("ordenes_trabajo").select("id_ot");
  let maxNum = 0;
  (otsExistentes || []).forEach(o => {
    const m = String(o.id_ot).match(/OT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const nuevoIdOt = "OT-" + String(maxNum + 1).padStart(3, "0");

  const { error: errorOt } = await supabaseClient
    .from("ordenes_trabajo")
    .insert({ id_ot: nuevoIdOt, creado_por: user.email });

  if (errorOt) {
    mostrarMensaje(generarMsg, "❌ Error al crear la OT: " + errorOt.message, true);
    generarBtn.disabled = false;
    generarBtn.textContent = "Generar OT con los equipos seleccionados";
    return;
  }

  // --- Un ticket por cada falla activa de cada equipo (filtrado o manual) ---
  const nuevosTickets = [];
  todosLosEquipos.forEach(eq => {
    eq.fallas.forEach(falla => {
      nuevosTickets.push({
        id_registro: "TK-" + eq.m_control + "-" + Math.floor(Math.random() * 900 + 100),
        cliente: eq.cliente,
        m_control: eq.m_control,
        falla: falla,
        estado: "🚨 ABIERTO",
        accion_calle: obtenerAccionPorDefecto(falla),
        origen: user.email,
        id_ot: nuevoIdOt
      });
    });
  });

  const { error: errorTickets } = await supabaseClient.from("historial_fallas").insert(nuevosTickets);

  generarBtn.disabled = false;
  generarBtn.textContent = "Generar OT con los equipos seleccionados";

  if (errorTickets) {
    mostrarMensaje(generarMsg, "❌ La OT se creó, pero hubo un error al generar los tickets: " + errorTickets.message, true);
    return;
  }

  generarMsg.innerHTML = `✅ ${nuevoIdOt} generada con ${nuevosTickets.length} ticket(s) para ${todosLosEquipos.length} equipo(s) (${equiposManuales.length} manual(es)).<br><a href="ot-detalle.html?ot=${nuevoIdOt}" class="btn-ver-tabla" style="margin-top:10px;display:inline-block;">Ver / editar esta OT →</a>`;
  generarMsg.className = "resultado-msg resultado-ok";
  generarMsg.hidden = false;
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
