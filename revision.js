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
const DESTINOS_GARANTIA = new Set([
  "❌ Equipo dañado - Enviar a AMMI (equipo con garantía)",
  "❌ Equipo dañado sin garantía (esperando presupuesto)"
]);

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
        <td>
          <input type="file" class="input-foto-revision" accept="image/*" capture="environment">
          ${c.foto_revision ? `<a href="${c.foto_revision}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto actual →</a>` : ""}
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

  // Subir foto de revisión, si se eligió una
  let fotoRevisionUrl = null;
  const archivoFoto = fila.querySelector(".input-foto-revision").files[0];
  if (archivoFoto) {
    try {
      const nombreArchivo = `revision_${Date.now()}_${archivoFoto.name}`;
      const { error: errorSubida } = await supabaseClient.storage.from("fotos-reportes").upload(nombreArchivo, archivoFoto);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabaseClient.storage.from("fotos-reportes").getPublicUrl(nombreArchivo);
      fotoRevisionUrl = urlData.publicUrl;
    } catch (err) {
      alert("⚠️ No se pudo subir la foto, se sigue guardando el resto: " + err.message);
    }
  }

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

  const datosActualizacion = { destino: destino, reparacion: reparacion, estado: nuevoEstado };
  if (fotoRevisionUrl) datosActualizacion.foto_revision = fotoRevisionUrl;

  // 2. Actualizamos el componente
  const { error: errorUpdate } = await supabaseClient
    .from("componentes_retirados")
    .update(datosActualizacion)
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
  if (DESTINOS_GARANTIA.has(destino)) {
    const { data: existente } = await supabaseClient
      .from("garantias")
      .select("id, fecha_entrega")
      .eq("componente_id", componenteId)
      .maybeSingle();

    // Solo auto-completamos la fecha de entrega si todavía no hay una
    // guardada — si el Manager ya la puso a mano (porque no se encontró
    // sola), no se la pisamos.
    let fechaEntrega = existente?.fecha_entrega || null;
    if (!fechaEntrega) {
      fechaEntrega = await buscarFechaEntrega(componente.m_control, componente.serial_retirado);
    }

    const datosGarantia = {
      componente_id: componenteId,
      id_ot: componente.id_ot,
      cliente: componente.cliente,
      m_control: componente.m_control,
      dispositivo_danado: componente.serial_retirado,
      falla: reparacion,
      criterio_revision: destino, // el "criterio" ES el destino elegido en la revisión
      fecha_entrega: fechaEntrega,
      garantia: esGarantiaAplicable(destino, fechaEntrega) ? "SI" : "NO"
    };

    if (existente) {
      await supabaseClient.from("garantias").update(datosGarantia).eq("id", existente.id);
    } else {
      await supabaseClient.from("garantias").insert(datosGarantia);
    }
  }

  // 4. Reflejamos el resultado de la revisión en el ticket de historial_fallas
  //    correspondiente (antes esto no se estaba guardando ahí, solo en
  //    componentes_retirados).
  if (componente.id_registro) {
    await supabaseClient
      .from("historial_fallas")
      .update({ destino: destino, estatus_revision: nuevoEstado })
      .eq("id_registro", componente.id_registro);
  }

  // 5. Recalculamos materiales de esa OT (por si acaso)
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
