// =========================================================================
// REPOSICIONES DE EQUIPO
// =========================================================================

let reposicionesData = [];
let componentesPorReposicion = {};
let expandidoId = null;

cargarReposiciones();

async function cargarReposiciones() {
  const [{ data: reposiciones, error: errorRep }, { data: componentes, error: errorComp }] = await Promise.all([
    supabaseClient.from("equipos_reposicion").select("*").order("mc"),
    supabaseClient.from("reposicion_componentes").select("*")
  ]);

  if (errorRep) {
    document.getElementById("tbody-reposicion").innerHTML = `<tr><td colspan="8">Error: ${errorRep.message}</td></tr>`;
    return;
  }

  reposicionesData = reposiciones || [];
  componentesPorReposicion = {};
  (componentes || []).forEach(c => {
    if (!componentesPorReposicion[c.reposicion_id]) componentesPorReposicion[c.reposicion_id] = [];
    componentesPorReposicion[c.reposicion_id].push(c);
  });

  renderResumen();
  renderTabla();
}

function renderResumen() {
  const reponer = reposicionesData.filter(r => r.tipo_registro === "REPONER");
  const pendientes = reponer.filter(r => r.estado === "Pendiente").length;
  const repuestos = reponer.filter(r => r.estado === "Repuesto").length;
  document.getElementById("resumen-reposicion").innerHTML = `
    <div class="tarjeta-resumen"><strong>${reponer.length}</strong><span>A reponer</span></div>
    <div class="tarjeta-resumen"><strong>${pendientes}</strong><span>Pendientes</span></div>
    <div class="tarjeta-resumen"><strong>${repuestos}</strong><span>Ya repuestos</span></div>
    <div class="tarjeta-resumen"><strong>${reposicionesData.filter(r => r.tipo_registro === "NO REPONER").length}</strong><span>No reponer (referencia)</span></div>
  `;
}

function renderTabla() {
  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fTipo = document.getElementById("filtro-tipo").value;
  const fEstado = document.getElementById("filtro-estado").value;

  const filtrados = reposicionesData.filter(r =>
    (!fMc || r.mc.toLowerCase().includes(fMc)) &&
    (!fTipo || r.tipo_registro === fTipo) &&
    (!fEstado || r.estado === fEstado)
  );

  const tbody = document.getElementById("tbody-reposicion");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">Ningún equipo coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(r => {
    const comps = componentesPorReposicion[r.id] || [];
    const resumenComps = comps.map(c => `${c.tipo_componente} (${c.categoria})`).join(", ") || "—";

    if (r.id === expandidoId) {
      return `
        <tr>
          <td colspan="8">
            <div class="agregar-equipo-box">
              <strong>${r.mc}${r.motivo ? ` — ${r.motivo}` : ""}</strong>
              <table class="tabla-revision" style="margin-top:10px;">
                <thead><tr><th>Componente</th><th>Categoría</th><th>Serial real</th><th></th></tr></thead>
                <tbody>
                  ${comps.map(c => `
                    <tr>
                      <td>${c.tipo_componente}</td>
                      <td>${c.categoria}</td>
                      <td><input type="text" class="input-serial-comp" data-id="${c.id}" value="${c.serial_nuevo || ""}" placeholder="Aún sin definir"></td>
                      <td><button class="btn-guardar-serial-comp btn-secundario" data-id="${c.id}">Guardar</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
              ${r.tipo_registro === "REPONER" ? `
                <div class="materiales-controles" style="margin-top:14px;">
                  <input type="date" id="fecha-reposicion-${r.id}" value="${r.fecha_reposicion || ""}">
                  <button class="btn-marcar-repuesto btn-primario" data-id="${r.id}">
                    ${r.estado === "Repuesto" ? "✅ Repuesto — actualizar fecha" : "Marcar como Repuesto"}
                  </button>
                </div>
              ` : ""}
              <button class="btn-cerrar-detalle btn-secundario" style="margin-top:10px;">Cerrar</button>
            </div>
          </td>
        </tr>
      `;
    }

    return `
      <tr class="${r.tipo_registro === 'NO REPONER' ? 'fila-alerta' : ''}">
        <td>${r.mc}</td>
        <td>${r.caja || "—"}</td>
        <td>${r.tipo_registro}</td>
        <td>${r.fecha_entrega_original ? new Date(r.fecha_entrega_original).toLocaleDateString("es-ES") : "—"}</td>
        <td>${resumenComps}</td>
        <td>${r.estado === "Repuesto" ? "✅ Repuesto" : "🕒 Pendiente"}</td>
        <td>${r.fecha_reposicion ? new Date(r.fecha_reposicion).toLocaleDateString("es-ES") : "—"}</td>
        <td><button class="btn-ver-detalle btn-ver-tabla" data-id="${r.id}">Ver detalle →</button></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-ver-detalle").forEach(btn => {
    btn.addEventListener("click", () => { expandidoId = btn.dataset.id; renderTabla(); });
  });
  tbody.querySelectorAll(".btn-cerrar-detalle").forEach(btn => {
    btn.addEventListener("click", () => { expandidoId = null; renderTabla(); });
  });
  tbody.querySelectorAll(".btn-guardar-serial-comp").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const serial = fila.querySelector(".input-serial-comp").value.trim().toUpperCase();
      btn.disabled = true;
      btn.textContent = "Guardando...";
      await supabaseClient.from("reposicion_componentes").update({ serial_nuevo: serial || null }).eq("id", btn.dataset.id);
      await cargarReposiciones();
    });
  });
  tbody.querySelectorAll(".btn-marcar-repuesto").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fecha = document.getElementById(`fecha-reposicion-${btn.dataset.id}`).value;
      if (!fecha) { alert("Elige la fecha de reposición."); return; }
      btn.disabled = true;
      await supabaseClient.from("equipos_reposicion").update({ estado: "Repuesto", fecha_reposicion: fecha }).eq("id", btn.dataset.id);
      await cargarReposiciones();
    });
  });
}

["filtro-mc", "filtro-tipo", "filtro-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
