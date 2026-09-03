// =========================================================================
// DETALLE DE OT
// =========================================================================

// TODO: ajustar a la ubicación real de tu oficina/almacén (usada como
// punto de partida para calcular la ruta)
const LAT_OFICINA = 42.2985;
const LNG_OFICINA = -7.8180;
const MAX_PARADAS_POR_LINK = 7; // límite práctico de Google Maps por link

let otActualCargada = null;
let ticketsCargados = [];

const otInput = document.getElementById("ot-input");
const buscarBtn = document.getElementById("buscar-btn");
const buscarMsg = document.getElementById("buscar-msg");
const otContenido = document.getElementById("ot-contenido");
const instruccionesTextarea = document.getElementById("instrucciones-textarea");
const guardarInstruccionesBtn = document.getElementById("guardar-instrucciones-btn");
const instruccionesMsg = document.getElementById("instrucciones-msg");
const verRutaBtn = document.getElementById("ver-ruta-btn");
const descargarBtn = document.getElementById("descargar-btn");
const tbody = document.getElementById("ot-tbody");

// Si la URL trae ?ot=OT-005, la buscamos automáticamente al cargar
const otEnUrl = new URLSearchParams(window.location.search).get("ot");
if (otEnUrl) otInput.value = otEnUrl;

document.addEventListener("perfil-listo", (e) => {
  const esManager = e.detail.rol === "manager";
  const esCliente = e.detail.rol === "cliente";
  guardarInstruccionesBtn.hidden = !esManager;
  instruccionesTextarea.readOnly = !esManager;
  descargarBtn.hidden = !esManager;
  document.getElementById("descargar-plantilla-btn").hidden = !esManager;
  document.getElementById("eliminar-ot-btn").hidden = !esManager;
  document.querySelector(".agregar-equipo-box").hidden = esCliente;
  document.getElementById("crear-ot-libre-box").hidden = !esManager;
  document.getElementById("agregar-componente-box").hidden = !esManager;

  if (otEnUrl) buscarOT();
});

buscarBtn.addEventListener("click", buscarOT);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") buscarOT(); });

async function buscarOT() {
  const idOt = otInput.value.trim().toUpperCase();
  buscarMsg.hidden = true;
  otContenido.hidden = true;

  if (!idOt) {
    mostrarMensaje(buscarMsg, "⚠️ Escribe un número de OT.", true);
    return;
  }

  const { data: ot, error: errorOt } = await supabaseClient
    .from("ordenes_trabajo")
    .select("*")
    .eq("id_ot", idOt)
    .maybeSingle();

  if (errorOt || !ot) {
    mostrarMensaje(buscarMsg, "No se encontró esa OT.", true);
    return;
  }

  const { data: tickets, error: errorTickets } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .eq("id_ot", idOt)
    .order("m_control");

  if (errorTickets) {
    mostrarMensaje(buscarMsg, "❌ " + errorTickets.message, true);
    return;
  }

  // Unimos con "equipos" a mano (ya no hay relación automática desde que
  // permitimos historial de equipos dados de baja) — un equipo puede no
  // existir ya en la tabla, y eso está bien, solo queda sin esos datos.
  const mcsUnicos = [...new Set((tickets || []).map(t => t.m_control).filter(Boolean))];
  let mapaEquipos = {};
  if (mcsUnicos.length > 0) {
    const { data: equiposData } = await supabaseClient
      .from("equipos")
      .select("m_control, fraccion, latitud, longitud, ultima_comunicacion")
      .in("m_control", mcsUnicos);
    (equiposData || []).forEach(eq => { mapaEquipos[eq.m_control] = eq; });
  }
  (tickets || []).forEach(t => { t.equipos = mapaEquipos[t.m_control] || null; });

  otActualCargada = ot;
  ticketsCargados = tickets || [];

  const fallasUnicas = [...new Set(ticketsCargados.map(t => t.falla).filter(Boolean))].sort();
  document.getElementById("filtro-falla-select").innerHTML =
    `<option value="">Todas las fallas</option>` +
    fallasUnicas.map(f => `<option value="${f}">${f}</option>`).join("");
  document.getElementById("filtro-falla-select").value = "";
  document.getElementById("filtro-estado-ticket").value = "";

  document.getElementById("ot-titulo").textContent = idOt;
  document.getElementById("ot-meta").textContent =
    `${ot.cliente ? "Cliente: " + ot.cliente + " — " : ""}Creada: ${new Date(ot.fecha).toLocaleString("es-ES")} — por ${ot.creado_por || "—"} — ${ticketsCargados.length} ticket(s)`;
  instruccionesTextarea.value = ot.instrucciones || "";

  const cajaCompletada = document.getElementById("completada-libre-box");
  const esManagerActual = window.perfilActual?.rol === "manager";
  cajaCompletada.hidden = !(ot.origen === "libre" && esManagerActual);
  document.getElementById("completada-checkbox").checked = !!ot.completada;

  await cargarComponentesSinTicket(idOt);

  renderTabla();
  otContenido.hidden = false;
}

