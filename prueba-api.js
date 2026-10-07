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

async function enviarEscritura(cuerpo) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Sesión de LockBin vencida. Vuelve a entrar.");
  const r = await fetch(RUTA_PUENTE, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo)
  });
  const resp = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(resp.error || `Error HTTP ${r.status}`);
  return resp;
}

// ---------- 1. Probar conexión ----------
document.getElementById("btn-conexion").addEventListener("click", async () => {
  const salida = document.getElementById("salida-conexion");
  salida.textContent = "Probando...";
  try {
    const u = await llamarPuente({ accion: "whoami" });
    salida.textContent =
      `✅ Conexión correcta\nUsuario de la API: ${u.username}\nRoles: ${(u.roles || []).join(", ")}\n` +
      `idCustomer: ${u.idCustomer ?? "null (ve todos los clientes)"}\n` +
      `Servidor: ${u.host} — escrituras ${u.escrituraPermitida ? "permitidas (preproducción)" : "BLOQUEADAS"}`;
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


// =========================================================================
// 3. Pruebas de escritura (solo preproducción)
// =========================================================================
let dispositivosCargados = [];

document.getElementById("btn-cargar-dispositivos").addEventListener("click", async () => {
  const sel = document.getElementById("escritura-dispositivo");
  const salida = document.getElementById("salida-escritura");
  salida.textContent = "Cargando dispositivos...";
  try {
    const filtro = document.getElementById("escritura-filtro").value.trim();
    const params = { accion: "equipos", pageNo: 0, pageSize: 120, sort: "id,asc" };
    if (filtro) params.serialBoard = filtro;
    const r = await llamarPuente(params);
    dispositivosCargados = (r.items || []).filter(i => i.deviceId != null);
    sel.innerHTML = dispositivosCargados.length === 0
      ? '<option value="">Sin dispositivos con este filtro</option>'
      : dispositivosCargados.map((i, n) =>
          `<option value="${n}">${esc(i.serialBoard || "(sin MC)")} · dev ${i.deviceId} · ${esc(i.customerName)} · ${esc(i.installationStateTypeLabel)} · BA ${esc(i.serialBattery || "-")} CE ${esc(i.serialLock || "-")} LE ${esc(i.serialReader || "-")}</option>`
        ).join("");
    salida.textContent = `${dispositivosCargados.length} dispositivos cargados (de ${r.total} equipos).`;
  } catch (e) {
    salida.textContent = "❌ " + e.message;
  }
});

function resumenDispositivo(i) {
  return i ? `MC ${i.serialBoard} | dev ${i.deviceId} | BA ${i.serialBattery || "-"} (${i.batteryModelCode || "-"}) | CE ${i.serialLock || "-"} (${i.lockModelCode || "-"}) | LE ${i.serialReader || "-"} (${i.readerModelCode || "-"}) | ${i.installationStateTypeLabel}` : "(no encontrado)";
}

async function leerPorMc(mc) {
  const r = await llamarPuente({ accion: "equipos", serialBoard: mc, pageSize: 5 });
  return (r.items || []).find(i => norm(i.serialBoard) === norm(mc)) || null;
}

function interpretarEstado(estado, resp, accion) {
  if (estado === 200 || estado === 201) return "✅ La API aceptó el cambio";
  if (estado === 400 && resp?.code === "007") return `⚠️ 400 / código 007: el serial no está en el registro de preinstalación (${resp.description})`;
  if (estado === 400) return "⚠️ 400: petición mal formada " + JSON.stringify(resp);
  if (estado === 401) return "⚠️ 401: sin sesión en la API";
  if (estado === 403) return "⚠️ 403: la cuenta de la API no tiene ROLE_MANAGER_OPERATIONS";
  if (estado === 404) return "⚠️ 404: no existe ese dispositivo";
  if (estado === 409 && resp?.code === "009") return "⚠️ 409 / código 009: el dispositivo sigue vinculado a un equipo (hay que desvincularlo antes de reciclar)";
  if (estado === 409 && resp?.code === "010") return "⚠️ 409 / código 010: ese serial de placa ya existe en otro dispositivo habilitado";
  if (estado === 415) return "⚠️ 415: tipo de contenido no válido";
  return `⚠️ La API respondió HTTP ${estado}`;
}

document.getElementById("btn-escribir").addEventListener("click", async () => {
  const salida = document.getElementById("salida-escritura");
  const indice = document.getElementById("escritura-dispositivo").value;
  const accion = document.getElementById("escritura-accion").value;
  const valor = document.getElementById("escritura-valor").value.trim().toUpperCase();
  const disp = dispositivosCargados[Number(indice)];

  if (!disp) { salida.textContent = "Elige un dispositivo (primero pulsa \"Cargar dispositivos\")."; return; }
  if (!valor) { salida.textContent = "Escribe el serial nuevo."; return; }
  if (!confirm(`Se enviará a la API de PRUEBAS:\n\n${accion} → ${valor}\nDispositivo ${disp.deviceId} (MC ${disp.serialBoard})\n\n¿Continuar?`)) return;

  const boton = document.getElementById("btn-escribir");
  boton.disabled = true;
  salida.textContent = "Enviando...";
  try {
    const antes = resumenDispositivo(disp);
    const r = await enviarEscritura({ accion, deviceId: disp.deviceId, valor });

    let texto = `${interpretarEstado(r.estadoApi, r.respuesta, accion)}\n`;
    texto += `HTTP ${r.estadoApi}${r.respuesta ? " — " + JSON.stringify(r.respuesta) : ""}\n`;
    texto += r.registrado ? "Registrado en el historial.\n" : "⚠️ No se pudo registrar en el historial (¿falta correr el SQL 69?).\n";

    if (r.estadoApi === 200 || r.estadoApi === 201) {
      const despues = accion === "recycle"
        ? (await leerPorMc(valor)) // dispositivo nuevo
        : (await leerPorMc(disp.serialBoard));
      texto += `\nANTES:   ${antes}\nDESPUÉS: ${resumenDispositivo(despues)}`;
      if (accion === "recycle") {
        const viejo = await leerPorMc(disp.serialBoard);
        texto += `\nMC anterior sigue en el listado: ${viejo ? "SÍ → " + resumenDispositivo(viejo) : "NO"}`;
      }
    }
    salida.textContent = texto;
    cargarLog();
  } catch (e) {
    salida.textContent = "❌ " + e.message;
  } finally {
    boton.disabled = false;
  }
});

async function cargarLog() {
  const caja = document.getElementById("log-operaciones");
  const { data, error } = await supabaseClient.from("api_operaciones_log")
    .select("fecha, usuario_email, accion, device_id, datos, estado_api")
    .order("fecha", { ascending: false }).limit(10);
  if (error) { caja.textContent = "Aún no hay historial (¿falta correr el SQL 69?): " + error.message; return; }
  caja.innerHTML = !data.length ? "<p>Ninguna todavía.</p>" : `
    <table class="tabla-revision"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Dispositivo</th><th>Enviado</th><th>HTTP</th></tr></thead>
    <tbody>${data.map(l => `<tr><td>${esc(new Date(l.fecha).toLocaleString("es-ES"))}</td><td>${esc(l.usuario_email)}</td><td>${esc(l.accion)}</td><td>${esc(l.device_id)}</td><td>${esc(JSON.stringify(l.datos))}</td><td>${esc(l.estado_api)}</td></tr>`).join("")}</tbody></table>`;
}
cargarLog();
