// =========================================================================
// CONTROL DE SENSORES SUPERFY — de solo lectura, alimentado por el Google
// Sheet que sincroniza con la API de Superfy.
// =========================================================================

let sensoresData = [];
let historialData = [];

cargarDatos();

async function traerTodasLasFilas(tabla, columnas, aplicarFiltro) {
  const TAM_PAGINA = 1000;
  let desde = 0;
  let todas = [];
  while (true) {
    let query = supabaseClient.from(tabla).select(columnas).range(desde, desde + TAM_PAGINA - 1);
    if (aplicarFiltro) query = aplicarFiltro(query);
    const { data, error } = await query;
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAM_PAGINA) break;
    desde += TAM_PAGINA;
  }
  return todas;
}

async function cargarDatos() {
  try {
    sensoresData = await traerTodasLasFilas("sensores", "*", (q) => q.order("fecha_actualizacion", { ascending: false }));
  } catch (err) {
    document.getElementById("tbody-sensores").innerHTML = `<tr><td colspan="7">Error: ${err.message}</td></tr>`;
    return;
  }
  renderResumen();
  renderTablaSensores();
}

let historialYaCargado = false;

document.getElementById("tab-estado-btn").addEventListener("click", () => cambiarPestana("estado"));
document.getElementById("tab-historial-btn").addEventListener("click", () => cambiarPestana("historial"));

async function cambiarPestana(cual) {
  const esEstado = cual === "estado";

  document.getElementById("vista-estado-box").hidden = !esEstado;
  document.getElementById("historial-box").hidden = esEstado;
  document.getElementById("tab-estado-btn").classList.toggle("tab-vista-activa", esEstado);
  document.getElementById("tab-historial-btn").classList.toggle("tab-vista-activa", !esEstado);

  if (!esEstado && !historialYaCargado) {
    document.getElementById("tbody-historial").innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
    try {
      historialData = await traerTodasLasFilas("historial_sensores", "*", (q) => q.order("fecha", { ascending: false }));
      historialYaCargado = true;
      renderTablaHistorial();
    } catch (err) {
      document.getElementById("tbody-historial").innerHTML = `<tr><td colspan="5">Error: ${err.message}</td></tr>`;
    }
  }
}

function renderTablaHistorial() {
  const fMc = document.getElementById("filtro-hist-mc").value.trim().toLowerCase();
  const fTipo = document.getElementById("filtro-hist-tipo").value;

  const filtrados = historialData.filter(ev =>
    (!fMc || (ev.mc || "").toLowerCase().includes(fMc) || (ev.serial || "").toLowerCase().includes(fMc)) &&
    (!fTipo || ev.tipo_evento === fTipo)
  );

  const tbodyHistorial = document.getElementById("tbody-historial");
  if (filtrados.length === 0) {
    tbodyHistorial.innerHTML = `<tr><td colspan="5">Ningún evento coincide.</td></tr>`;
    return;
  }
  tbodyHistorial.innerHTML = filtrados.map(ev => `
    <tr>
      <td>${new Date(ev.fecha).toLocaleString("es-ES")}</td>
      <td class="celda-mono">${ev.serial}</td>
      <td>${ev.mc || "—"}</td>
      <td>${ev.tipo_evento}</td>
      <td>${ev.id_ot ? `<a href="ot-detalle.html?ot=${ev.id_ot}">${ev.id_ot}</a>` : "—"}</td>
    </tr>
  `).join("");
}

["filtro-hist-mc", "filtro-hist-tipo"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTablaHistorial);
});

function renderResumen() {
  const online = sensoresData.filter(s => s.estado_conectividad === "ONLINE").length;
  const offline = sensoresData.filter(s => s.estado_conectividad === "OFFLINE").length;
  const desvinculados = sensoresData.filter(s => s.estado_vinculacion === "DESVINCULADO").length;

  document.getElementById("resumen-sensores").innerHTML = `
    <div class="tarjeta-resumen"><strong>${sensoresData.length}</strong><span>Total sensores</span></div>
    <div class="tarjeta-resumen"><strong>${online}</strong><span>Online</span></div>
    <div class="tarjeta-resumen"><strong>${offline}</strong><span>Offline</span></div>
    <div class="tarjeta-resumen"><strong>${desvinculados}</strong><span>Desvinculados</span></div>
  `;
}

