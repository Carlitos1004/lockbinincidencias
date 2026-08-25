// =========================================================================
// INVENTARIO POR DESTINO
// =========================================================================

let componentesCargados = [];
let destinoSeleccionado = null;

const filtroTipo = document.getElementById("filtro-tipo");
const filtroCliente = document.getElementById("filtro-cliente");
const resumenTbody = document.getElementById("resumen-tbody");
const detalleTbody = document.getElementById("detalle-tbody");

cargarComponentes();

async function cargarComponentes() {
  const { data, error } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .order("fecha", { ascending: false });

  if (error) {
    resumenTbody.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`;
    return;
  }

  componentesCargados = data || [];
  renderTodo();
}

function componentesFiltrados() {
  let filtrados = componentesCargados;
  if (filtroTipo.value) filtrados = filtrados.filter(c => c.tipo_componente === filtroTipo.value);
  if (filtroCliente.value.trim()) {
    const texto = filtroCliente.value.trim().toLowerCase();
    filtrados = filtrados.filter(c => (c.cliente || "").toLowerCase().includes(texto));
  }
  return filtrados;
}

function renderTodo() {
  const filtrados = componentesFiltrados();

  // --- Resumen por destino ---
  const conteoPorDestino = {};
  const conteoPorDestinoYTipo = {};
  filtrados.forEach(c => {
    const destino = c.destino || "(sin destino registrado / pendiente de revisión)";
    conteoPorDestino[destino] = (conteoPorDestino[destino] || 0) + 1;
    if (!conteoPorDestinoYTipo[destino]) conteoPorDestinoYTipo[destino] = {};
    conteoPorDestinoYTipo[destino][c.tipo_componente] = (conteoPorDestinoYTipo[destino][c.tipo_componente] || 0) + 1;
  });

  const destinos = Object.keys(conteoPorDestino).sort((a, b) => conteoPorDestino[b] - conteoPorDestino[a]);

  if (destinos.length === 0) {
    resumenTbody.innerHTML = `<tr><td colspan="3">No hay componentes registrados todavía.</td></tr>`;
  } else {
    resumenTbody.innerHTML = destinos.map(destino => {
      const desglose = Object.entries(conteoPorDestinoYTipo[destino]).map(([tipo, n]) => `${n} ${tipo}`).join(", ");
      return `
        <tr class="fila-clicable ${destino === destinoSeleccionado ? 'fila-seleccionada' : ''}" data-destino="${escaparAtributo(destino)}">
          <td>${destino}</td>
          <td>${conteoPorDestino[destino]}</td>
          <td>${desglose}</td>
        </tr>
      `;
    }).join("");

    resumenTbody.querySelectorAll(".fila-clicable").forEach(fila => {
      fila.addEventListener("click", () => {
        destinoSeleccionado = destinoSeleccionado === fila.dataset.destino ? null : fila.dataset.destino;
        renderTodo();
      });
    });
  }

  // --- Detalle ---
  let paraDetalle = filtrados;
  if (destinoSeleccionado) {
    paraDetalle = filtrados.filter(c => (c.destino || "(sin destino registrado / pendiente de revisión)") === destinoSeleccionado);
  }

  detalleTbody.innerHTML = paraDetalle.length > 0
    ? paraDetalle.map(c => `
        <tr>
          <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
          <td>${c.id_ot || "—"}</td>
          <td>${c.cliente || "—"}</td>
          <td>${c.m_control}</td>
          <td>${c.tipo_componente}</td>
          <td class="celda-mono">${c.serial_retirado}</td>
          <td>${c.estado}</td>
          <td>${c.destino || "—"}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="8">Sin resultados.</td></tr>`;
}

filtroTipo.addEventListener("change", () => { destinoSeleccionado = null; renderTodo(); });
filtroCliente.addEventListener("input", () => { destinoSeleccionado = null; renderTodo(); });

function escaparAtributo(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML.replace(/"/g, "&quot;");
}
