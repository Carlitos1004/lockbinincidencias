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
  "✓ Cambiado por el cliente - No llega a revisión",
  "❌ Equipo dañado - Enviar a AMMI",
  "❌ Equipo dañado - Desechar",
  "🚨 Sigue en revisión"
];

const MAPA_DESTINO_A_ESTADO = {
  "✓ Equipo OK - Stock (1ra categoría)": "Revisado",
  "✓ Equipo OK - Stock (2da categoría)": "Revisado",
  "✓ Equipo OK - Devolver al cliente": "Revisado",
  "✓ Cambiado por el cliente - No llega a revisión": "Revisado",
  "❌ Equipo dañado - Enviar a AMMI": "Revisado",
  "❌ Equipo dañado - Desechar": "Descartado",
  "🚨 Sigue en revisión": "Pendiente revisión"
};

const DESTINO_AMMI = "❌ Equipo dañado - Enviar a AMMI";

const otInput = document.getElementById("ot-input");

let clientesReales = [];
let mostrarClienteHistorico = false;
let modoTodosPendientes = false;
let otsInternasLibres = new Set();
// Fotos de revisión por componente (tabla fotos_revision): { componente_id: [fotos] }
let fotosPorComponente = {};

async function cargarFotosRevision(componentes) {
  fotosPorComponente = {};
  const ids = (componentes || []).map(c => c.id);
  if (ids.length === 0) return;
  const { data } = await supabaseClient
    .from("fotos_revision")
    .select("id, componente_id, url, fecha")
    .in("componente_id", ids)
    .order("fecha", { ascending: true });
  (data || []).forEach(f => {
    (fotosPorComponente[f.componente_id] = fotosPorComponente[f.componente_id] || []).push(f);
  });
}

async function cargarClientesReales() {
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todos = [];
  while (true) {
    const { data, error } = await supabaseClient.from("equipos").select("cliente").range(desde, desde + TAM_PAGINA - 1);
    if (error) break;
    todos = todos.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  clientesReales = [...new Set(todos.map(e => e.cliente).filter(Boolean))].sort();
}
cargarClientesReales();
const buscarBtn = document.getElementById("buscar-btn");
const buscarMsg = document.getElementById("buscar-msg");
const tabla = document.getElementById("tabla-revision");
const tbody = document.getElementById("revision-tbody");

buscarBtn.addEventListener("click", buscarComponentes);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscarComponentes(); });
document.getElementById("ver-pendientes-btn").addEventListener("click", verTodosPendientes);

// Si llegamos desde el enlace del dashboard ("Componentes en Pendiente
// revisión"), mostramos directo la lista completa sin que haya que buscar.
if (new URLSearchParams(window.location.search).get("pendientes") === "1") {
  verTodosPendientes();
}

async function verTodosPendientes() {
  otInput.value = "";
  buscarMsg.hidden = true;
  tabla.hidden = true;
  document.getElementById("guardar-todo-btn").hidden = true;
  document.getElementById("faltantes-box").hidden = true;
  modoTodosPendientes = true;

  const { data, error } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("estado", "Pendiente revisión")
    .order("fecha", { ascending: true });

  if (error) {
    mostrarMensaje("❌ " + error.message, true);
    return;
  }
  if (!data || data.length === 0) {
    mostrarMensaje("🎉 No hay ningún componente pendiente de revisión en este momento.", false);
    return;
  }

  // Algunas OT "libres" internas usan un select de Cliente Histórico en
  // vez del cliente normal — detectamos cuáles, para mostrarlo solo en
  // esas filas (antes esto se decidía una sola vez por OT buscada).
  const idsOt = [...new Set(data.map(c => c.id_ot).filter(Boolean))];
  const { data: ots } = idsOt.length > 0
    ? await supabaseClient.from("ordenes_trabajo").select("id_ot, cliente, origen").in("id_ot", idsOt)
    : { data: [] };
  otsInternasLibres = new Set(
    (ots || []).filter(o => o.origen === "libre" && o.cliente === "INTERNO").map(o => o.id_ot)
  );

  await cargarFotosRevision(data);
  renderTabla(data, true);
  tabla.hidden = false;
  document.getElementById("guardar-todo-btn").hidden = false;
  mostrarMensaje(`Mostrando ${data.length} componente(s) pendientes de revisión, de todas las OT.`, false);
}