function renderTabla() {
  const esManager = window.perfilActual?.rol === "manager";
  const filtroModulo = document.getElementById("filtro-modulo").value.trim().toLowerCase();
  const filtroFalla = document.getElementById("filtro-falla-select").value;
  const filtroEstado = document.getElementById("filtro-estado-ticket").value;

  const filasFiltradas = ticketsCargados.filter(t =>
    (!filtroModulo || t.m_control.toLowerCase().includes(filtroModulo)) &&
    (!filtroFalla || t.falla === filtroFalla) &&
    (!filtroEstado || t.estado === filtroEstado)
  );

  tbody.innerHTML = filasFiltradas.map(t => {
    const abierto = t.estado === "🚨 ABIERTO";
    const puedeEditar = esManager && abierto;

    const celdaAccionComentarios = puedeEditar
      ? `<textarea class="input-accion-comentarios" rows="2" data-id="${t.id_registro}">${[t.accion_calle, t.comentarios].filter(Boolean).join("\n") || ""}</textarea>
         <button class="btn-guardar-ticket" data-id="${t.id_registro}">Guardar</button>`
      : ([t.accion_calle, t.comentarios].filter(Boolean).join(" | ") || "—");

    const celdaFoto = t.link_foto
      ? `<a href="${t.link_foto}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto →</a>`
      : "—";

    const celdaEliminar = esManager
      ? `<button class="btn-eliminar-ticket" data-id="${t.id_registro}" title="Quitar este equipo de la OT">🗑️</button>`
      : "";

    return `
      <tr>
        <td>${t.m_control}</td>
        <td>${t.equipos?.fraccion || "—"}</td>
        <td>${t.falla}</td>
        <td>${t.estado}${t.estado_equipo ? " — " + t.estado_equipo : ""}</td>
        <td>${t.nuevo_serial || "—"}</td>
        <td>${celdaFoto}</td>
        <td>${celdaAccionComentarios}</td>
        <td>${celdaEliminar}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-eliminar-ticket").forEach(btn => {
    btn.addEventListener("click", () => eliminarTicketDeOT(btn.dataset.id));
  });

  tbody.querySelectorAll(".btn-guardar-ticket").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idRegistro = btn.dataset.id;
      const textarea = tbody.querySelector(`.input-accion-comentarios[data-id="${idRegistro}"]`);
      btn.disabled = true;
      btn.textContent = "Guardando...";

      const { error } = await supabaseClient
        .from("historial_fallas")
        .update({ comentarios: textarea.value.trim(), accion_calle: null })
        .eq("id_registro", idRegistro);

      btn.textContent = error ? "❌ Error" : "✅ Guardado";
      if (!error) {
        const ticketLocal = ticketsCargados.find(t => t.id_registro === idRegistro);
        if (ticketLocal) { ticketLocal.comentarios = textarea.value.trim(); ticketLocal.accion_calle = null; }
      }
      setTimeout(() => { btn.textContent = "Guardar"; btn.disabled = false; }, 1200);
    });
  });
}

guardarInstruccionesBtn.addEventListener("click", async () => {
  if (!otActualCargada) return;
  guardarInstruccionesBtn.disabled = true;

  const { error } = await supabaseClient
    .from("ordenes_trabajo")
    .update({ instrucciones: instruccionesTextarea.value.trim() })
    .eq("id_ot", otActualCargada.id_ot);

  guardarInstruccionesBtn.disabled = false;
  instruccionesMsg.textContent = error ? "❌ Error al guardar" : "✅ Guardado";
  setTimeout(() => { instruccionesMsg.textContent = ""; }, 2000);
});

verRutaBtn.addEventListener("click", () => {
  const puntos = ticketsCargados
    .map(t => t.equipos)
    .filter(eq => eq && eq.latitud && eq.longitud)
    .map(eq => `${eq.latitud},${eq.longitud}`);

  // Quitamos duplicados (varios tickets pueden ser del mismo equipo)
  const puntosUnicos = [...new Set(puntos)];

  if (puntosUnicos.length === 0) {
    alert("Ninguno de los equipos de esta OT tiene coordenadas registradas.");
    return;
  }

  let origen = `${LAT_OFICINA},${LNG_OFICINA}`;
  const enlaces = [];

  for (let i = 0; i < puntosUnicos.length; i += MAX_PARADAS_POR_LINK) {
    const tramo = puntosUnicos.slice(i, i + MAX_PARADAS_POR_LINK);
    const destino = tramo[tramo.length - 1];
    const paradas = tramo.slice(0, -1);

    let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origen)}&destination=${encodeURIComponent(destino)}&travelmode=driving`;
    if (paradas.length > 0) url += `&waypoints=${encodeURIComponent(paradas.join("|"))}`;
    enlaces.push(url);
    origen = destino;
  }

  enlaces.forEach(url => window.open(url, "_blank"));
  if (enlaces.length > 1) {
    alert(`Esta OT tiene más paradas de las que caben en un solo link de Google Maps — se abrieron ${enlaces.length} pestañas, una por tramo, en orden.`);
  }
});

