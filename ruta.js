// =========================================================================
// RUTA INTERACTIVA — mapa con los equipos de una OT, ordenados de más
// cercano a más lejano desde la oficina, con reporte completo al tocar
// cada punto (incluye escaneo de serial nuevo por QR y foto).
// =========================================================================

// Polígono Industrial de San Cibrao das Viñas, Ourense
const LAT_OFICINA = 42.287136;
const LNG_OFICINA = -7.815185;

const MAPA_COMPONENTE = {
  LE: { columnaEquipo: "serie_lector", nombre: "Lector Electrónico" },
  CE: { columnaEquipo: "serie_cierre", nombre: "Cierre Electrónico" },
  BA: { columnaEquipo: "serie_bateria", nombre: "Batería" },
  MC: { columnaEquipo: null, nombre: "Módulo de Control" }
};

let mapa = null;
let rutaControl = null;
let marcadores = {}; // mc -> marcador de Leaflet
let equiposPorMC = {}; // mc -> {equipo, tickets: [...]}
let equipoAbierto = null; // mc actualmente mostrado en el modal
let ticketExistente = null;
let fallaActual = null; // falla del ticket elegido, o la seleccionada a mano si es nuevo
let scanner = null;
let serialesNuevos = {}; // codigo -> serial escaneado, se resetea por reporte

const otInput = document.getElementById("ot-input");
const cargarBtn = document.getElementById("cargar-ruta-btn");
const rutaMsg = document.getElementById("ruta-msg");
const mapaDiv = document.getElementById("mapa");
const leyenda = document.getElementById("leyenda");

const modalFondo = document.getElementById("modal-fondo");
const modalCerrar = document.getElementById("modal-cerrar");
const modalMc = document.getElementById("modal-mc");
const modalInfo = document.getElementById("modal-info");
const modalTickets = document.getElementById("modal-tickets");
const modalForm = document.getElementById("modal-form");
const modalEnviarBtn = document.getElementById("modal-enviar-btn");
const modalMsg = document.getElementById("modal-msg");

cargarBtn.addEventListener("click", cargarRuta);
otInput.addEventListener("keypress", (e) => { if (e.key === "Enter") cargarRuta(); });
modalCerrar.addEventListener("click", cerrarModal);

async function cargarRuta() {
  const idOt = otInput.value.trim().toUpperCase();
  rutaMsg.hidden = true;

  if (!idOt) {
    mostrarMensaje(rutaMsg, "⚠️ Escribe un número de OT.", true);
    return;
  }

  cargarBtn.disabled = true;
  cargarBtn.textContent = "Cargando...";

  const { data: tickets, error } = await supabaseClient
    .from("historial_fallas")
    .select("*, equipos:m_control(m_control, cliente, fraccion, latitud, longitud, serie_lector, serie_cierre, serie_bateria)")
    .eq("id_ot", idOt);

  cargarBtn.disabled = false;
  cargarBtn.textContent = "Cargar ruta";

  if (error) {
    mostrarMensaje(rutaMsg, "❌ " + error.message, true);
    return;
  }
  if (!tickets || tickets.length === 0) {
    mostrarMensaje(rutaMsg, "No hay tickets para esa OT.", true);
    return;
  }

  // Agrupar por equipo
  equiposPorMC = {};
  tickets.forEach(t => {
    if (!t.equipos) return;
    if (!equiposPorMC[t.m_control]) equiposPorMC[t.m_control] = { equipo: t.equipos, tickets: [] };
    equiposPorMC[t.m_control].tickets.push(t);
  });

  sessionStorage.setItem("lockbin_ot_activa", idOt);
  renderMapa();
}