async function buscarComponentes() {
  const idOt = otInput.value.trim().toUpperCase();
  buscarMsg.hidden = true;
  tabla.hidden = true;
  document.getElementById("guardar-todo-btn").hidden = true;
  modoTodosPendientes = false;

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

  const { data: ot } = await supabaseClient
    .from("ordenes_trabajo")
    .select("cliente, origen")
    .eq("id_ot", idOt)
    .maybeSingle();
  mostrarClienteHistorico = ot?.origen === "libre" && ot?.cliente === "INTERNO";

  const normales = data.filter(c => c.estado !== "Faltante/Perdido");
  const faltantes = data.filter(c => c.estado === "Faltante/Perdido");

  await cargarFotosRevision(normales);
  renderTabla(normales);
  tabla.hidden = normales.length === 0;
  document.getElementById("guardar-todo-btn").hidden = normales.length === 0;
  if (normales.length === 0 && faltantes.length > 0) {
    mostrarMensaje("Todos los componentes de esta OT son faltantes/perdidos — no hay nada que revisar (ver abajo).", false);
  }

  renderFaltantes(faltantes);
}

function celdaFotosRevision(c) {
  const fotos = fotosPorComponente[c.id] || [];
  // Si aún no se corrió el SQL de fotos múltiples (o es una foto vieja sin copiar), usamos la foto única
  if (fotos.length === 0) {
    return c.foto_revision ? `<a href="${c.foto_revision}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto actual →</a>` : "";
  }
  const items = fotos.map((f, i) => `
    <span class="foto-revision-item">
      <a href="${f.url}" target="_blank" rel="noopener">Foto ${i + 1}</a>
      <button type="button" class="btn-borrar-foto-revision" data-id="${f.id}" data-comp="${c.id}" title="Borrar esta foto">✕</button>
    </span>`).join(" ");
  const todas = fotos.length > 1
    ? `<a href="ver-fotos.html?origen=revision&id=${c.id}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver todas (${fotos.length}) →</a>`
    : "";
  return `<div class="fotos-revision-lista">${items}</div>${todas}`;
}

