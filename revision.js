// =========================================================================
// REVISIÓN DE TALLER
// Lista los componentes retirados de una OT. Por cada uno, el Manager
// elige un Destino y escribe qué se encontró — al guardar:
// 1. Actualiza el Estado del componente según el Destino elegido.
// 2. Si el Destino es "Enviar a AMMI", pide además la Categoría (1ra/2da)
//    y si cubre garantía del cliente — son 2 preguntas distintas, no la
//    misma: la categoría se la decimos a AMMI para que sepa si nos cobra,
//    la garantía es nuestro propio control con el cliente final.
// 3. Vuelve a calcular Materiales de esa OT (por si cambia algo relevante).
// =========================================================================

const DESTINOS = [
  "✓ Equipo OK - Stock (1ra categoría)",
  "✓ Equipo OK - Stock (2da categoría)",
  "✓ Equipo OK - Devolver al cliente",
  "❌ Equipo dañado - Enviar a AMMI",
  "❌ Equipo dañado - Desechar",
  "🚨 Sigue en revisión"
];

const MAPA_DESTINO_A_ESTADO = {
  "✓ Equipo OK - Stock (1ra categoría)": "Revisado",
  "✓ Equipo OK - Stock (2da categoría)": "Revisado",
  "✓ Equipo OK - Devolver al cliente": "Revisado",
  "❌ Equipo dañado - Enviar a AMMI": "Revisado",
  "❌ Equipo dañado - Desechar": "Descartado",
  "🚨 Sigue en revisión": "Pendiente revisión"
};

const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

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

  const normales = data.filter(c => c.estado !== "Faltante/Perdido");
  const faltantes = data.filter(c => c.estado === "Faltante/Perdido");

  renderTabla(normales);
  tabla.hidden = normales.length === 0;
  if (normales.length === 0 && faltantes.length > 0) {
    mostrarMensaje("Todos los componentes de esta OT son faltantes/perdidos — no hay nada que revisar (ver abajo).", false);
  }

  renderFaltantes(faltantes);
}

function renderTabla(componentes) {
  tbody.innerHTML = componentes.map(c => {
    const opciones = DESTINOS.map(d =>
      `<option value="${escaparHtml(d)}" ${c.destino === d ? "selected" : ""}>${escaparHtml(d)}</option>`
    ).join("");

    const bloqueado = c.estado === "Faltante/Perdido";
    const esParaDevolver = c.destino === "✓ Equipo OK - Devolver al cliente";
    const esAmmi = c.destino === DESTINO_AMMI;

    const celdaDevuelto = esParaDevolver
      ? (c.devuelto
          ? `<span class="devuelto-etiqueta devuelto-si">✅ Devuelto (${new Date(c.devuelto_en).toLocaleDateString("es-ES")})</span>`
          : `<button class="btn-marcar-devuelto" data-id="${c.id}">📦 Listo — Marcar como devuelto</button>`)
      : "—";

    const celdaAmmi = `
      <div class="detalle-ammi" ${esAmmi ? "" : "hidden"}>
        <select class="input-categoria-ammi" ${bloqueado ? "disabled" : ""}>
          <option value="">— Categoría —</option>
          <option value="1ra categoría" ${c.categoria_ammi === "1ra categoría" ? "selected" : ""}>1ra categoría</option>
          <option value="2da categoría" ${c.categoria_ammi === "2da categoría" ? "selected" : ""}>2da categoría</option>
        </select>
        <select class="input-garantia-cliente" ${bloqueado ? "disabled" : ""}>
          <option value="">— ¿Garantía? —</option>
          <option value="SI" ${c.garantia_cliente === "SI" ? "selected" : ""}>Sí cubre</option>
          <option value="NO" ${c.garantia_cliente === "NO" ? "selected" : ""}>No cubre</option>
        </select>
      </div>
    `;

    return `
      <tr data-id="${c.id}">
        <td><input type="text" class="input-mc-fila" value="${c.m_control || ""}" placeholder="Ej: MC2500642"></td>
        <td>${c.tipo_componente}</td>
        <td><input type="text" class="input-serial-fila celda-mono" value="${c.serial_retirado || ""}"></td>
        <td>${c.estado}</td>
        <td><textarea class="input-reparacion" rows="2" ${bloqueado ? "disabled" : ""}>${c.reparacion || ""}</textarea></td>
        <td>
          <select class="input-destino" ${bloqueado ? "disabled" : ""}>
            <option value="">— Sin elegir —</option>
            ${opciones}
          </select>
        </td>
        <td>${celdaAmmi}</td>
        <td>${celdaDevuelto}</td>
        <td>
          <input type="file" class="input-foto-revision" accept="image/*" capture="environment">
          ${c.foto_revision ? `<a href="${c.foto_revision}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto actual →</a>` : ""}
        </td>
        <td><button class="btn-guardar-fila" ${bloqueado ? "disabled" : ""}>Guardar</button></td>
        <td><button class="btn-eliminar-ticket btn-eliminar-componente" data-id="${c.id}" title="Eliminar este componente">🗑️</button></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-marcar-devuelto").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Guardando...";
      const { error } = await supabaseClient
        .from("componentes_retirados")
        .update({ devuelto: true, devuelto_en: new Date().toISOString() })
        .eq("id", btn.dataset.id);
      if (error) {
        alert("Error: " + error.message);
        btn.disabled = false;
        btn.textContent = "📦 Listo — Marcar como devuelto";
        return;
      }
      buscarComponentes();
    });
  });

  tbody.querySelectorAll(".btn-eliminar-componente").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este componente? No se puede deshacer.")) return;
      const id = btn.dataset.id;
      // Si tiene garantía asociada, hay que borrarla primero (la relación
      // entre las dos tablas no deja borrar el componente si no)
      await supabaseClient.from("garantias").delete().eq("componente_id", id);
      const { error } = await supabaseClient.from("componentes_retirados").delete().eq("id", id);
      if (error) {
        alert("Error al eliminar: " + error.message);
        return;
      }
      buscarComponentes();
    });
  });

  tbody.querySelectorAll(".input-destino").forEach(select => {
    select.addEventListener("change", () => {
      const fila = select.closest("tr");
      fila.querySelector(".detalle-ammi").hidden = select.value !== DESTINO_AMMI;
    });
  });

  tbody.querySelectorAll(".btn-guardar-fila").forEach(btn => {
    btn.addEventListener("click", () => guardarFila(btn));
  });
}

