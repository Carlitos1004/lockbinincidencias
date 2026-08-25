// =========================================================================
// REVISIÓN DE TALLER
// Lista los componentes retirados de una OT. Por cada uno, el Manager
// elige un Destino y escribe qué se encontró — al guardar:
// 1. Actualiza el Estado del componente según el Destino elegido.
// 2. Si el Destino es de garantía ("Enviar a AMMI con garantía" o
//    "Dañado sin garantía"), crea/actualiza su fila en "garantias".
// 3. Vuelve a calcular Materiales de esa OT (por si cambia algo relevante).
// =========================================================================

const DESTINOS = [
  "✓ Equipo OK- Stock (nuevo)",
  "✓ Equipo OK - Stock (usado)",
  "✓ Equipo OK - Devolver al cliente",
  "❌ Equipo dañado - Enviar a AMMI (usado)",
  "❌ Equipo dañado - Enviar a AMMI (nuevo)",
  "❌ Equipo dañado - Enviar a AMMI (equipo con garantía)",
  "❌ Equipo dañado sin garantía (esperando presupuesto)",
  "❌ Equipo dañado - Desechar",
  "🚨 Sigue en revisión"
];

const MAPA_DESTINO_A_ESTADO = {
  "✓ Equipo OK- Stock (nuevo)": "Revisado",
  "✓ Equipo OK - Stock (usado)": "Revisado",
  "✓ Equipo OK - Devolver al cliente": "Revisado",
  "❌ Equipo dañado - Enviar a AMMI (usado)": "Revisado",
  "❌ Equipo dañado - Enviar a AMMI (nuevo)": "Revisado",
  "❌ Equipo dañado - Enviar a AMMI (equipo con garantía)": "Revisado",
  "❌ Equipo dañado sin garantía (esperando presupuesto)": "Revisado",
  "❌ Equipo dañado - Desechar": "Descartado",
  "🚨 Sigue en revisión": "Pendiente revisión"
};

// Destinos que además generan/actualizan una fila en "garantias"
const DESTINOS_GARANTIA = {
  "❌ Equipo dañado - Enviar a AMMI (equipo con garantía)": "SI",
  "❌ Equipo dañado sin garantía (esperando presupuesto)": "NO"
};

const otInput = document.getElementById("ot-input");
const buscarBtn = document.getElementById("buscar-btn");
const buscarMsg = document.getElementById("buscar-msg");
const tabla = document.getElementById("tabla-revision");
const tbody = document.getElementById("revision-tbody");

buscarBtn.addEventListener("click", buscarComponentes);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscarComponentes(); });

async function buscarComponentes() {
  const idOt = otInput.value.trim().toUpperCase();
  buscarMsg.hidden = true;
  tabla.hidden = true;

  if (!idOt) {
    mostrarMensaje("⚠️ Escribe un número de OT.", true);
    return;
  }

  const { data, error } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("id_ot", idOt)
    .order("m_control");

  if (error) {
    mostrarMensaje("❌ " + error.message, true);
    return;
  }
  if (!data || data.length === 0) {
    mostrarMensaje("No hay componentes retirados registrados para esa OT.", false);
    return;
  }

  renderTabla(data);
  tabla.hidden = false;
}

function renderTabla(componentes) {
  tbody.innerHTML = componentes.map(c => {
    const opciones = DESTINOS.map(d =>
      `<option value="${escaparHtml(d)}" ${c.destino === d ? "selected" : ""}>${escaparHtml(d)}</option>`
    ).join("");

    const bloqueado = c.estado === "Cambiado por el cliente" || c.estado === "Faltante/Perdido";

    return `
      <tr data-id="${c.id}">
        <td>${c.m_control}</td>
        <td>${c.tipo_componente}</td>
        <td class="celda-mono">${c.serial_retirado}</td>
        <td>${c.estado}</td>
        <td><textarea class="input-reparacion" rows="2" ${bloqueado ? "disabled" : ""}>${c.reparacion || ""}</textarea></td>
        <td>
          <select class="input-destino" ${bloqueado ? "disabled" : ""}>
            <option value="">— Sin elegir —</option>
            ${opciones}
          </select>
        </td>
        <td><button class="btn-guardar-fila" ${bloqueado ? "disabled" : ""}>Guardar</button></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-guardar-fila").forEach(btn => {
    btn.addEventListener("click", () => guardarFila(btn));
  });
}

async function guardarFila(btn) {
  const fila = btn.closest("tr");
  const componenteId = fila.dataset.id;
  const destino = fila.querySelector(".input-destino").value;
  const reparacion = fila.querySelector(".input-reparacion").value.trim();

  if (!destino) {
    alert("Elige un Destino antes de guardar.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando...";

  const nuevoEstado = MAPA_DESTINO_A_ESTADO[destino];

  // 1. Traemos el componente completo (para tener cliente, m_control, id_ot, serial)
  const { data: componente, error: errorLeer } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("id", componenteId)
    .single();

  if (errorLeer) {
    alert("Error al leer el componente: " + errorLeer.message);
    btn.disabled = false;
    btn.textContent = "Guardar";
    return;
  }

  // 2. Actualizamos el componente
  const { error: errorUpdate } = await supabaseClient
    .from("componentes_retirados")
    .update({ destino: destino, reparacion: reparacion, estado: nuevoEstado })
    .eq("id", componenteId);

  if (errorUpdate) {
    alert("Error al guardar: " + errorUpdate.message);
    btn.disabled = false;
    btn.textContent = "Guardar";
    return;
  }

  // 3. Si el destino es de garantía, creamos/actualizamos su fila en "garantias"
  //    (upsert por componente_id — nunca se toca "observacion" ni "nombre_imagen"
  //    si la fila ya existía, esos se editan a mano por separado)
  if (DESTINOS_GARANTIA[destino]) {
    const { data: existente } = await supabaseClient
      .from("garantias")
      .select("id")
      .eq("componente_id", componenteId)
      .maybeSingle();

    const datosGarantia = {
      componente_id: componenteId,
      id_ot: componente.id_ot,
      cliente: componente.cliente,
      m_control: componente.m_control,
      dispositivo_danado: componente.serial_retirado,
      falla: reparacion,
      garantia: DESTINOS_GARANTIA[destino]
    };

    if (existente) {
      await supabaseClient.from("garantias").update(datosGarantia).eq("id", existente.id);
    } else {
      await supabaseClient.from("garantias").insert(datosGarantia);
    }
  }

  // 4. Recalculamos materiales de esa OT (por si acaso)
  if (componente.id_ot) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: componente.id_ot });
  }

  btn.textContent = "✅ Guardado";
  setTimeout(() => { btn.textContent = "Guardar"; btn.disabled = false; }, 1500);
}

function mostrarMensaje(texto, esError) {
  buscarMsg.textContent = texto;
  buscarMsg.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  buscarMsg.hidden = false;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