function renderTabla(componentes, mostrarOt = false) {
  document.getElementById("th-ot").hidden = !mostrarOt;
  document.getElementById("th-ot-filtro").hidden = !mostrarOt;

  tbody.innerHTML = componentes.map(c => {
    const celdaOt = mostrarOt
      ? `<td><a href="ot-detalle.html?ot=${c.id_ot}" target="_blank" rel="noopener">${c.id_ot || "—"}</a></td>`
      : "";
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

    const opcionesCliente = clientesReales.map(cl =>
      `<option value="${escaparHtml(cl)}" ${c.cliente_original === cl ? "selected" : ""}>${escaparHtml(cl)}</option>`
    ).join("");

    const clienteHistoricoVisibleFila = modoTodosPendientes ? otsInternasLibres.has(c.id_ot) : mostrarClienteHistorico;
    const celdaClienteHistorico = clienteHistoricoVisibleFila
      ? `<select class="input-cliente-original" ${bloqueado ? "disabled" : ""}>
          <option value="">— Cliente histórico —</option>
          ${opcionesCliente}
        </select>`
      : "—";

    const celdaEnCalle = `
      <select class="input-en-calle" ${bloqueado ? "disabled" : ""}>
        <option value="" ${c.estuvo_en_calle === null || c.estuvo_en_calle === undefined ? "selected" : ""}>— Sin definir —</option>
        <option value="true" ${c.estuvo_en_calle === true ? "selected" : ""}>Sí, en calle</option>
        <option value="false" ${c.estuvo_en_calle === false ? "selected" : ""}>No, en nave/stock</option>
      </select>
    `;

    const OPCIONES_CONDICION = ["Golpe / Equipo roto", "Síntoma de agua", "Cable roto", "Conector suelto"];
    const condicionesActuales = c.condicion_fisica || [];
    const resumenCondicion = condicionesActuales.length > 0 ? condicionesActuales.join(", ") : "— Sin problema —";
    const celdaCondicionFisica = `
      <details class="condicion-fisica-desplegable">
        <summary class="condicion-fisica-resumen">${resumenCondicion}</summary>
        <div class="condicion-fisica-checklist">
          ${OPCIONES_CONDICION.map(op => `
            <label class="opcion-check">
              <input type="checkbox" class="input-condicion-fisica" value="${op}" ${condicionesActuales.includes(op) ? "checked" : ""} ${bloqueado ? "disabled" : ""}>
              ${op}
            </label>
          `).join("")}
        </div>
      </details>
    `;

    const OPCIONES_CAUSA = ["Mal funcionamiento", "Error de manipulación (Formato Verde)", "Mal uso del cliente", "Sin carga / batería agotada"];
    const causasActuales = c.causa_falla || [];
    const resumenCausa = causasActuales.length > 0 ? causasActuales.join(", ") : "— Sin definir —";
    const celdaCausaFalla = `
      <details class="condicion-fisica-desplegable">
        <summary class="condicion-fisica-resumen">${resumenCausa}</summary>
        <div class="condicion-fisica-checklist">
          ${OPCIONES_CAUSA.map(op => `
            <label class="opcion-check">
              <input type="checkbox" class="input-causa-falla" value="${op}" ${causasActuales.includes(op) ? "checked" : ""} ${bloqueado ? "disabled" : ""}>
              ${op}
            </label>
          `).join("")}
        </div>
      </details>
    `;

    return `
      <tr data-id="${c.id}">
        <td><input type="text" class="input-mc-fila" value="${c.m_control || ""}" placeholder="Ej: MC2500642"></td>
        ${celdaOt}
        <td>${c.tipo_componente}</td>
        <td><input type="text" class="input-serial-fila celda-mono" value="${c.serial_retirado || ""}"></td>
        <td>${c.estado}</td>
        <td>${celdaClienteHistorico}</td>
        <td>${celdaEnCalle}</td>
        <td>${celdaCondicionFisica}</td>
        <td>${celdaCausaFalla}</td>
        <td style="text-align:center;"><input type="checkbox" class="input-vandalismo" ${c.vandalismo ? "checked" : ""} ${bloqueado ? "disabled" : ""} title="Vandalismo / mal uso"></td>
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
          <input type="file" class="input-foto-revision" accept="image/*" capture="environment" multiple>
          ${celdaFotosRevision(c)}
        </td>
        <td><button class="btn-guardar-fila" ${bloqueado ? "disabled" : ""}>Guardar</button></td>
        <td><button class="btn-eliminar-ticket btn-eliminar-componente" data-id="${c.id}" title="Eliminar este componente">🗑️</button></td>
      </tr>
    `;
  }).join("");

  prepararFiltrosRevision();
  setTimeout(ajustarEncabezadoSticky, 0);

  tbody.querySelectorAll(".condicion-fisica-desplegable").forEach(detalle => {
    const resumen = detalle.querySelector(".condicion-fisica-resumen");
    const checkClass = detalle.querySelector(".input-condicion-fisica") ? "input-condicion-fisica" : "input-causa-falla";
    const textoVacio = checkClass === "input-condicion-fisica" ? "— Sin problema —" : "— Sin definir —";
    detalle.querySelectorAll(`.${checkClass}`).forEach(chk => {
      chk.addEventListener("change", () => {
        const marcadas = [...detalle.querySelectorAll(`.${checkClass}:checked`)].map(c => c.value);
        resumen.textContent = marcadas.length > 0 ? marcadas.join(", ") : textoVacio;
      });
    });
  });

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
      refrescarListaActual();
    });
  });

  tbody.querySelectorAll(".btn-borrar-foto-revision").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar esta foto? No se puede deshacer.")) return;
      btn.disabled = true;
      const { error } = await supabaseClient.from("fotos_revision").delete().eq("id", btn.dataset.id);
      if (error) {
        alert("Error al borrar la foto: " + error.message);
        btn.disabled = false;
        return;
      }
      // foto_revision guarda la primera foto: la dejamos apuntando a la que quede (o vacía)
      const { data: restante } = await supabaseClient
        .from("fotos_revision")
        .select("url")
        .eq("componente_id", btn.dataset.comp)
        .order("fecha", { ascending: true })
        .limit(1);
      await supabaseClient
        .from("componentes_retirados")
        .update({ foto_revision: restante && restante[0] ? restante[0].url : null })
        .eq("id", btn.dataset.comp);
      refrescarListaActual();
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
      refrescarListaActual();
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
  const clienteOriginal = fila.querySelector(".input-cliente-original")?.value || "";
  const enCalleValor = fila.querySelector(".input-en-calle").value;
  const estuvoEnCalle = enCalleValor === "" ? null : enCalleValor === "true";
  const condicionFisica = [...fila.querySelectorAll(".input-condicion-fisica:checked")].map(chk => chk.value);
  const causaFalla = [...fila.querySelectorAll(".input-causa-falla:checked")].map(chk => chk.value);
  const esVandalismo = !!fila.querySelector(".input-vandalismo")?.checked;

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

  // Subir las fotos de revisión que se hayan elegido (se AÑADEN a las que ya haya)
  const fotosNuevasUrls = [];
  const archivosFoto = [...fila.querySelector(".input-foto-revision").files];
  for (let i = 0; i < archivosFoto.length; i++) {
    try {
      const nombreArchivo = `revision_${Date.now()}_${i}_${archivosFoto[i].name}`;
      const { error: errorSubida } = await supabaseClient.storage.from("fotos-reportes").upload(nombreArchivo, archivosFoto[i]);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabaseClient.storage.from("fotos-reportes").getPublicUrl(nombreArchivo);
      fotosNuevasUrls.push(urlData.publicUrl);
    } catch (err) {
      alert(`⚠️ No se pudo subir la foto ${archivosFoto[i].name}, se sigue guardando el resto: ` + err.message);
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
    garantia_cliente: destino === DESTINO_AMMI ? garantiaCliente : null,
    cliente_original: clienteOriginal || null,
    estuvo_en_calle: estuvoEnCalle,
    condicion_fisica: condicionFisica.length > 0 ? condicionFisica : null,
    causa_falla: causaFalla.length > 0 ? causaFalla : null,
    vandalismo: esVandalismo
  };
  // foto_revision guarda solo la PRIMERA foto (para lo que ya la lee); no la pisamos si ya hay una
  if (fotosNuevasUrls.length > 0 && !componente.foto_revision) datosActualizacion.foto_revision = fotosNuevasUrls[0];

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

  // 2b. Guardamos cada foto nueva en fotos_revision
  if (fotosNuevasUrls.length > 0) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error: errorFotos } = await supabaseClient.from("fotos_revision").insert(
      fotosNuevasUrls.map(url => ({ componente_id: componenteId, url, subido_por: user ? user.email : null }))
    );
    if (errorFotos) alert("⚠️ El resto se guardó, pero las fotos no se pudieron registrar: " + errorFotos.message + "\n(¿Corriste el SQL 70?)");
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

    // Vandalismo del ticket = hay vandalismo si CUALQUIER componente de ese
    // ticket está marcado. Si se desmarca el último, el ticket pasa a "No".
    const { data: hermanos } = await supabaseClient
      .from("componentes_retirados")
      .select("vandalismo")
      .eq("id_registro", componente.id_registro);
    const hayVandalismo = (hermanos || []).some(x => x.vandalismo);
    await supabaseClient.from("historial_fallas").update({ vandalismo: hayVandalismo }).eq("id_registro", componente.id_registro);
  }

  // 5. Recalculamos materiales de esa OT (por si acaso)
  if (componente.id_ot) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: componente.id_ot });
  }

  // 6. Historial de vida del equipo — cuando el Módulo de Control (el
  // identificador que "manda" del equipo) vuelve a Stock o se manda a
  // AMMI, registramos el evento solo, sin que nadie tenga que anotarlo.
  // Un solo evento por (equipo + OT): si se vuelve a guardar la misma
  // fila sin que cambie el destino, no duplica; si cambia el destino
  // (ej. de Stock a AMMI) para la MISMA OT, se sobreescribe el que ya
  // había en vez de sumar uno nuevo. Si es otra OT, sí es un evento
  // aparte y se agrega.
  if (componente.tipo_componente === "Módulo de Control") {
    const esDestinoStock = destino === "✓ Equipo OK - Stock (1ra categoría)" || destino === "✓ Equipo OK - Stock (2da categoría)";
    if (esDestinoStock || destino === DESTINO_AMMI) {
      const mcEquipo = mcEditado || componente.m_control;
      const tipoEventoNuevo = esDestinoStock ? "Desvinculación" : "Enviado a AMMI";

      const { data: eventoExistente } = await supabaseClient
        .from("historial_equipo")
        .select("id, tipo_evento")
        .eq("mc", mcEquipo)
        .eq("id_ot", componente.id_ot)
        .in("tipo_evento", ["Desvinculación", "Enviado a AMMI"])
        .maybeSingle();

      if (!eventoExistente || eventoExistente.tipo_evento !== tipoEventoNuevo) {
        const { data: equipoInfo } = await supabaseClient
          .from("equipos")
          .select("imei")
          .eq("m_control", mcEquipo)
          .maybeSingle();

        // Si ya no está en Equipos (la plataforma lo quita al desvincular)
        // o vino sin IMEI, buscamos el IMEI que nosotros mismos guardamos
        // cuando ese MC se vinculó por primera vez — mientras sí estaba
        // en la lista. Así no dependemos de exportar nada aparte.
        let imeiFinal = equipoInfo?.imei || null;
        if (!imeiFinal) {
          const { data: vinculacionPrevia } = await supabaseClient
            .from("historial_equipo")
            .select("imei")
            .eq("mc", mcEquipo)
            .eq("tipo_evento", "Vinculación")
            .not("imei", "is", null)
            .order("fecha", { ascending: false })
            .limit(1)
            .maybeSingle();
          imeiFinal = vinculacionPrevia?.imei || null;
        }

        const datosEvento = {
          imei: imeiFinal,
          mc: mcEquipo,
          tipo_evento: tipoEventoNuevo,
          id_ot: componente.id_ot,
          notas: esDestinoStock ? "Módulo de Control revisado y enviado a stock" : "Módulo de Control enviado a AMMI"
        };

        if (eventoExistente) {
          await supabaseClient.from("historial_equipo").update(datosEvento).eq("id", eventoExistente.id);
        } else {
          await supabaseClient.from("historial_equipo").insert(datosEvento);
        }
        if (imeiFinal) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: imeiFinal });
      }
      // si ya existía uno del mismo tipo para esta misma OT, no se toca
    }
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

