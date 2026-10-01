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
                <thead><tr><th>Componente</th><th>Categoría</th><th>Serial real</th><th></th><th></th></tr></thead>
                <tbody>
                  ${comps.map(c => `
                    <tr>
                      <td>${c.tipo_componente}</td>
                      <td>${c.categoria}</td>
                      <td><input type="text" class="input-serial-comp" data-id="${c.id}" value="${c.serial_nuevo || ""}" placeholder="Aún sin definir"></td>
                      <td><button class="btn-guardar-serial-comp btn-secundario" data-id="${c.id}">Guardar</button></td>
                      <td><button class="btn-quitar-componente btn-secundario" data-id="${c.id}" title="Quitar componente">🗑️</button></td>
                    </tr>
                  `).join("")}
                  <tr>
                    <td>
                      <select class="input-nuevo-tipo-comp">
                        <option value="Módulo de Control">Módulo de Control</option>
                        <option value="Lector Electrónico">Lector Electrónico</option>
                        <option value="Cierre Electrónico">Cierre Electrónico</option>
                        <option value="Batería">Batería</option>
                      </select>
                    </td>
                    <td>
                      <select class="input-nuevo-categoria-comp">
                        <option value="1ra categoría">1ra categoría</option>
                        <option value="2da categoría">2da categoría</option>
                      </select>
                    </td>
                    <td colspan="3">
                      <button class="btn-agregar-componente-reposicion btn-secundario" data-id="${r.id}">+ Agregar componente</button>
                    </td>
                  </tr>
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
  tbody.querySelectorAll(".btn-quitar-componente").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este componente de la reposición?")) return;
      btn.disabled = true;
      await supabaseClient.from("reposicion_componentes").delete().eq("id", btn.dataset.id);
      await cargarReposiciones();
    });
  });
  tbody.querySelectorAll(".btn-agregar-componente-reposicion").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fila = btn.closest("tr");
      const tipo = fila.querySelector(".input-nuevo-tipo-comp").value;
      const categoria = fila.querySelector(".input-nuevo-categoria-comp").value;
      btn.disabled = true;
      btn.textContent = "Agregando...";
      await supabaseClient.from("reposicion_componentes").insert({
        reposicion_id: btn.dataset.id,
        tipo_componente: tipo,
        categoria: categoria
      });
      await cargarReposiciones();
    });
  });
  tbody.querySelectorAll(".btn-marcar-repuesto").forEach(btn => {
    btn.addEventListener("click", async () => {
      const fecha = document.getElementById(`fecha-reposicion-${btn.dataset.id}`).value;
      if (!fecha) { alert("Elige la fecha de reposición."); return; }
      btn.disabled = true;
      const reposicion = reposicionesData.find(r => r.id === btn.dataset.id);
      await supabaseClient.from("equipos_reposicion").update({ estado: "Repuesto", fecha_reposicion: fecha }).eq("id", btn.dataset.id);
      if (reposicion) await registrarVinculacionEnVidaDelEquipo(reposicion, fecha);
      await cargarReposiciones();
    });
  });
}

// Cuando un equipo se repone de verdad (REPONER → Repuesto), cuenta como
// una nueva vinculación del equipo con ese cliente para Vida del Equipo —
// igual que cuando se instala un equipo completo en Ruta. No duplica si
// se vuelve a guardar la misma reposición (se busca por id_reposicion).
async function registrarVinculacionEnVidaDelEquipo(reposicion, fecha) {
  const comps = componentesPorReposicion[reposicion.id] || [];
  const porTipo = {};
  comps.forEach(c => { porTipo[c.tipo_componente] = c.serial_nuevo || null; });

  // Si entre los componentes a reponer está el Módulo de Control, el MC
  // en sí cambió — no fue solo una pieza. Usamos el serial nuevo anotado
  // como el MC del evento (y guardamos el viejo en mc_anterior); si no
  // hay Módulo de Control en la lista, el MC del equipo sigue siendo el
  // mismo de siempre. Solo registramos lo que pasó, sin más lógica.
  const mcNuevo = porTipo["Módulo de Control"] || null;
  const mcEvento = mcNuevo || reposicion.mc;

  const { data: equipoInfo } = await supabaseClient
    .from("equipos")
    .select("imei")
    .eq("m_control", mcEvento)
    .maybeSingle();

  const datosVinculacion = {
    imei: equipoInfo?.imei || null,
    mc: mcEvento,
    tipo_evento: "Vinculación",
    cliente: reposicion.cliente || null,
    serie_lector: porTipo["Lector Electrónico"] || null,
    serie_cierre: porTipo["Cierre Electrónico"] || null,
    serie_bateria: porTipo["Batería"] || null,
    mc_anterior: mcNuevo ? reposicion.mc : null,
    id_reposicion: reposicion.id,
    fecha: fecha,
    notas: `Reposición de equipo bajo garantía${reposicion.motivo ? " — " + reposicion.motivo : ""}`
  };

  const { data: existente } = await supabaseClient
    .from("historial_equipo")
    .select("id")
    .eq("id_reposicion", reposicion.id)
    .eq("tipo_evento", "Vinculación")
    .maybeSingle();

  if (existente) {
    await supabaseClient.from("historial_equipo").update(datosVinculacion).eq("id", existente.id);
  } else {
    await supabaseClient.from("historial_equipo").insert(datosVinculacion);
  }
}

["filtro-mc", "filtro-tipo", "filtro-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
