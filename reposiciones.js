// =========================================================================
// REPOSICIONES DE EQUIPO
// =========================================================================

let reposicionesData = [];
let componentesPorReposicion = {};
let expandidoId = null;
let esManager = false;

(async () => {
  // Agregar/quitar componentes de una reposición queda solo para Manager
  // (ya restringido también del lado de la base de datos, esto es solo
  // para no mostrarle al Operario botones que de todas formas no le van
  // a funcionar).
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const { data: perfil } = await supabaseClient.from("perfiles").select("rol").eq("id", session.user.id).single();
    esManager = perfil?.rol === "manager";
  }
  cargarReposiciones();
})();

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
                      <td>${esManager ? `<button class="btn-quitar-componente btn-secundario" data-id="${c.id}" title="Quitar componente">🗑️</button>` : ""}</td>
                    </tr>
                  `).join("")}
                  ${esManager ? `
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
                  ` : ""}
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
      if (reposicion) {
        await registrarVinculacionEnVidaDelEquipo(reposicion, fecha);
        await registrarEnRegistroComponentes(reposicion, fecha);
      }
      await cargarReposiciones();
    });
  });
}

// Cuando un equipo se repone de verdad (REPONER → Repuesto), cuenta como
// una nueva vinculación del equipo con ese cliente para Vida del Equipo —
// igual que cuando se instala un equipo completo en Ruta. No duplica si
// se vuelve a guardar la misma reposición (se busca por id_reposicion).
//
// Si lo que se repuso fue el Módulo de Control completo, el MC viejo deja
// de funcionar con ese cliente por ahora (hasta que se repare o se
// deseche) — se desvincula. El MC nuevo arranca su propia vinculación con
// ese cliente, con el mismo LE/CE/BA que tenía el equipo viejo, salvo los
// que esta misma reposición también esté cambiando (esos usan su serial
// nuevo en vez del que tenía antes).
async function registrarVinculacionEnVidaDelEquipo(reposicion, fecha) {
  const comps = componentesPorReposicion[reposicion.id] || [];
  const porTipo = {};
  comps.forEach(c => { porTipo[c.tipo_componente] = c.serial_nuevo || null; });

  const mcNuevo = porTipo["Módulo de Control"] || null;

  let serieLector = porTipo["Lector Electrónico"] || null;
  let serieCierre = porTipo["Cierre Electrónico"] || null;
  let serieBateria = porTipo["Batería"] || null;

  if (mcNuevo) {
    await registrarDesvinculacionPorReposicion(reposicion, fecha);

    // Lo que el equipo viejo tenía instalado, para que el MC nuevo se
    // vincule con lo mismo — salvo lo que ya se está reponiendo también.
    const { data: equipoViejo } = await supabaseClient
      .from("equipos")
      .select("serie_lector, serie_cierre, serie_bateria")
      .eq("m_control", reposicion.mc)
      .maybeSingle();

    if (equipoViejo) {
      serieLector = serieLector || equipoViejo.serie_lector || null;
      serieCierre = serieCierre || equipoViejo.serie_cierre || null;
      serieBateria = serieBateria || equipoViejo.serie_bateria || null;
    }
  }

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
    serie_lector: serieLector,
    serie_cierre: serieCierre,
    serie_bateria: serieBateria,
    mc_anterior: mcNuevo ? reposicion.mc : null,
    id_reposicion: reposicion.id,
    fecha: fecha,
    notas: `Reposición de equipo bajo garantía${reposicion.motivo ? " — " + reposicion.motivo : ""}`
  };

  await upsertHistorialEquipo(datosVinculacion, reposicion.id, "Vinculación");
}

async function registrarDesvinculacionPorReposicion(reposicion, fecha) {
  const { data: equipoInfo } = await supabaseClient
    .from("equipos")
    .select("imei")
    .eq("m_control", reposicion.mc)
    .maybeSingle();

  const datosDesvinculacion = {
    imei: equipoInfo?.imei || null,
    mc: reposicion.mc,
    tipo_evento: "Desvinculación",
    id_reposicion: reposicion.id,
    fecha: fecha,
    notas: `Módulo de Control dado de baja — repuesto por garantía${reposicion.motivo ? " — " + reposicion.motivo : ""}`
  };

  await upsertHistorialEquipo(datosDesvinculacion, reposicion.id, "Desvinculación");
}

async function upsertHistorialEquipo(datos, idReposicion, tipoEvento) {
  const { data: existente } = await supabaseClient
    .from("historial_equipo")
    .select("id")
    .eq("id_reposicion", idReposicion)
    .eq("tipo_evento", tipoEvento)
    .maybeSingle();

  if (existente) {
    await supabaseClient.from("historial_equipo").update(datos).eq("id", existente.id);
  } else {
    await supabaseClient.from("historial_equipo").insert(datos);
  }
}

// Cuando se repone de verdad, también lo anotamos como una acción más en
// el historial de ese componente (Registro Maestro de Componentes), en el
// mismo serial donde ya estaba la incidencia que originó la reposición —
// así se ve como continuación de esa misma historia, no como algo aparte.
// Si no se encuentra una incidencia previa para ese MC/tipo, se agrupa por
// el serial nuevo (si ya se anotó) o por el MC, para no perderlo. No
// duplica si se vuelve a guardar la misma reposición (se busca por
// id_reposicion).
async function registrarEnRegistroComponentes(reposicion, fecha) {
  const comps = componentesPorReposicion[reposicion.id] || [];
  const fechaTexto = new Date(fecha + "T00:00:00").toLocaleDateString("es-ES");

  for (const c of comps) {
    const { data: existente } = await supabaseClient
      .from("componentes_retirados")
      .select("id")
      .eq("id_reposicion", reposicion.id)
      .eq("tipo_componente", c.tipo_componente)
      .maybeSingle();

    const datosEvento = {
      fecha: fecha,
      cliente: reposicion.cliente || null,
      m_control: reposicion.mc,
      tipo_componente: c.tipo_componente,
      estado: "Repuesto por garantía",
      destino: "✅ Repuesto por garantía",
      reparacion: `${c.tipo_componente} ${c.categoria} repuesta el día ${fechaTexto}${c.serial_nuevo ? " con serial " + c.serial_nuevo : ""}${reposicion.motivo ? " — " + reposicion.motivo : ""}`,
      excluir_materiales: true,
      id_reposicion: reposicion.id
    };

    if (existente) {
      await supabaseClient.from("componentes_retirados").update(datosEvento).eq("id", existente.id);
      continue;
    }

    // Buscamos la incidencia más reciente de este mismo tipo de componente
    // en este MC para agrupar la reposición en el mismo serial — así
    // Registro Maestro de Componentes la muestra como una acción más
    // dentro de esa misma historia.
    const { data: incidenciaPrevia } = await supabaseClient
      .from("componentes_retirados")
      .select("serial_retirado")
      .eq("m_control", reposicion.mc)
      .eq("tipo_componente", c.tipo_componente)
      .not("serial_retirado", "is", null)
      .neq("serial_retirado", "")
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();

    datosEvento.serial_retirado = incidenciaPrevia?.serial_retirado || c.serial_nuevo || reposicion.mc;

    await supabaseClient.from("componentes_retirados").insert(datosEvento);
  }
}

["filtro-mc", "filtro-tipo", "filtro-estado"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTabla);
});
