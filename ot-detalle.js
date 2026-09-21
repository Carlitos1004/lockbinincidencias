// =========================================================================
// DETALLE DE OT
// =========================================================================

// TODO: ajustar a la ubicación real de tu oficina/almacén (usada como
// punto de partida para calcular la ruta)
// Ya no se usan (el botón de ruta ahora exporta CSV para My Maps en vez de
// abrir enlaces de Google Maps con paradas) — se dejan aquí por si en
// algún momento se vuelve a necesitar ese enfoque.
const LAT_OFICINA = 42.2985;
const LNG_OFICINA = -7.8180;
const MAX_PARADAS_POR_LINK = 7; // límite práctico de Google Maps por link

let otActualCargada = null;
let ticketsCargados = [];
let conteoFotosPorRegistro = {};

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
  document.getElementById("guardar-todo-btn").hidden = !esManager;
  document.getElementById("eliminar-ot-btn").hidden = !esManager;
  document.querySelector(".agregar-equipo-box").hidden = esCliente;
  document.getElementById("crear-ot-libre-box").hidden = !esManager;
  document.getElementById("traer-pendientes-box").hidden = !esManager;
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
    .or(`id_ot.eq.${idOt},id_ot_relacionada.eq.${idOt}`)
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

  // Conteo de fotos por ticket, para saber si mostrar "Ver foto" (una) o
  // "Ver todas las fotos (N)" (varias)
  conteoFotosPorRegistro = {};
  const idsRegistro = ticketsCargados.map(t => t.id_registro).filter(Boolean);
  if (idsRegistro.length > 0) {
    const { data: fotos } = await supabaseClient
      .from("fotos_reporte")
      .select("id_registro")
      .in("id_registro", idsRegistro);
    (fotos || []).forEach(f => {
      conteoFotosPorRegistro[f.id_registro] = (conteoFotosPorRegistro[f.id_registro] || 0) + 1;
    });
  }

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

    const idOtActualVista = otActualCargada?.id_ot;
    let etiquetaVinculo = "";
    if (t.id_ot !== idOtActualVista) {
      etiquetaVinculo = `<span class="vinculo-ot-etiqueta" title="Este ticket pertenece originalmente a ${t.id_ot}">🔗 De ${t.id_ot}</span>`;
    } else if (t.id_ot_relacionada) {
      etiquetaVinculo = `<span class="vinculo-ot-etiqueta" title="También se está resolviendo desde esa OT">→ También en ${t.id_ot_relacionada}</span>`;
    }

    const celdaAccionComentarios = puedeEditar
      ? `<textarea class="input-accion-comentarios" rows="2" data-id="${t.id_registro}">${[t.accion_calle, t.comentarios].filter(Boolean).join("\n") || ""}</textarea>
         <button class="btn-guardar-ticket" data-id="${t.id_registro}">Guardar</button>`
      : ([t.accion_calle, t.comentarios].filter(Boolean).join(" | ") || "—");

    const cantidadFotos = conteoFotosPorRegistro[t.id_registro] || 0;
    const celdaFoto = cantidadFotos > 1
      ? `<a href="ver-fotos.html?id=${encodeURIComponent(t.id_registro)}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver todas las fotos (${cantidadFotos}) →</a>`
      : t.link_foto
        ? `<a href="${t.link_foto}" target="_blank" rel="noopener" class="btn-ver-tabla">Ver foto →</a>`
        : "—";

    const celdaEliminar = esManager
      ? `<button class="btn-eliminar-ticket" data-id="${t.id_registro}" title="Quitar este equipo de la OT">🗑️</button>`
      : "";

    return `
      <tr>
        <td>${t.m_control}${etiquetaVinculo}</td>
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
    btn.addEventListener("click", () => guardarUnTicket(btn.dataset.id, btn));
  });
}

async function guardarUnTicket(idRegistro, btn) {
  const textarea = tbody.querySelector(`.input-accion-comentarios[data-id="${idRegistro}"]`);
  if (!textarea) return true; // no editable (ticket cerrado u otro rol), no hay nada que guardar

  if (btn) { btn.disabled = true; btn.textContent = "Guardando..."; }

  const { error } = await supabaseClient
    .from("historial_fallas")
    .update({ comentarios: textarea.value.trim(), accion_calle: null })
    .eq("id_registro", idRegistro);

  if (btn) btn.textContent = error ? "❌ Error" : "✅ Guardado";
  if (!error) {
    const ticketLocal = ticketsCargados.find(t => t.id_registro === idRegistro);
    if (ticketLocal) { ticketLocal.comentarios = textarea.value.trim(); ticketLocal.accion_calle = null; }
  }
  if (btn) setTimeout(() => { btn.textContent = "Guardar"; btn.disabled = false; }, 1200);
  return !error;
}

document.getElementById("guardar-todo-btn").addEventListener("click", async () => {
  const btn = document.getElementById("guardar-todo-btn");
  const textareas = [...tbody.querySelectorAll(".input-accion-comentarios")];
  if (textareas.length === 0) { alert("No hay ninguna fila editable para guardar."); return; }

  btn.disabled = true;
  btn.textContent = "Guardando todo...";

  let fallos = 0;
  for (const textarea of textareas) {
    const ok = await guardarUnTicket(textarea.dataset.id, null);
    if (!ok) fallos++;
  }

  btn.disabled = false;
  btn.textContent = fallos > 0 ? `⚠️ ${fallos} con error` : "✅ Todo guardado";
  setTimeout(() => { btn.textContent = "💾 Guardar todo"; }, 2000);
});

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
  const puntosConMc = ticketsCargados
    .map(t => ({ mc: t.m_control, eq: t.equipos }))
    .filter(p => p.eq && p.eq.latitud && p.eq.longitud);

  // Quitamos duplicados (varios tickets pueden ser del mismo equipo),
  // pero conservando cuál MC corresponde a cada punto único
  const vistos = new Set();
  const puntosUnicosConMc = [];
  puntosConMc.forEach(p => {
    const clave = `${p.eq.latitud},${p.eq.longitud}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    puntosUnicosConMc.push({ mc: p.mc, lat: p.eq.latitud, lng: p.eq.longitud });
  });

  if (puntosUnicosConMc.length === 0) {
    alert("Ninguno de los equipos de esta OT tiene coordenadas registradas.");
    return;
  }

  // Ordenamos por cercanía (vecino más cercano, partiendo de la oficina)
  // y después agrupamos esa secuencia en bloques de 10 — como ya van en
  // orden de cercanía, cada bloque queda geográficamente agrupado. Así,
  // al trazar cada ruta de 10 en My Maps, no hay que ir buscando a ojo
  // cuáles quedan cerca entre cientos de puntos regados en el mapa.
  const TAMANO_BLOQUE = 10;
  const ordenadosPorCercania = [];
  let actual = { lat: LAT_OFICINA, lng: LNG_OFICINA };
  const restantes = [...puntosUnicosConMc];
  while (restantes.length > 0) {
    let iMasCercano = 0;
    let distMinima = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(actual.lat, actual.lng, p.lat, p.lng);
      if (d < distMinima) { distMinima = d; iMasCercano = i; }
    });
    const siguiente = restantes.splice(iMasCercano, 1)[0];
    ordenadosPorCercania.push(siguiente);
    actual = siguiente;
  }

  // CSV para importar en Google My Maps (mymaps.google.com) — ahí sí
  // aparece el nombre real (el MC) en cada pin dentro del mapa. La
  // columna Bloque sirve además para colorear por grupo en My Maps
  // ("Estilo" → "Agrupar lugares por columna" → Bloque).
  const encabezado = "Name,Latitude,Longitude,Bloque";
  const filas = ordenadosPorCercania.map((p, idx) => `${p.mc},${p.lat},${p.lng},Bloque ${Math.floor(idx / TAMANO_BLOQUE) + 1}`);
  const csv = [encabezado, ...filas].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const enlaceDescarga = document.createElement("a");
  enlaceDescarga.href = URL.createObjectURL(blob);
  enlaceDescarga.download = `Ruta_${otActualCargada.id_ot}_MyMaps.csv`;
  enlaceDescarga.click();

  const totalBloques = Math.ceil(ordenadosPorCercania.length / TAMANO_BLOQUE);
  alert(
    `Se descargó el archivo con ${ordenadosPorCercania.length} equipo(s), agrupados en ${totalBloques} bloques de hasta 10.\n\n` +
    `Para verlo con nombres en el mapa:\n` +
    `1. Entra a mymaps.google.com\n` +
    `2. Crea un mapa nuevo (o abre uno existente)\n` +
    `3. "Importar" → sube este archivo CSV\n` +
    `4. Comparte el enlace del mapa con el operario`
  );
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

  const encabezados = ["Localidad", "Modulo de control", "Fracción", "Acción", "Comentarios", "Latitud", "Longitud", "Enlace", "Estado"];
  const filas = abiertos.map(t => {
    const lat = t.equipos?.latitud;
    const lng = t.equipos?.longitud;
    const accion = [t.accion_calle, t.comentarios].filter(Boolean).join(" — ");
    const fechaComunicacion = t.equipos?.ultima_comunicacion
      ? new Date(t.equipos.ultima_comunicacion).toLocaleDateString("es-ES")
      : "sin dato";
    return [
      t.cliente || "",
      t.m_control,
      t.equipos?.fraccion || "",
      accion,
      "",
      lat || "",
      lng || "",
      (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : "",
      `${t.falla} (${fechaComunicacion})`
    ];
  });

  const filasHoja = [];
  if (otActualCargada.instrucciones) {
    filasHoja.push(["Instrucciones: " + otActualCargada.instrucciones]);
    filasHoja.push([]); // fila en blanco de separación
  }
  filasHoja.push(encabezados);
  filasHoja.push(...filas);

  const hoja = XLSX.utils.aoa_to_sheet(filasHoja);
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

    // Si otros tickets (de OTRA OT) estaban vinculados a esta como
    // pendiente traído/compartido, hay que soltar esa referencia — si no,
    // queda huérfana y puede "resucitar" sola si en el futuro se crea otra
    // OT con este mismo número.
    await supabaseClient.from("historial_fallas").update({ id_ot_relacionada: null }).eq("id_ot_relacionada", idOt);

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
  const categoria = document.getElementById("agregar-comp-categoria").value || null;
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
    categoria: categoria,
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
  document.getElementById("agregar-comp-categoria").value = "";
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



// --- Traer equipos pendientes de una OT anterior, vinculándolos a esta ---
document.getElementById("traer-buscar-btn").addEventListener("click", async () => {
  const otAnterior = document.getElementById("traer-ot-input").value.trim().toUpperCase();
  const resultadoDiv = document.getElementById("traer-resultado");

  if (!otAnterior || !otActualCargada) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">⚠️ Escribe el número de la OT anterior.</p>`;
    return;
  }
  if (otAnterior === otActualCargada.id_ot) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ Es la misma OT que ya tienes abierta.</p>`;
    return;
  }

  const { data: pendientes, error } = await supabaseClient
    .from("historial_fallas")
    .select("*")
    .eq("id_ot", otAnterior)
    .eq("estado", "🚨 ABIERTO");

  if (error) {
    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ ${error.message}</p>`;
    return;
  }
  if (!pendientes || pendientes.length === 0) {
    resultadoDiv.innerHTML = `<p class="resultado-msg" style="display:block;">${otAnterior} no tiene ningún ticket pendiente (abierto).</p>`;
    return;
  }

  resultadoDiv.innerHTML = `
    <p class="resultado-msg resultado-ok" style="display:block;">${pendientes.length} pendiente(s) en ${otAnterior} — elige cuáles traer:</p>
    ${pendientes.map(t => `
      <label class="opcion-check">
        <input type="checkbox" class="check-traer-pendiente" data-id="${t.id_registro}">
        ${t.m_control} — ${t.falla}
      </label>
    `).join("")}
    <button id="traer-confirmar-btn" class="btn-primario" style="margin-top:10px;">Traer seleccionados a esta OT</button>
  `;

  document.getElementById("traer-confirmar-btn").addEventListener("click", async () => {
    const seleccionados = [...document.querySelectorAll(".check-traer-pendiente:checked")].map(c => c.dataset.id);
    if (seleccionados.length === 0) {
      alert("Selecciona al menos uno.");
      return;
    }

    const { error: errorUpdate } = await supabaseClient
      .from("historial_fallas")
      .update({ id_ot_relacionada: otActualCargada.id_ot })
      .in("id_registro", seleccionados);

    if (errorUpdate) {
      alert("Error: " + errorUpdate.message);
      return;
    }

    resultadoDiv.innerHTML = `<p class="resultado-msg resultado-ok" style="display:block;">✅ ${seleccionados.length} equipo(s) traído(s) — ya aparecen abajo en la tabla.</p>`;
    document.getElementById("traer-ot-input").value = "";
    buscarOT();
  });
});


function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
