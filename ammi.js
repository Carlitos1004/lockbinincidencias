// =========================================================================
// AMMI — envíos y regresos
// =========================================================================
// Los envíos se llenan solos (vienen de Revisión de Taller, destino
// "Enviar a AMMI"). El regreso NO pasa por ningún otro lado — el Manager
// lo registra aquí mismo cuando AMMI le entrega el equipo reparado y lo
// clasifica para pasárselo a Operaciones.
// =========================================================================

const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

// Mismo criterio de exclusión que el resto de registros y estadísticas.
const CLIENTES_EXCLUIDOS_EXACTOS = ["comercial", "frutos", "interno", "carmen", "municipalia"];
function esClienteExcluido(cliente) {
  const c = (cliente || "").toLowerCase();
  return CLIENTES_EXCLUIDOS_EXACTOS.includes(c) || c.includes("villanueva");
}

let enviosData = [];
let editandoId = null;

cargarEnvios();

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

async function cargarEnvios() {
  try {
    enviosData = await traerTodasLasFilas("componentes_retirados", "*", (q) =>
      q.eq("destino", DESTINO_AMMI).eq("tipo_componente", "Módulo de Control").order("fecha", { ascending: false })
    );
  } catch (err) {
    document.getElementById("tbody-ammi").innerHTML = `<tr><td colspan="9">Error: ${err.message}</td></tr>`;
    return;
  }

  enviosData = enviosData.filter(c => !esClienteExcluido(c.cliente));

  // Cuántas veces ha ido cada MC a AMMI (contando esta misma fila) — un
  // mismo módulo puede fallar, volver, y volver a fallar más adelante.
  const conteoPorMc = {};
  enviosData.forEach(c => { conteoPorMc[c.m_control] = (conteoPorMc[c.m_control] || 0) + 1; });
  enviosData.forEach(c => { c.vecesEnviado = conteoPorMc[c.m_control]; });

  renderResumen();
  renderTabla();
}

function renderResumen() {
  const pendientes = enviosData.filter(c => !c.ammi_fecha_regreso).length;
  const regresados = enviosData.filter(c => c.ammi_fecha_regreso).length;
  const primera = enviosData.filter(c => c.ammi_categoria_regreso === "1ra categoría").length;
  const segunda = enviosData.filter(c => c.ammi_categoria_regreso === "2da categoría").length;
  const repetidos = new Set(enviosData.filter(c => c.vecesEnviado > 1).map(c => c.m_control)).size;

  document.getElementById("resumen-ammi").innerHTML = `
    <div class="tarjeta-resumen"><strong>${enviosData.length}</strong><span>Total enviados</span></div>
    <div class="tarjeta-resumen ${pendientes > 0 ? 'tarjeta-alerta' : ''}"><strong>${pendientes}</strong><span>Pendientes de regreso</span></div>
    <div class="tarjeta-resumen"><strong>${regresados}</strong><span>Regresados</span></div>
    <div class="tarjeta-resumen"><strong>${primera}</strong><span>1ra categoría</span></div>
    <div class="tarjeta-resumen"><strong>${segunda}</strong><span>2da categoría</span></div>
    <div class="tarjeta-resumen"><strong>${repetidos}</strong><span>Equipos enviados más de una vez</span></div>
  `;
}

