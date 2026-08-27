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

  // Traemos la foto real: primero la de Revisión de Taller
  // (componentes_retirados.foto_revision), y si no hay, la que subió el
  // operario en campo (historial_fallas.link_foto) — uniendo a mano, ya
  // que no hay relación automática configurada entre estas tablas.
  const componenteIds = [...new Set(garantiasCargadas.map(g => g.componente_id).filter(Boolean))];
  let mapaComponentes = {};
  if (componenteIds.length > 0) {
    const { data: componentesData } = await supabaseClient
      .from("componentes_retirados")
      .select("id, foto_revision, id_registro")
      .in("id", componenteIds);
    (componentesData || []).forEach(c => { mapaComponentes[c.id] = c; });
  }

  const idsRegistro = [...new Set(Object.values(mapaComponentes).map(c => c.id_registro).filter(Boolean))];
  let mapaHistorial = {};
  if (idsRegistro.length > 0) {
    const { data: historialData } = await supabaseClient
      .from("historial_fallas")
      .select("id_registro, link_foto")
      .in("id_registro", idsRegistro);
    (historialData || []).forEach(h => { mapaHistorial[h.id_registro] = h; });
  }

  garantiasCargadas.forEach(g => {
    const componente = g.componente_id ? mapaComponentes[g.componente_id] : null;
    g.foto_real = componente?.foto_revision
      || (componente?.id_registro ? mapaHistorial[componente.id_registro]?.link_foto : null)
      || (esUrlValida(g.nombre_imagen) ? g.nombre_imagen : null) // ej. links de Drive migrados de Sheets
      || null;
  });

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
      <td>${g.foto_real
        ? `<a href="${g.foto_real}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto →</a>`
        : `<input type="text" class="input-imagen" value="${escaparAtributo(g.nombre_imagen || "")}" placeholder="Nombre/link imagen...">`
      }</td>
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
  const nombreImagen = fila.querySelector(".input-imagen")?.value.trim() ?? undefined;

  btn.disabled = true;
  btn.textContent = "Guardando...";

  const datosGuardar = { fecha_entrega: fechaEntrega, observacion: observacion };
  if (nombreImagen !== undefined) datosGuardar.nombre_imagen = nombreImagen;

  const { error } = await supabaseClient
    .from("garantias")
    .update(datosGuardar)
    .eq("id", id);

  btn.textContent = error ? "❌ Error" : "✅ Guardado";
  setTimeout(() => { cargarGarantias(); }, 1200);
}

filtroInput.addEventListener("input", renderTabla);
filtroGarantia.addEventListener("change", renderTabla);

function esUrlValida(texto) {
  return typeof texto === "string" && /^https?:\/\//i.test(texto.trim());
}

function escaparAtributo(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML.replace(/"/g, "&quot;");
}