function refrescarListaActual() {
  if (modoTodosPendientes) {
    verTodosPendientes();
  } else {
    buscarComponentes();
  }
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

// --- Guardar todas las filas editables de golpe ---
document.getElementById("guardar-todo-btn").addEventListener("click", async () => {
  const btnTodo = document.getElementById("guardar-todo-btn");
  const botonesFila = [...document.querySelectorAll(".btn-guardar-fila:not(:disabled)")];

  if (botonesFila.length === 0) {
    alert("No hay ninguna fila editable para guardar (todas están bloqueadas o vacías).");
    return;
  }

  btnTodo.disabled = true;
  btnTodo.textContent = "Guardando todo...";

  let guardadas = 0;
  let saltadas = 0;

  for (const btn of botonesFila) {
    const fila = btn.closest("tr");
    const destino = fila.querySelector(".input-destino").value;
    if (!destino) { saltadas++; continue; } // sin Destino elegido — se salta sin interrumpir con una alerta

    if (destino === DESTINO_AMMI) {
      const categoriaAmmi = fila.querySelector(".input-categoria-ammi")?.value;
      const garantiaCliente = fila.querySelector(".input-garantia-cliente")?.value;
      if (!categoriaAmmi || !garantiaCliente) { saltadas++; continue; }
    }

    await guardarFila(btn);
    guardadas++;
  }

  btnTodo.disabled = false;
  btnTodo.textContent = "💾 Guardar todo";

  if (saltadas > 0) {
    alert(`✅ ${guardadas} fila(s) guardada(s).\n⚠️ ${saltadas} fila(s) sin Destino elegido — no se guardaron, elígeles un Destino y usa "Guardar todo" de nuevo.`);
  }
});


// =========================================================================
// FILTROS POR COLUMNA — ocultan filas sin volver a pintar la tabla, así no
// se pierde lo que ya se haya escrito en las filas sin guardar.
// =========================================================================
function textoCeldaRevision(td) {
  if (!td) return "";
  const sel = td.querySelector("select");
  if (sel && !td.querySelector(".detalle-ammi")) return (sel.selectedOptions[0]?.textContent || "").trim();
  const chk = td.querySelector("input.input-vandalismo");
  if (chk) return chk.checked ? "Sí" : "No";
  if (td.querySelector(".input-foto-revision")) return td.querySelector("a") ? "Con foto" : "Sin foto";
  const inp = td.querySelector('input[type="text"], textarea');
  if (inp) return (inp.value || "").trim();
  const resumen = td.querySelector("summary");
  if (resumen) return resumen.textContent.trim();
  const ammi = td.querySelector(".detalle-ammi");
  if (ammi) return ammi.hidden ? "" : [...ammi.querySelectorAll("select")].map(s => s.selectedOptions[0]?.textContent || "").join(" ");
  return td.textContent.trim();
}

function filtrosRevisionActivos() {
  return [...document.querySelectorAll("#tabla-revision .fila-filtros th:not([hidden]) .rf")];
}

function prepararFiltrosRevision() {
  const filtros = filtrosRevisionActivos();
  const filas = [...tbody.querySelectorAll("tr")];
  filtros.forEach((f, i) => {
    if (f.dataset.tipo !== "select") return;
    const actual = f.value;
    const valores = [...new Set(filas.map(tr => textoCeldaRevision(tr.children[i])).filter(Boolean))].sort();
    f.innerHTML = `<option value="">Todos</option>` +
      valores.map(v => `<option value="${escaparHtml(v)}">${escaparHtml(v)}</option>`).join("");
    f.value = valores.includes(actual) ? actual : "";
  });
  aplicarFiltrosRevision();
}

function aplicarFiltrosRevision() {
  const filtros = filtrosRevisionActivos();
  const filas = [...tbody.querySelectorAll("tr")];
  let visibles = 0;
  filas.forEach(tr => {
    const ok = filtros.every((f, i) => {
      const v = f.value.trim().toLowerCase();
      if (!v) return true;
      const t = textoCeldaRevision(tr.children[i]).toLowerCase();
      return f.dataset.tipo === "select" ? t === v : t.includes(v);
    });
    tr.hidden = !ok;
    if (ok) visibles++;
  });
  const cont = document.getElementById("rf-contador");
  if (cont) cont.textContent = filas.length ? `${visibles}/${filas.length}` : "";
}

document.querySelectorAll("#tabla-revision .fila-filtros .rf").forEach(f => {
  f.addEventListener(f.dataset.tipo === "select" ? "change" : "input", aplicarFiltrosRevision);
});
document.getElementById("rf-limpiar").addEventListener("click", () => {
  document.querySelectorAll("#tabla-revision .fila-filtros .rf").forEach(f => { f.value = ""; });
  aplicarFiltrosRevision();
});
// Si algo cambia dentro de una fila (destino, vandalismo...), se reevalúa
tbody.addEventListener("change", () => aplicarFiltrosRevision());

// Mide la altura de la 1ª fila de encabezados para que la fila de filtros
// se quede pegada justo debajo de ella al desplazarse
function ajustarEncabezadoSticky() {
  document.querySelectorAll(".scroll-x-tabla").forEach(w => {
    const tr = w.querySelector("thead tr");
    if (tr && tr.offsetHeight) w.style.setProperty("--fila1-h", tr.offsetHeight + "px");
  });
}
window.addEventListener("resize", ajustarEncabezadoSticky);