function renderMapa() {
  const puntos = Object.values(equiposPorMC)
    .filter(e => e.equipo.latitud && e.equipo.longitud)
    .map(e => ({ mc: e.equipo.m_control, lat: e.equipo.latitud, lng: e.equipo.longitud }));

  if (puntos.length === 0) {
    mostrarMensaje(rutaMsg, "Ninguno de los equipos de esta OT tiene coordenadas registradas.", true);
    return;
  }

  const ordenados = ordenarPorCercania(puntos, { lat: LAT_OFICINA, lng: LNG_OFICINA });

  if (mapa) { mapa.remove(); mapa = null; rutaControl = null; }
  mapaDiv.style.display = "block";
  mapa = L.map(mapaDiv).setView([ordenados[0].lat, ordenados[0].lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(mapa);

  const coordenadasRuta = ordenados.map(p => [p.lat, p.lng]); // sin la oficina — solo entre equipos
  marcadores = {};

  ordenados.forEach((p, idx) => {
    const visitado = equipoVisitado(p.mc);

    const icono = L.divIcon({
      className: "",
      html: `<div class="marcador-numero ${visitado ? 'marcador-verde' : 'marcador-naranja'}">${idx + 1}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marcador = L.marker([p.lat, p.lng], { icon: icono }).addTo(mapa);
    marcador.bindTooltip(p.mc);
    marcador.on("click", () => abrirModal(p.mc));
    marcadores[p.mc] = marcador;
  });

  // Ruta real por carretera (OSRM gratuito) en vez de línea recta.
  // Si el servicio público falla (puede pasar, es gratuito y sin garantía),
  // caemos de vuelta a una línea recta para que la app siga siendo útil.
  // Si solo hay 1 equipo, no hay nada que conectar — nos saltamos el ruteo.
  if (rutaControl) { mapa.removeControl(rutaControl); rutaControl = null; }

  if (coordenadasRuta.length >= 2) {
    try {
      rutaControl = L.Routing.control({
        waypoints: coordenadasRuta.map(c => L.latLng(c[0], c[1])),
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false, // oculta el panel de instrucciones paso a paso, solo queremos la línea
        createMarker: () => null, // los marcadores ya los ponemos nosotros arriba
        lineOptions: { styles: [{ color: "#6FA827", weight: 4 }] }
      }).addTo(mapa);

      rutaControl.on("routingerror", () => {
        dibujarLineaRectaDeRespaldo(coordenadasRuta);
      });
    } catch (e) {
      dibujarLineaRectaDeRespaldo(coordenadasRuta);
    }
  }

  const bounds = L.latLngBounds(ordenados.map(p => [p.lat, p.lng]));
  mapa.fitBounds(bounds, { padding: [40, 40] });

  leyenda.hidden = false;
  rutaMsg.hidden = true;
}

function dibujarLineaRectaDeRespaldo(coordenadasRuta) {
  L.polyline(coordenadasRuta, { color: "#6FA827", weight: 3, dashArray: "6,6" }).addTo(mapa);
}

function equipoVisitado(mc) {
  const info = equiposPorMC[mc];
  if (!info) return false;
  return info.tickets.some(t => t.estado_equipo);
}

function actualizarColorMarcador(mc) {
  const marcador = marcadores[mc];
  if (!marcador) return;
  const visitado = equipoVisitado(mc);
  const idx = Object.keys(marcadores).indexOf(mc);
  marcador.setIcon(L.divIcon({
    className: "",
    html: `<div class="marcador-numero ${visitado ? 'marcador-verde' : 'marcador-naranja'}">${idx + 1}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  }));
}

// Vecino más cercano, distancia euclidiana simple (igual que en Sheets)
function ordenarPorCercania(puntos, origen) {
  const restantes = [...puntos];
  const ordenados = [];
  let actual = origen;
  while (restantes.length > 0) {
    let idxMin = 0, distMin = Infinity;
    restantes.forEach((p, idx) => {
      const d = (p.lat - actual.lat) ** 2 + (p.lng - actual.lng) ** 2;
      if (d < distMin) { distMin = d; idxMin = idx; }
    });
    const siguiente = restantes.splice(idxMin, 1)[0];
    ordenados.push(siguiente);
    actual = siguiente;
  }
  return ordenados;
}

// --- MODAL DE REPORTE ---

async function abrirModal(mc) {
  equipoAbierto = mc;
  ticketExistente = null;
  serialesNuevos = {};

  const info = equiposPorMC[mc];
  modalMc.textContent = mc;
  modalInfo.textContent = `Cliente: ${info.equipo.cliente || "—"} — Fracción: ${info.equipo.fraccion || "—"}`;

  // Mostramos TODOS los tickets de este equipo en esta OT, no solo los
  // abiertos — así uno ya cerrado se puede revisar/editar en vez de
  // desaparecer del modal.
  const todos = info.tickets;
  if (todos.length > 0) {
    modalTickets.innerHTML = `<p class="tickets-titulo">Tickets de este equipo — elige uno para ver/editar lo ya guardado, o reporta algo nuevo abajo:</p>` +
      todos.map(t => `<button type="button" class="ticket-btn" data-id="${t.id_registro}">${t.estado === "✅ CERRADO" ? "✅" : "🚨"} ${escaparHtml(t.falla)} (${t.id_registro})</button>`).join("") +
      `<button type="button" id="reportar-nuevo-btn" class="btn-secundario">➕ Reportar algo nuevo</button>`;

    modalTickets.querySelectorAll(".ticket-btn").forEach(btn => {
      btn.addEventListener("click", () => precargarTicket(btn.dataset.id, btn));
    });
    document.getElementById("reportar-nuevo-btn").addEventListener("click", () => {
      ticketExistente = null;
      fallaActual = null;
      limpiarFormularioModal();
      modalTickets.querySelectorAll(".ticket-btn").forEach(b => b.classList.remove("ticket-elegido"));
      modalForm.hidden = false;
    });
    modalForm.hidden = true;
  } else {
    modalTickets.innerHTML = `<p class="tickets-titulo">Sin tickets todavía — este reporte crea uno nuevo.</p>`;
    limpiarFormularioModal();
    modalForm.hidden = false;
  }

  configurarBotonesQR();
  modalFondo.hidden = false;
}

async function precargarTicket(idRegistro, btnElegido) {
  ticketExistente = idRegistro;
  modalTickets.querySelectorAll(".ticket-btn").forEach(b => b.classList.remove("ticket-elegido"));
  btnElegido.classList.add("ticket-elegido");

  limpiarFormularioModal();

  const info = equiposPorMC[equipoAbierto];
  const ticket = info.tickets.find(t => t.id_registro === idRegistro);

  // Campos simples, directo del ticket. La falla se muestra como texto
  // fijo (no depende de que coincida con una opción del dropdown, que era
  // justo el bug: fallas como "Batería Crítica" no estaban en la lista y
  // la dejaban vacía, bloqueando el envío).
  document.getElementById("modal-falla-label").hidden = true;
  document.getElementById("modal-falla-select").hidden = true;
  const fallaFija = document.getElementById("modal-falla-fija");
  fallaFija.textContent = "Falla: " + (ticket.falla || "—");
  fallaFija.hidden = false;
  fallaActual = ticket.falla;

  document.getElementById("modal-comentarios-input").value = ticket.comentarios || "";
  document.getElementById("modal-estado-select").value = ticket.estado_equipo || "";

  // Casillas de "Descripción de la acción"
  (ticket.acciones_descripcion || []).forEach(valor => {
    const check = document.querySelector(`.accion-check[value="${CSS.escape(valor)}"]`);
    if (check) check.checked = true;
  });

  // Componentes ya registrados para este ticket: reconstruimos las casillas
  // de cambio/faltante y los seriales nuevos escaneados
  const { data: componentes } = await supabaseClient
    .from("componentes_retirados")
    .select("*")
    .eq("id_registro", idRegistro);

  (componentes || []).forEach(c => {
    const codigo = Object.keys(MAPA_COMPONENTE).find(k => MAPA_COMPONENTE[k].nombre === c.tipo_componente);
    if (!codigo) return;

    if (c.estado === "Faltante/Perdido") {
      document.getElementById("modal-falta-" + codigo.toLowerCase()).checked = true;
    } else {
      document.getElementById("modal-cambio-" + codigo.toLowerCase()).checked = true;
      if (c.estado === "Cambiado por el cliente") {
        document.getElementById("modal-retirado-cliente").checked = true;
      }
      if (c.serial_nuevo) serialesNuevos[codigo] = c.serial_nuevo;
    }
  });

  refrescarZonaQR();
  modalForm.hidden = false;
}

function cerrarModal() {
  modalFondo.hidden = true;
  detenerScanner();
}

function limpiarFormularioModal() {
  document.getElementById("modal-falla-label").hidden = false;
  document.getElementById("modal-falla-select").hidden = false;
  document.getElementById("modal-falla-select").value = "";
  document.getElementById("modal-falla-fija").hidden = true;
  document.querySelectorAll(".accion-check").forEach(c => { c.checked = false; });
  document.getElementById("modal-comentarios-input").value = "";
  document.getElementById("modal-estado-select").value = "";
  document.getElementById("modal-foto-input").value = "";
  ["modal-cambio-le", "modal-cambio-ce", "modal-cambio-ba", "modal-cambio-mc", "modal-cambio-completo",
   "modal-retirado-cliente", "modal-falta-le", "modal-falta-ce", "modal-falta-ba", "modal-falta-mc",
   "modal-vandalismo-check"].forEach(id => { document.getElementById(id).checked = false; });
  modalMsg.hidden = true;
  document.getElementById("qr-zona").hidden = true;
}

function configurarBotonesQR() {
  ["le", "ce", "ba", "mc"].forEach(cod => {
    const check = document.getElementById("modal-cambio-" + cod);
    check.addEventListener("change", refrescarZonaQR);
  });
  document.getElementById("modal-cambio-completo").addEventListener("change", refrescarZonaQR);
}

function refrescarZonaQR() {
  const completo = document.getElementById("modal-cambio-completo").checked;
  const codigos = completo
    ? ["LE", "CE", "BA", "MC"]
    : ["LE", "CE", "BA", "MC"].filter(c => document.getElementById("modal-cambio-" + c.toLowerCase()).checked);

  const zona = document.getElementById("qr-zona");
  const botones = document.getElementById("qr-botones");

  if (codigos.length === 0) { zona.hidden = true; return; }

  zona.hidden = false;
  botones.innerHTML = codigos.map(c => `
    <button type="button" class="btn-secundario btn-qr" data-codigo="${c}">
      📷 Escanear nuevo ${MAPA_COMPONENTE[c].nombre} ${serialesNuevos[c] ? "— ✅ " + serialesNuevos[c] : ""}
    </button>
  `).join("");

  botones.querySelectorAll(".btn-qr").forEach(btn => {
    btn.addEventListener("click", () => iniciarScanner(btn.dataset.codigo));
  });
}

function iniciarScanner(codigo) {
  detenerScanner();
  const lector = document.getElementById("qr-lector");
  lector.hidden = false;
  lector.innerHTML = "";

  scanner = new Html5Qrcode("qr-lector");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    (textoLeido) => {
      serialesNuevos[codigo] = textoLeido.trim().toUpperCase();
      detenerScanner();
      refrescarZonaQR();
    },
    () => {} // ignoramos errores de frames sin QR, es normal mientras enfoca
  ).catch(err => {
    alert("No se pudo acceder a la cámara: " + err);
    lector.hidden = true;
  });
}

function detenerScanner() {
  if (scanner) {
    scanner.stop().catch(() => {});
    scanner = null;
  }
  document.getElementById("qr-lector").hidden = true;
}

function serialViejoDe(codigo) {
  const eq = equiposPorMC[equipoAbierto].equipo;
  if (codigo === "MC") return eq.m_control;
  return eq[MAPA_COMPONENTE[codigo].columnaEquipo] || "(sin dato en equipos)";
}

modalEnviarBtn.addEventListener("click", async () => {
  const fallaSeleccionUsuario = document.getElementById("modal-falla-select").value;
  if (!ticketExistente) fallaActual = fallaSeleccionUsuario;
  const falla = fallaActual;

  const accionesSeleccionadas = [...document.querySelectorAll(".accion-check:checked")].map(c => c.value);
  const comentarios = document.getElementById("modal-comentarios-input").value.trim();
  const estadoEquipo = document.getElementById("modal-estado-select").value;
  const fotoFile = document.getElementById("modal-foto-input").files[0];

  if (!falla) { mostrarMensaje(modalMsg, "⚠️ Selecciona la falla.", true); return; }
  if (accionesSeleccionadas.length === 0) { mostrarMensaje(modalMsg, "⚠️ Selecciona al menos una descripción de la acción.", true); return; }
  if (!estadoEquipo) { mostrarMensaje(modalMsg, "⚠️ Selecciona el estado final.", true); return; }

  const idOtActiva = sessionStorage.getItem("lockbin_ot_activa");
  const cambioCompleto = document.getElementById("modal-cambio-completo").checked;
  let codigosCambio = cambioCompleto
    ? ["LE", "CE", "BA", "MC"]
    : ["LE", "CE", "BA", "MC"].filter(c => document.getElementById("modal-cambio-" + c.toLowerCase()).checked);
  const codigosFaltantes = ["LE", "CE", "BA", "MC"].filter(c => document.getElementById("modal-falta-" + c.toLowerCase()).checked);
  const retiradoPorCliente = document.getElementById("modal-retirado-cliente").checked;
  const esVandalismo = document.getElementById("modal-vandalismo-check").checked;

  modalEnviarBtn.disabled = true;
  modalEnviarBtn.textContent = "Enviando...";

  const { data: { user } } = await supabaseClient.auth.getUser();

  // Subir foto si hay
  let linkFoto = null;
  if (fotoFile) {
    try {
      const nombreArchivo = `${Date.now()}_${fotoFile.name}`;
      const { error: errorSubida } = await supabaseClient.storage.from("fotos-reportes").upload(nombreArchivo, fotoFile);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabaseClient.storage.from("fotos-reportes").getPublicUrl(nombreArchivo);
      linkFoto = urlData.publicUrl;
    } catch (err) {
      mostrarMensaje(modalMsg, "⚠️ No se pudo subir la foto, pero se sigue guardando el reporte: " + err.message, true);
    }
  }

  const idRegistro = ticketExistente || ("TK-" + equipoAbierto + "-" + Math.floor(Math.random() * 900 + 100));

  // Si un componente está marcado como "cambio" Y "falta" a la vez (llegó
  // sin el viejo, pero se instaló uno nuevo), lo tratamos solo como
  // Faltante (con el serial nuevo adjunto) — no como un "cambio" con pieza
  // vieja pendiente de revisar, porque esa pieza vieja nunca existió.
  const codigosCambioReal = codigosCambio.filter(c => !codigosFaltantes.includes(c));

  const partesResumen = [];
  if (accionesSeleccionadas.length > 0) partesResumen.push(accionesSeleccionadas.join(" + "));
  if (codigosCambioReal.length > 0) partesResumen.push("Cambio: " + codigosCambioReal.map(c => MAPA_COMPONENTE[c].nombre).join(", "));
  if (retiradoPorCliente) partesResumen.push("(retirado por el cliente)");
  if (codigosFaltantes.length > 0) partesResumen.push("Falta: " + codigosFaltantes.map(c => MAPA_COMPONENTE[c].nombre).join(", "));
  if (esVandalismo) partesResumen.push("Vandalismo/robo");
  const accionResumen = partesResumen.join(" — ");

  const datosFalla = {
    estado: estadoEquipo === "🟢 FUNCIONANDO" ? "✅ CERRADO" : "🚨 ABIERTO",
    accion_calle: accionResumen,
    acciones_descripcion: accionesSeleccionadas,
    comentarios: comentarios,
    estado_equipo: estadoEquipo,
    fecha_cierre: estadoEquipo === "🟢 FUNCIONANDO" ? new Date().toISOString() : null,
    origen: user.email
  };
  // Solo tocamos link_foto si esta vez se subió una foto nueva —
  // si no, dejamos la que ya hubiera guardada de una edición anterior.
  if (linkFoto) datosFalla.link_foto = linkFoto;

  const nuevosSeriales = Object.values(serialesNuevos).filter(Boolean);
  if (nuevosSeriales.length > 0) datosFalla.nuevo_serial = nuevosSeriales.join(", ");

  let errorFalla;
  if (ticketExistente) {
    ({ error: errorFalla } = await supabaseClient.from("historial_fallas").update(datosFalla).eq("id_registro", ticketExistente));
  } else {
    ({ error: errorFalla } = await supabaseClient.from("historial_fallas").insert({
      id_registro: idRegistro, cliente: equiposPorMC[equipoAbierto].equipo.cliente,
      m_control: equipoAbierto, falla: falla, id_ot: idOtActiva, ...datosFalla
    }));
  }

  if (errorFalla) {
    modalEnviarBtn.disabled = false;
    modalEnviarBtn.textContent = "Enviar reporte";
    mostrarMensaje(modalMsg, "❌ Error al guardar el ticket: " + errorFalla.message, true);
    return;
  }

  // Componentes retirados: solo agregamos los que TODAVÍA no estén
  // registrados para este ticket (evita duplicar si el operario reabre y
  // vuelve a guardar sin cambiar nada)
  const { data: yaRegistrados } = await supabaseClient
    .from("componentes_retirados")
    .select("tipo_componente, estado")
    .eq("id_registro", idRegistro);

  const tiposYaCambio = new Set((yaRegistrados || []).filter(c => c.estado !== "Faltante/Perdido").map(c => c.tipo_componente));
  const tiposYaFalta = new Set((yaRegistrados || []).filter(c => c.estado === "Faltante/Perdido").map(c => c.tipo_componente));

  const filasComponentes = [];
  codigosCambioReal.forEach(codigo => {
    if (tiposYaCambio.has(MAPA_COMPONENTE[codigo].nombre)) return;
    filasComponentes.push({
      cliente: equiposPorMC[equipoAbierto].equipo.cliente, m_control: equipoAbierto,
      tipo_componente: MAPA_COMPONENTE[codigo].nombre, serial_retirado: serialViejoDe(codigo),
      serial_nuevo: serialesNuevos[codigo] || null, id_registro: idRegistro, id_ot: idOtActiva,
      estado: retiradoPorCliente ? "Cambiado por el cliente" : "Pendiente revisión",
      excluir_materiales: retiradoPorCliente
    });
  });
  codigosFaltantes.forEach(codigo => {
    if (tiposYaFalta.has(MAPA_COMPONENTE[codigo].nombre)) return;
    filasComponentes.push({
      cliente: equiposPorMC[equipoAbierto].equipo.cliente, m_control: equipoAbierto,
      tipo_componente: MAPA_COMPONENTE[codigo].nombre, serial_retirado: serialViejoDe(codigo),
      serial_nuevo: serialesNuevos[codigo] || null, // si se instaló uno nuevo en su lugar
      id_registro: idRegistro, id_ot: idOtActiva, estado: "Faltante/Perdido", excluir_materiales: true
    });
  });
  if (filasComponentes.length > 0) {
    await supabaseClient.from("componentes_retirados").insert(filasComponentes);
  }

  modalEnviarBtn.disabled = false;
  modalEnviarBtn.textContent = "Enviar reporte";
  mostrarMensaje(modalMsg, "✅ Reporte guardado.", false);

  // Actualizamos el estado local y el color del punto en el mapa
  const ticketLocal = equiposPorMC[equipoAbierto].tickets.find(t => t.id_registro === idRegistro);
  if (ticketLocal) Object.assign(ticketLocal, datosFalla);
  else equiposPorMC[equipoAbierto].tickets.push({ id_registro: idRegistro, ...datosFalla });
  actualizarColorMarcador(equipoAbierto);

  setTimeout(cerrarModal, 1200);
});

function mostrarMensaje(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

// Si venía con OT ya activa (de tecnico.html), la precargamos
(() => {
  const guardada = sessionStorage.getItem("lockbin_ot_activa");
  if (guardada) {
    otInput.value = guardada;
    cargarRuta();
  }
})();