function renderTabla() {
  const fMc = document.getElementById("filtro-mc-ammi").value.trim().toLowerCase();
  const fEstado = document.getElementById("filtro-estado-ammi").value;
  const fCategoria = document.getElementById("filtro-categoria-regreso").value;
  const fRepetidos = document.getElementById("filtro-repetidos-ammi").value;

  const filtrados = enviosData.filter(c =>
    (!fMc || (c.m_control || "").toLowerCase().includes(fMc) || (c.cliente || "").toLowerCase().includes(fMc)) &&
    (!fEstado || (fEstado === "regresado") === !!c.ammi_fecha_regreso) &&
    (!fCategoria || c.ammi_categoria_regreso === fCategoria) &&
    (!fRepetidos || c.vecesEnviado > 1)
  );

  const tbody = document.getElementById("tbody-ammi");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">Ningún envío coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(c => {
    if (c.id === editandoId) {
      return `
        <tr>
          <td>${c.m_control}</td>
          <td>${c.cliente || "—"}</td>
          <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
          <td>${c.categoria_ammi || "—"}</td>
          <td>${c.garantia_cliente === "SI" ? "Sí cubre" : c.garantia_cliente === "NO" ? "No cubre" : "—"}</td>
          <td>${c.vecesEnviado}</td>
          <td colspan="3">
            <div class="materiales-controles">
              <input type="date" class="input-fecha-regreso" value="${new Date().toISOString().slice(0, 10)}">
              <select class="input-categoria-regreso">
                <option value="">Categoría...</option>
                <option value="1ra categoría">1ra categoría</option>
                <option value="2da categoría">2da categoría</option>
              </select>
            </div>
            <textarea class="input-notas-regreso" rows="2" placeholder="Notas de AMMI (opcional)"></textarea>
            <button class="btn-guardar-regreso btn-primario btn-compacto" data-id="${c.id}" style="margin-top:6px;">Guardar regreso</button>
            <button class="btn-cancelar-regreso btn-secundario btn-compacto" data-id="${c.id}">Cancelar</button>
          </td>
        </tr>
      `;
    }
    return `
    <tr class="${!c.ammi_fecha_regreso ? 'fila-alerta' : ''}">
      <td>${c.m_control}</td>
      <td>${c.cliente || "—"}</td>
      <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
      <td>${c.categoria_ammi || "—"}</td>
      <td>${c.garantia_cliente === "SI" ? "Sí cubre" : c.garantia_cliente === "NO" ? "No cubre" : "—"}</td>
      <td>${c.vecesEnviado}</td>
      <td>${c.ammi_fecha_regreso ? "✅ Regresado" : "🕓 Pendiente"}</td>
      <td>${c.ammi_fecha_regreso
        ? `${new Date(c.ammi_fecha_regreso).toLocaleDateString("es-ES")}${c.ammi_categoria_regreso ? " — " + c.ammi_categoria_regreso : ""}${c.ammi_notas_regreso ? `<br><span style="font-size:0.85rem; color:var(--gris-500);">${c.ammi_notas_regreso}</span>` : ""}`
        : "—"
      }</td>
      <td>
        <button class="btn-editar-regreso btn-secundario btn-compacto" data-id="${c.id}">${c.ammi_fecha_regreso ? "Editar" : "Registrar regreso"}</button>
      </td>
    </tr>
  `;
  }).join("");

  tbody.querySelectorAll(".btn-editar-regreso").forEach(btn => {
    btn.addEventListener("click", () => { editandoId = btn.dataset.id; renderTabla(); });
  });
  tbody.querySelectorAll(".btn-cancelar-regreso").forEach(btn => {
    btn.addEventListener("click", () => { editandoId = null; renderTabla(); });
  });
  tbody.querySelectorAll(".btn-guardar-regreso").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const fecha = fila.querySelector(".input-fecha-regreso").value;
      const categoria = fila.querySelector(".input-categoria-regreso").value;
      const notas = fila.querySelector(".input-notas-regreso").value.trim();

      if (!fecha || !categoria) {
        alert("Elige la fecha de regreso y la categoría.");
        return;
      }

      await supabaseClient.from("componentes_retirados").update({
        ammi_fecha_regreso: fecha,
        ammi_categoria_regreso: categoria,
        ammi_notas_regreso: notas || null
      }).eq("id", btn.dataset.id);

      editandoId = null;
      cargarEnvios();
    });
  });
}

["filtro-mc-ammi", "filtro-estado-ammi", "filtro-categoria-regreso", "filtro-repetidos-ammi"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
