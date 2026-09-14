// =========================================================================
// CONTROL DE SENSORES SUPERFY — de solo lectura, alimentado por el Google
// Sheet que sincroniza con la API de Superfy.
// =========================================================================

let sensoresData = [];

cargarDatos();

async function cargarDatos() {
  const [{ data: sensores, error: errorSensores }, { data: historial, error: errorHistorial }] = await Promise.all([
    supabaseClient.from("sensores").select("*").order("fecha_actualizacion", { ascending: false }),
    supabaseClient.from("historial_sensores").select("*").order("fecha", { ascending: false }).limit(200)
  ]);

  if (errorSensores) {
    document.getElementById("tbody-sensores").innerHTML = `<tr><td colspan="7">Error: ${errorSensores.message}</td></tr>`;
    return;
  }

  sensoresData = sensores || [];
  renderResumen();
  renderTablaSensores();

  const tbodyHistorial = document.getElementById("tbody-historial");
  if (errorHistorial) {
    tbodyHistorial.innerHTML = `<tr><td colspan="4">Error: ${errorHistorial.message}</td></tr>`;
  } else if (!historial || historial.length === 0) {
    tbodyHistorial.innerHTML = `<tr><td colspan="4">Todavía no hay eventos registrados.</td></tr>`;
  } else {
    tbodyHistorial.innerHTML = historial.map(ev => `
      <tr>
        <td>${new Date(ev.fecha).toLocaleString("es-ES")}</td>
        <td class="celda-mono">${ev.serial}</td>
        <td>${ev.mc || "—"}</td>
        <td>${ev.tipo_evento}</td>
      </tr>
    `).join("");
  }
}

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
      <td>${s.ultima_lectura ? new Date(s.ultima_lectura).toLocaleString("es-ES") : "Sin lecturas"}</td>
      <td>${new Date(s.fecha_actualizacion).toLocaleString("es-ES")}</td>
    </tr>
  `).join("");
}

["filtro-mc", "filtro-conectividad", "filtro-vinculacion"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderTablaSensores);
});