async function guardarFila(btn) {
  const fila = btn.closest("tr");
  const componenteId = fila.dataset.id;
  const destino = fila.querySelector(".input-destino").value;
  const reparacion = fila.querySelector(".input-reparacion").value.trim();
  const mcEditado = fila.querySelector(".input-mc-fila").value.trim().toUpperCase();
  const serialEditado = fila.querySelector(".input-serial-fila").value.trim().toUpperCase();
  const categoriaAmmi = fila.querySelector(".input-categoria-ammi").value;
  const garantiaCliente = fila.querySelector(".input-garantia-cliente").value;

  if (!destino) {
    alert("Elige un Destino antes de guardar.");
    return;
  }
  if (destino === DESTINO_AMMI && (!categoriaAmmi || !garantiaCliente)) {
    alert("Para \"Enviar a AMMI\", elige también la Categoría y si cubre garantía del cliente.");
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

  const datosActualizacion = {
    destino: destino, reparacion: reparacion, estado: nuevoEstado,
    m_control: mcEditado || null, serial_retirado: serialEditado || null,
    categoria_ammi: destino === DESTINO_AMMI ? categoriaAmmi : null,
    garantia_cliente: destino === DESTINO_AMMI ? garantiaCliente : null
  };
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

  // 3. Si se envía a AMMI, creamos/actualizamos su fila en "garantias" —
  //    el "criterio" se reconstruye a partir de la elección de garantía
  //    (no del texto del destino, que ya no la incluye)
  if (destino === DESTINO_AMMI) {
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
      fechaEntrega = await buscarFechaEntrega(mcEditado || componente.m_control, serialEditado || componente.serial_retirado);
    }

    const criterioRevisionTexto = garantiaCliente === "SI"
      ? "❌ Equipo dañado - Enviar a AMMI (con garantía)"
      : "❌ Equipo dañado sin garantía (esperando presupuesto)";

    const datosGarantia = {
      componente_id: componenteId,
      id_ot: componente.id_ot,
      cliente: componente.cliente,
      m_control: mcEditado || componente.m_control,
      dispositivo_danado: serialEditado || componente.serial_retirado,
      falla: reparacion,
      criterio_revision: criterioRevisionTexto,
      fecha_entrega: fechaEntrega,
      garantia: esGarantiaAplicable(criterioRevisionTexto, fechaEntrega) ? "SI" : "NO"
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

function renderFaltantes(faltantes) {
  const box = document.getElementById("faltantes-box");
  const tbody = document.getElementById("faltantes-tbody");

  if (faltantes.length === 0) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  tbody.innerHTML = faltantes.map(c => `
    <tr>
      <td>${c.m_control || "—"}</td>
      <td>${c.tipo_componente}</td>
      <td class="celda-mono">${c.serial_retirado || "—"}</td>
      <td>${new Date(c.fecha).toLocaleDateString("es-ES")}</td>
    </tr>
  `).join("");
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