function renderTablaSensores() {
  const fMc = document.getElementById("filtro-mc").value.trim().toLowerCase();
  const fConectividad = document.getElementById("filtro-conectividad").value;
  const fVinculacion = document.getElementById("filtro-vinculacion").value;

  const filtrados = sensoresData.filter(s =>
    (!fMc || (s.mc || "").toLowerCase().includes(fMc)) &&
    (!fConectividad || s.estado_conectividad === fConectividad) &&
    (!fVinculacion || s.estado_vinculacion === fVinculacion)
  );

  const tbody = document.getElementById("tbody-sensores");
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">Ningún sensor coincide.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(s => `
    <tr class="${s.estado_conectividad === 'OFFLINE' ? 'fila-alerta' : ''}">
      <td class="celda-mono">${s.serial}</td>
      <td>${s.mc || "—"}</td>
      <td>${s.superfy_id || "—"}</td>
      <td>${s.estado_conectividad === "OFFLINE" ? "🟥 Offline" : "🟩 Online"}</td>
      <td>${s.estado_vinculacion === "DESVINCULADO" ? "❌ Desvinculado" : "🔗 Vinculado"}</td>
      <td>${s.nivel_bateria !== null && s.nivel_bateria !== undefined ? `<span style="${s.nivel_bateria < 20 ? 'color:#c0392b; font-weight:600;' : ''}">${s.nivel_bateria}%</span>` : "—"}</td>
      <td>${s.ultima_lectura ? new Date(s.ultima_lectura).toLocaleString("es-ES") : "Sin lecturas"}</td>
      <td>${new Date(s.fecha_actualizacion).toLocaleString("es-ES")}</td>
    </tr>
  `).join("");
}

["filtro-mc", "filtro-conectividad", "filtro-vinculacion"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTablaSensores);
});

// --- Registrar manualmente un cambio de sensor (falló uno, se puso otro) ---
document.getElementById("registrar-cambio-btn").addEventListener("click", async () => {
  const msg = document.getElementById("cambio-msg");
  const mc = document.getElementById("cambio-mc").value.trim().toUpperCase();
  const serialViejo = document.getElementById("cambio-serial-viejo").value.trim().toUpperCase();
  const serialNuevo = document.getElementById("cambio-serial-nuevo").value.trim().toUpperCase();
  const idOt = document.getElementById("cambio-ot").value.trim().toUpperCase() || null;
  const notas = document.getElementById("cambio-notas").value.trim() || null;

  if (!mc || !serialViejo || !serialNuevo) {
    mostrarMensajeCambio(msg, "⚠️ Completa MC, serial viejo y serial nuevo.", true);
    return;
  }

  const btn = document.getElementById("registrar-cambio-btn");
  btn.disabled = true;
  btn.textContent = "Registrando...";

  const { error } = await supabaseClient.from("historial_sensores").insert([
    { serial: serialViejo, mc: mc, tipo_evento: "Desvinculado", id_ot: idOt, notas: notas || "Reemplazado por " + serialNuevo },
    { serial: serialNuevo, mc: mc, tipo_evento: "Vinculado", id_ot: idOt, notas: notas || "Reemplaza a " + serialViejo }
  ]);

  btn.disabled = false;
  btn.textContent = "Registrar cambio";

  if (error) {
    mostrarMensajeCambio(msg, "❌ " + error.message, true);
    return;
  }

  mostrarMensajeCambio(msg, "✅ Cambio registrado en el historial.", false);
  ["cambio-mc", "cambio-serial-viejo", "cambio-serial-nuevo", "cambio-ot", "cambio-notas"].forEach(id => {
    document.getElementById(id).value = "";
  });
  cargarDatos();
});

function mostrarMensajeCambio(el, texto, esError) {
  el.textContent = texto;
  el.className = esError ? "resultado-msg resultado-error" : "resultado-msg resultado-ok";
  el.hidden = false;
}