descargarBtn.addEventListener("click", () => {
  if (!otActualCargada) return;

  const filas = ticketsCargados.map(t => ({
    "Módulo de Control": t.m_control,
    "Fracción": t.equipos?.fraccion || "",
    "Falla": t.falla,
    "Estado": t.estado,
    "Estado Equipo": t.estado_equipo || "",
    "Acción en calle": t.accion_calle || "",
    "Comentarios": t.comentarios || ""
  }));

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Equipos");

  // Segunda hoja con la info general + instrucciones, para que sea editable
  const hojaInfo = XLSX.utils.aoa_to_sheet([
    ["OT", otActualCargada.id_ot],
    ["Fecha", new Date(otActualCargada.fecha).toLocaleString("es-ES")],
    ["Instrucciones", instruccionesTextarea.value || ""]
  ]);
  XLSX.utils.book_append_sheet(libro, hojaInfo, "Info");

  XLSX.writeFile(libro, otActualCargada.id_ot + ".xlsx");
});

document.getElementById("descargar-plantilla-btn").addEventListener("click", () => {
  if (!otActualCargada) return;

  const abiertos = ticketsCargados.filter(t => t.estado === "🚨 ABIERTO");
  if (abiertos.length === 0) {
    alert("No hay tickets abiertos en esta OT para incluir en la plantilla.");
    return;
  }

  const filas = abiertos.map(t => {
    const lat = t.equipos?.latitud;
    const lng = t.equipos?.longitud;
    const accion = [t.accion_calle, t.comentarios].filter(Boolean).join(" — ");
    const fechaComunicacion = t.equipos?.ultima_comunicacion
      ? new Date(t.equipos.ultima_comunicacion).toLocaleDateString("es-ES")
      : "sin dato";
    return {
      "Localidad": t.cliente || "",
      "Modulo de control": t.m_control,
      "Fracción": t.equipos?.fraccion || "",
      "Acción": accion,
      "Comentarios": "",
      "Latitud": lat || "",
      "Longitud": lng || "",
      "Enlace": (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : "",
      "Estado": `${t.falla} (${fechaComunicacion})`
    };
  });

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Plantilla");
  XLSX.writeFile(libro, `Plantilla_${otActualCargada.id_ot}.xlsx`);
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

document.getElementById("eliminar-ot-btn").addEventListener("click", async () => {
  if (!otActualCargada) return;
  const idOt = otActualCargada.id_ot;

  const escrito = prompt(
    `Esto borra la OT ${idOt} y TODO lo relacionado (tickets, componentes, materiales, garantías) — no se puede deshacer.\n\nEscribe "${idOt}" para confirmar:`
  );
  if (escrito !== idOt) {
    if (escrito !== null) alert("No coincide, no se eliminó nada.");
    return;
  }

  const btn = document.getElementById("eliminar-ot-btn");
  btn.disabled = true;
  btn.textContent = "Eliminando...";

  try {
    // Orden importa: primero lo que depende de historial_fallas/componentes,
    // al final la propia OT. Pedimos ".select()" en cada borrado para poder
    // confirmar cuántas filas se borraron de verdad — si los permisos de
    // Supabase bloquean el borrado, no da error, simplemente borra 0 filas
    // en silencio, y sin este chequeo pareciera que "no pasó nada".
    await supabaseClient.from("garantias").delete().eq("id_ot", idOt);
    await supabaseClient.from("componentes_retirados").delete().eq("id_ot", idOt);
    await supabaseClient.from("materiales_ot").delete().eq("id_ot", idOt);
    await supabaseClient.from("historial_fallas").delete().eq("id_ot", idOt);

    const { data: filasBorradas, error } = await supabaseClient
      .from("ordenes_trabajo")
      .delete()
      .eq("id_ot", idOt)
      .select();
    if (error) throw error;

    if (!filasBorradas || filasBorradas.length === 0) {
      throw new Error("No se borró nada — probablemente falten los permisos de borrado en Supabase (corre 15-permisos-borrado.sql).");
    }

    alert(`${idOt} eliminada por completo.`);
    window.location.href = "ordenes.html";
  } catch (err) {
    alert("Error al eliminar: " + err.message);
    btn.disabled = false;
    btn.textContent = "🗑️ Eliminar esta OT";
  }
});

async function eliminarTicketDeOT(idRegistro) {
  if (!confirm(`¿Quitar el equipo de esta OT? Esto borra también sus componentes y garantías asociadas (si tiene). No se puede deshacer.`)) return;

  // Borramos en cascada, en el mismo orden que usamos para eliminar una OT
  // completa: primero garantías, luego componentes, y al final el ticket.
  const { data: componentesDelTicket } = await supabaseClient
    .from("componentes_retirados")
    .select("id")
    .eq("id_registro", idRegistro);

  const idsComponentes = (componentesDelTicket || []).map(c => c.id);
  if (idsComponentes.length > 0) {
    await supabaseClient.from("garantias").delete().in("componente_id", idsComponentes);
    await supabaseClient.from("componentes_retirados").delete().in("id", idsComponentes);
  }

  const { error } = await supabaseClient.from("historial_fallas").delete().eq("id_registro", idRegistro);
  if (error) {
    alert("Error al quitar el equipo: " + error.message);
    return;
  }

  if (otActualCargada?.id_ot) {
    await supabaseClient.rpc("recalcular_materiales_ot", { p_id_ot: otActualCargada.id_ot });
  }

  buscarOT();
}

document.getElementById("agregar-equipo-btn").addEventListener("click", async () => {
  const mc = document.getElementById("agregar-mc-input").value.trim().toUpperCase();
  const falla = document.getElementById("agregar-falla-select").value;
  const msg = document.getElementById("agregar-equipo-msg");

  if (!mc || !falla) {
    mostrarMensaje(msg, "⚠️ Escribe el Módulo de Control y elige una falla.", true);
    return;
  }
  if (!otActualCargada) return;

  const btn = document.getElementById("agregar-equipo-btn");
  btn.disabled = true;
  btn.textContent = "Agregando...";

  const { data: equipo } = await supabaseClient
    .from("equipos")
    .select("m_control, cliente")
    .eq("m_control", mc)
    .maybeSingle();

  if (!equipo) {
    mostrarMensaje(msg, "❌ No existe ningún equipo con ese Módulo de Control.", true);
    btn.disabled = false;
    btn.textContent = "Agregar";
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const idRegistro = "TK-" + mc + "-" + Math.floor(Math.random() * 900 + 100);

  const { error } = await supabaseClient.from("historial_fallas").insert({
    id_registro: idRegistro,
    cliente: equipo.cliente,
    m_control: mc,
    falla: falla,
    estado: "🚨 ABIERTO",
    origen: user.email,
    id_ot: otActualCargada.id_ot
  });

  btn.disabled = false;
  btn.textContent = "Agregar";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, `✅ ${mc} agregado a la OT.`, false);
  document.getElementById("agregar-mc-input").value = "";
  document.getElementById("agregar-falla-select").value = "";
  buscarOT();
});

document.getElementById("filtro-modulo").addEventListener("input", renderTabla);
document.getElementById("filtro-falla-select").addEventListener("change", renderTabla);
document.getElementById("filtro-estado-ticket").addEventListener("change", renderTabla);

async function cargarClientesParaSelect() {
  const select = document.getElementById("nueva-ot-cliente");
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todos = [];
  while (true) {
    const { data, error } = await supabaseClient
      .from("equipos")
      .select("cliente")
      .range(desde, desde + TAM_PAGINA - 1);
    if (error) break;
    todos = todos.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  const clientesUnicos = [...new Set(todos.map(e => e.cliente).filter(Boolean))].sort();
  select.innerHTML = `<option value="">— Selecciona un cliente —</option>` +
    clientesUnicos.map(c => `<option value="${c}">${c}</option>`).join("");
}
cargarClientesParaSelect();

// --- Crear una OT libre, sin filtrar por alarmas ni ticket ---
document.getElementById("crear-ot-libre-btn").addEventListener("click", async () => {
  const cliente = document.getElementById("nueva-ot-cliente").value.trim();
  const motivo = document.getElementById("nueva-ot-motivo").value.trim();
  const msg = document.getElementById("crear-ot-libre-msg");

  if (!cliente || !motivo) {
    mostrarMensaje(msg, "⚠️ Escribe el cliente y el motivo de la actuación.", true);
    return;
  }

  const btn = document.getElementById("crear-ot-libre-btn");
  btn.disabled = true;
  btn.textContent = "Creando...";

  const { data: otsExistentes } = await supabaseClient.from("ordenes_trabajo").select("id_ot");
  let maxNum = 0;
  (otsExistentes || []).forEach(o => {
    const m = String(o.id_ot).match(/OT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  const nuevoIdOt = "OT-" + String(maxNum + 1).padStart(3, "0");

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("ordenes_trabajo").insert({
    id_ot: nuevoIdOt,
    cliente: cliente,
    instrucciones: motivo,
    creado_por: user.email,
    origen: "libre"
  });

  btn.disabled = false;
  btn.textContent = "Crear OT nueva";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  document.getElementById("nueva-ot-cliente").value = "";
  document.getElementById("nueva-ot-motivo").value = "";
  otInput.value = nuevoIdOt;
  buscarOT();
});

// --- Registrar un componente defectuoso sin ticket, tipo "lote sin serializar" ---
document.getElementById("agregar-componente-btn").addEventListener("click", async () => {
  const mc = document.getElementById("agregar-comp-mc").value.trim().toUpperCase();
  const tipo = document.getElementById("agregar-comp-tipo").value;
  const serial = document.getElementById("agregar-comp-serial").value.trim().toUpperCase();
  const hallazgo = document.getElementById("agregar-comp-hallazgo").value.trim();
  const msg = document.getElementById("agregar-componente-msg");

  if (!tipo || !serial) {
    mostrarMensaje(msg, "⚠️ Elige el tipo de componente y escribe el serial.", true);
    return;
  }
  if (!otActualCargada) return;

  const btn = document.getElementById("agregar-componente-btn");
  btn.disabled = true;
  btn.textContent = "Registrando...";

  const { error } = await supabaseClient.from("componentes_retirados").insert({
    cliente: otActualCargada.cliente || null,
    m_control: mc || null,
    tipo_componente: tipo,
    serial_retirado: serial,
    reparacion: hallazgo,
    id_registro: null, // no viene de ningún ticket
    id_ot: otActualCargada.id_ot,
    estado: "Pendiente revisión",
    excluir_materiales: true // no se serializó como parte del conteo normal de materiales
  });

  btn.disabled = false;
  btn.textContent = "Registrar";

  if (error) {
    mostrarMensaje(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensaje(msg, `✅ ${serial} registrado — ya puedes asignarle Destino en Revisión de Taller.`, false);
  document.getElementById("agregar-comp-mc").value = "";
  document.getElementById("agregar-comp-tipo").value = "";
  document.getElementById("agregar-comp-serial").value = "";
  document.getElementById("agregar-comp-hallazgo").value = "";
  cargarComponentesSinTicket(otActualCargada.id_ot);
});

// --- Marcar/desmarcar una OT libre como completada ---
document.getElementById("completada-checkbox").addEventListener("change", async (e) => {
  if (!otActualCargada) return;
  const { error } = await supabaseClient
    .from("ordenes_trabajo")
    .update({ completada: e.target.checked })
    .eq("id_ot", otActualCargada.id_ot);

  if (error) {
    alert("No se pudo guardar: " + error.message);
    e.target.checked = !e.target.checked; // revertir visualmente
  } else {
    otActualCargada.completada = e.target.checked;
  }
});

// --- Mostrar los componentes registrados sin ticket (agregados directo
// en esta pantalla, uno a uno o por carga rápida) ---
async function cargarComponentesSinTicket(idOt) {
  const box = document.getElementById("sin-ticket-box");
  const tbody = document.getElementById("sin-ticket-tbody");

  const { data, error } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("id_ot", idOt)
    .is("id_registro", null)
    .order("fecha", { ascending: false });

  if (error || !data || data.length === 0) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  tbody.innerHTML = data.map(c => `
    <tr>
      <td>${c.m_control || "—"}</td>
      <td>${c.tipo_componente}</td>
      <td class="celda-mono">${c.serial_retirado || "—"}</td>
      <td>${c.estado}</td>
      <td>${c.cliente_original || "—"}</td>
      <td>${c.destino || "—"}</td>
      <td>${c.reparacion || "—"}</td>
    </tr>
  `).join("");
}
