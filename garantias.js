// =========================================================================
// CONSULTA DE GARANTÍAS
// =========================================================================

let garantiasCargadas = [];

const filtroInput = document.getElementById("filtro-input");
const filtroGarantia = document.getElementById("filtro-garantia");
const tbody = document.getElementById("garantias-tbody");

cargarGarantias();

async function cargarGarantias() {
  const { data, error } = await supabaseClient
    .from("garantias")
    .select("*")
    .order("creado_en", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="12">Error: ${error.message}</td></tr>`;
    return;
  }

  garantiasCargadas = data || [];
  renderTabla();
}

function renderTabla() {
  const texto = filtroInput.value.trim().toLowerCase();
  const garantia = filtroGarantia.value;

  let filtradas = garantiasCargadas;

  if (texto) {
    filtradas = filtradas.filter(g =>
      (g.id_ot || "").toLowerCase().includes(texto) ||
      (g.cliente || "").toLowerCase().includes(texto) ||
      (g.m_control || "").toLowerCase().includes(texto)
    );
  }
  if (garantia !== "todas") {
    filtradas = filtradas.filter(g => {
      const aplica = esGarantiaAplicable(g.criterio_revision, g.fecha_entrega);
      return garantia === "SI" ? aplica : !aplica;
    });
  }

  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12">No hay garantías que coincidan.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtradas.map(g => {
    const vigencia = calcularGarantiaTiempo(g.fecha_entrega);
    const estadoFinal = calcularEstadoFinalGarantia(g.criterio_revision, g.fecha_entrega);
    return `
    <tr data-id="${g.id}">
      <td>${g.id_ot || "—"}</td>
      <td>${g.cliente || "—"}</td>
      <td>${g.m_control || "—"}</td>
      <td class="celda-mono">${g.dispositivo_danado || "—"}</td>
      <td>${g.falla || "—"}</td>
      <td>${g.criterio_revision || "—"}</td>
      <td><input type="date" class="input-fecha-entrega" value="${g.fecha_entrega || ""}"></td>
      <td>${vigencia}</td>
      <td>${estadoFinal || "—"}</td>
      <td><input type="text" class="input-observacion" value="${escaparAtributo(g.observacion || "")}" placeholder="Observación..."></td>
      <td><input type="text" class="input-imagen" value="${escaparAtributo(g.nombre_imagen || "")}" placeholder="Nombre/link imagen..."></td>
      <td><button class="btn-guardar-fila">Guardar</button></td>
    </tr>
  `;
  }).join("");

  tbody.querySelectorAll(".btn-guardar-fila").forEach(btn => {
    btn.addEventListener("click", () => guardarFila(btn));
  });
}

async function guardarFila(btn) {
  const fila = btn.closest("tr");
  const id = fila.dataset.id;
  const fechaEntrega = fila.querySelector(".input-fecha-entrega").value || null;
  const observacion = fila.querySelector(".input-observacion").value.trim();
  const nombreImagen = fila.querySelector(".input-imagen").value.trim();

  btn.disabled = true;
  btn.textContent = "Guardando...";

  const { error } = await supabaseClient
    .from("garantias")
    .update({
      fecha_entrega: fechaEntrega,
      observacion: observacion,
      nombre_imagen: nombreImagen
    })
    .eq("id", id);

  btn.textContent = error ? "❌ Error" : "✅ Guardado";
  setTimeout(() => { cargarGarantias(); }, 1200);
}

filtroInput.addEventListener("input", renderTabla);
filtroGarantia.addEventListener("change", renderTabla);

function escaparAtributo(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML.replace(/"/g, "&quot;");
}
