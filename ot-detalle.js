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
  guardarInstruccionesBtn.hidden = !esManager;
  instruccionesTextarea.readOnly = !esManager;
  descargarBtn.hidden = !esManager;
  document.getElementById("eliminar-ot-btn").hidden = !esManager;

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
      .select("m_control, fraccion, latitud, longitud")
      .in("m_control", mcsUnicos);
    (equiposData || []).forEach(eq => { mapaEquipos[eq.m_control] = eq; });
  }
  (tickets || []).forEach(t => { t.equipos = mapaEquipos[t.m_control] || null; });

  otActualCargada = ot;
  ticketsCargados = tickets || [];

  document.getElementById("ot-titulo").textContent = idOt;
  document.getElementById("ot-meta").textContent =
    `Creada: ${new Date(ot.fecha).toLocaleString("es-ES")} — por ${ot.creado_por || "—"} — ${ticketsCargados.length} ticket(s)`;
  instruccionesTextarea.value = ot.instrucciones || "";

  renderTabla();
  otContenido.hidden = false;
}

function renderTabla() {
  const esManager = window.perfilActual?.rol === "manager";

  tbody.innerHTML = ticketsCargados.map(t => {
    const abierto = t.estado === "🚨 ABIERTO";
    const puedeEditar = esManager && abierto;

    const celdaAccionComentarios = puedeEditar
      ? `<textarea class="input-accion-comentarios" rows="2" data-id="${t.id_registro}">${[t.accion_calle, t.comentarios].filter(Boolean).join("\n") || ""}</textarea>
         <button class="btn-guardar-ticket" data-id="${t.id_registro}">Guardar</button>`
      : ([t.accion_calle, t.comentarios].filter(Boolean).join(" | ") || "—");

    const celdaFoto = t.link_foto
      ? `<a href="${t.link_foto}" target="_blank" rel="noopener">Ver foto →</a>`
      : "—";

    return `
      <tr>
        <td>${t.m_control}</td>
        <td>${t.equipos?.fraccion || "—"}</td>
        <td>${t.falla}</td>
        <td>${t.estado}${t.estado_equipo ? " — " + t.estado_equipo : ""}</td>
        <td>${t.nuevo_serial || "—"}</td>
        <td>${celdaFoto}</td>
        <td>${celdaAccionComentarios}</td>
      </tr>
    `;
  }).join("");

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
