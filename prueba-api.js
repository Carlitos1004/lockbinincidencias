// =========================================================================
// Prueba de la API de Operaciones — SOLO LECTURA
// Llama al puente /api/lockbin-api (servidor) y compara lo que devuelve la
// API con la tabla "equipos". No escribe nada en ninguna parte.
// =========================================================================

const RUTA_PUENTE = "/api/lockbin-api";
let diferenciasCsv = [];

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const norm = v => (v == null ? "" : String(v)).trim().toUpperCase();
const normSinAcentos = v => norm(v).normalize("NFD").replace(/[̀-ͯ]/g, "");

async function llamarPuente(params) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Sesión de LockBin vencida. Vuelve a entrar.");
  const qs = new URLSearchParams(params).toString();
  let r;
  try {
    r = await fetch(`${RUTA_PUENTE}?${qs}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  } catch (e) {
    throw new Error("No se pudo contactar con el puente: " + e.message);
  }
  const texto = await r.text();
  let cuerpo = {};
  try { cuerpo = JSON.parse(texto); } catch (e) { /* respuesta que no es JSON */ }
  if (!r.ok) {
    if (r.status === 404) throw new Error("El puente no existe todavía (404). ¿Se subió la carpeta api/ y se desplegó en Vercel?");
    throw new Error(cuerpo.error || `Error HTTP ${r.status}`);
  }
  return cuerpo;
}

async function traerTodasLasFilas(tabla, columnas) {
  const TAM = 1000;
  let desde = 0, todas = [];
  while (true) {
    const { data, error } = await supabaseClient.from(tabla).select(columnas).range(desde, desde + TAM - 1);
    if (error) throw error;
    todas = todas.concat(data || []);
    if (!data || data.length < TAM) break;
    desde += TAM;
  }
  return todas;
}

// ---------- 1. Probar conexión ----------
document.getElementById("btn-conexion").addEventListener("click", async () => {
  const salida = document.getElementById("salida-conexion");
  salida.textContent = "Probando...";
  try {
    const u = await llamarPuente({ accion: "whoami" });
    salida.textContent =
      `✅ Conexión correcta\nUsuario de la API: ${u.username}\nRoles: ${(u.roles || []).join(", ")}\n` +
      `idCustomer: ${u.idCustomer ?? "null (ve todos los clientes)"}`;
  } catch (e) {
    salida.textContent = "❌ " + e.message;
  }
});

// ---------- 2. Comparar ----------
async function traerEquiposApi(filtro, customerId, estado) {
  let items = [], pagina = 0, totalPaginas = 1, total = 0;
  while (pagina < totalPaginas) {
    const params = { accion: "equipos", pageNo: pagina, pageSize: 120, sort: "id,asc" };
    if (filtro) params.serialBoard = filtro;
    if (customerId) params.customerId = customerId;
    const r = await llamarPuente(params);
    total = r.total;
    totalPaginas = r.totalPaginas;
    items = items.concat(r.items || []);
    pagina++;
    estado(`API: página ${pagina} de ${Math.max(totalPaginas, 1)} (${items.length} de ${total})...`);
    if (pagina >= 1000) break;
  }
  return { items, total };
}

document.getElementById("btn-comparar").addEventListener("click", async () => {
  const estado = (t) => { document.getElementById("estado-comparacion").textContent = t; };
  const boton = document.getElementById("btn-comparar");
  boton.disabled = true;
  document.getElementById("btn-csv").hidden = true;
  document.getElementById("resumen-api").innerHTML = "";
  document.getElementById("resultado-api").innerHTML = "";

  try {
    const filtro = document.getElementById("filtro-serial-board").value.trim();
    const customerId = document.getElementById("filtro-customer-id").value.trim();

    const { items, total } = await traerEquiposApi(filtro, customerId, estado);
    estado("Leyendo la tabla equipos...");
    const nuestros = await traerTodasLasFilas("equipos",
      "m_control, imei, cliente, serie_lector, serie_cierre, serie_bateria, estado_montaje, actualizado_en");

    const porMc = new Map(nuestros.map(e => [norm(e.m_control), e]));

    const sinMc = items.filter(i => !norm(i.serialBoard));
    const conMc = items.filter(i => norm(i.serialBoard));

    // Repetidos dentro de la API (mismo MC o mismo IMEI en varias filas)
    const cuentaMc = {}, cuentaImei = {};
    conMc.forEach(i => {
      cuentaMc[norm(i.serialBoard)] = (cuentaMc[norm(i.serialBoard)] || 0) + 1;
      if (norm(i.imei)) cuentaImei[norm(i.imei)] = (cuentaImei[norm(i.imei)] || 0) + 1;
    });
    const mcRepetidos = Object.keys(cuentaMc).filter(k => cuentaMc[k] > 1);
    const imeiRepetidos = Object.keys(cuentaImei).filter(k => cuentaImei[k] > 1);

    const CAMPOS = [
      ["IMEI", "imei", "imei", norm],
      ["Cliente", "cliente", "customerName", normSinAcentos],
      ["Lector", "serie_lector", "serialReader", norm],
      ["Cierre", "serie_cierre", "serialLock", norm],
      ["Batería", "serie_bateria", "serialBattery", norm]
    ];

    const diferencias = [], soloApi = [], estados = [];
    let coincidenTodo = 0, enAmbos = 0;
    conMc.forEach(i => {
      const nuestro = porMc.get(norm(i.serialBoard));
      if (!nuestro) { soloApi.push(i); return; }
      enAmbos++;
      let hayDif = false;
      CAMPOS.forEach(([etiqueta, colNuestra, campoApi, f]) => {
        if (f(nuestro[colNuestra]) !== f(i[campoApi])) {
          hayDif = true;
          diferencias.push({ mc: i.serialBoard, campo: etiqueta, nuestro: nuestro[colNuestra] ?? "", api: i[campoApi] ?? "" });
        }
      });
      if (!hayDif) coincidenTodo++;
      estados.push({ mc: i.serialBoard, nuestro: nuestro.estado_montaje ?? "", api: i.installationStateTypeLabel ?? "", actualizado: nuestro.actualizado_en });
    });

    const soloNuestros = nuestros.filter(e => !conMc.some(i => norm(i.serialBoard) === norm(e.m_control))).length;

    diferenciasCsv = diferencias;
    document.getElementById("btn-csv").hidden = diferencias.length === 0;

    document.getElementById("resumen-api").innerHTML = `
      <div class="tarjeta-resumen"><strong>${total}</strong><span>Equipos que devuelve la API (con este filtro)</span></div>
      <div class="tarjeta-resumen"><strong>${conMc.length}</strong><span>…con MC (se pueden cruzar)</span></div>
      <div class="tarjeta-resumen"><strong>${sinMc.length}</strong><span>…sin MC (se saltan)</span></div>
      <div class="tarjeta-resumen"><strong>${nuestros.length}</strong><span>Equipos en nuestra tabla</span></div>
      <div class="tarjeta-resumen"><strong>${enAmbos}</strong><span>MC en ambos lados</span></div>
      <div class="tarjeta-resumen"><strong>${coincidenTodo}</strong><span>Coinciden en todos los campos</span></div>
      <div class="tarjeta-resumen ${soloApi.length ? "tarjeta-alerta" : ""}"><strong>${soloApi.length}</strong><span>Solo en la API</span></div>
      <div class="tarjeta-resumen"><strong>${soloNuestros}</strong><span>Solo en nuestra tabla (con este filtro es normal)</span></div>
      <div class="tarjeta-resumen ${mcRepetidos.length + imeiRepetidos.length ? "tarjeta-alerta" : ""}"><strong>${mcRepetidos.length} / ${imeiRepetidos.length}</strong><span>MC repetidos / IMEI repetidos en la API</span></div>
    `;

    const tabla = (titulo, cabecera, filas) => `
      <h3 style="margin-top:24px;">${titulo}</h3>
      ${filas.length === 0 ? "<p>Ninguno.</p>" : `
      <table class="tabla-revision"><thead><tr>${cabecera.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`}`;

    document.getElementById("resultado-api").innerHTML =
      tabla("Diferencias entre la API y nuestra tabla", ["MC", "Campo", "Nuestro valor", "Valor de la API"],
        diferencias.map(d => [d.mc, d.campo, d.nuestro, d.api])) +
      tabla("MC que están en la API y no en nuestra tabla", ["MC", "IMEI", "Cliente", "Estado API"],
        soloApi.map(i => [i.serialBoard, i.imei, i.customerName, i.installationStateTypeLabel])) +
      tabla("Estado de montaje: nuestro vs API (solo informativo)", ["MC", "Nuestro estado_montaje", "Estado API", "Fila nuestra actualizada"],
        estados.map(e => [e.mc, e.nuestro, e.api, e.actualizado ? new Date(e.actualizado).toLocaleDateString("es-ES") : ""])) +
      (mcRepetidos.length || imeiRepetidos.length ? tabla("Repetidos dentro de la API", ["Tipo", "Valor"],
        [...mcRepetidos.map(v => ["MC", v]), ...imeiRepetidos.map(v => ["IMEI", v])]) : "");

    estado(`Listo. ${items.length} equipos leídos de la API y ${nuestros.length} de nuestra tabla.`);
  } catch (e) {
    estado("❌ " + e.message);
  } finally {
    boton.disabled = false;
  }
});

document.getElementById("btn-csv").addEventListener("click", () => {
  const celda = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = [["MC", "Campo", "Nuestro valor", "Valor de la API"], ...diferenciasCsv.map(d => [d.mc, d.campo, d.nuestro, d.api])];
  const csv = "﻿" + filas.map(f => f.map(celda).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "diferencias-api-equipos.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
