// =========================================================================
// GESTIÓN DE EQUIPOS
// Filtra por cliente los equipos con al menos una alarma activa (o batería
// crítica: las 3 lecturas más recientes por debajo de 6.4V), y genera una
// OT nueva con un ticket en historial_fallas por cada falla detectada —
// igual que hacía "procesarYResaltarFallas" + "generarOrdenTrabajoOficial"
// + "guardarOrdenEnHistorialBD" en Sheets.
// =========================================================================

// Mapa columna booleana en "equipos" -> nombre de Falla legible
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
  const { data, error } = await supabaseClient.from("equipos").select("cliente");
  if (error || !data) {
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

  let query = supabaseClient.from("equipos").select("*");
  if (cliente !== "TODOS") query = query.eq("cliente", cliente);

  const { data, error } = await query;

  filtrarBtn.disabled = false;
  filtrarBtn.textContent = "Filtrar equipos con fallas";

  if (error) {
    mostrarMensaje(filtrarMsg, "❌ " + error.message, true);
    return;
  }

  equiposEncontrados = (data || [])
    .filter(eq => {
      const estado = String(eq.estado_montaje || "").toLowerCase();
      const esInstalado = estado.includes("instala");
      const esPendiente = estado.includes("pendien");
      return (esInstalado && incluirInstalado) || (esPendiente && incluirPendiente);
    })
    .map(eq => {
      const fallas = Object.keys(MAPA_ALARMAS).filter(col => eq[col]).map(col => MAPA_ALARMAS[col]);
      if (bateriaCritica(eq.lecturas_bateria)) fallas.push("Batería Crítica (<6.4V)");
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

// Las 3 lecturas MÁS RECIENTES (posición 0,1,2 del arreglo, que ya viene
// ordenado de más nueva a más vieja) tienen que estar TODAS por debajo de 6.4V
function bateriaCritica(lecturas) {
  if (!Array.isArray(lecturas) || lecturas.length < 3) return false;
  const primeras3 = lecturas.slice(0, 3);
  return primeras3.every(l => typeof l.valor === "number" && l.valor < 6.4);
}

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

  if (seleccionados.length === 0) {
    mostrarMensaje(generarMsg, "⚠️ Selecciona al menos un equipo.", true);
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

  // --- Un ticket por cada falla activa de cada equipo seleccionado ---
  const nuevosTickets = [];
  seleccionados.forEach(eq => {
    eq.fallas.forEach(falla => {
      nuevosTickets.push({
        id_registro: "TK-" + eq.m_control + "-" + Math.floor(Math.random() * 900 + 100),
        cliente: eq.cliente,
        m_control: eq.m_control,
        falla: falla,
        estado: "🚨 ABIERTO",
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

  generarMsg.innerHTML = `✅ ${nuevoIdOt} generada con ${nuevosTickets.length} ticket(s) para ${seleccionados.length} equipo(s). <a href="ot-detalle.html?ot=${nuevoIdOt}" target="_blank">Ver / editar esta OT →</a>`;
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
