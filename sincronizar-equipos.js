// =========================================================================
// SINCRONIZAR EQUIPOS DESDE LA PLATAFORMA (botón manual)
// Sustituye al Excel: trae TODOS los equipos activos de la API de Operaciones
// (a través del puente /api/lockbin-api) y deja la tabla "equipos" igual que
// la dejaba el importador del Excel: todas las columnas, por MC (upsert).
//   1) "Revisar": lee la plataforma, compara y enseña qué cambiaría (no escribe nada).
//   2) "Aplicar": sube los equipos en lotes. Nunca borra equipos.
// Equivalencias API → columna: ver aFila().
// =========================================================================
(function () {
  const RUTA_PUENTE = "/api/lockbin-api";
  const TAMANO_LOTE = 500;
  const ESTADO_API_ES = { PENDING_INSTALL: "Pendiente", INSTALLED: "Instalado", ON_REVISION: "En revisión" };
  const norm = v => (v == null ? "" : String(v)).trim().toUpperCase();
  const normSinAcentos = v => norm(v).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const texto = v => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const numero = v => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const iso = v => (v ? String(v) : null);
  // Fecha (solo día) en hora de España, como se veía en el Excel
  const soloDia = v => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  };

  const btnRevisar = document.getElementById("sync-revisar-btn");
  const btnAplicar = document.getElementById("sync-aplicar-btn");
  const estadoEl = document.getElementById("sync-estado");
  const resumenEl = document.getElementById("sync-resumen");
  let plan = null;

  // Un equipo de la API (ya aplanado por el puente) → una fila de la tabla "equipos"
  function aFila(i) {
    const lecturas = [];
    for (let n = 1; n <= 7; n++) {
      const valor = numero(i["batteryReading" + n]);
      if (valor !== null) lecturas.push({ valor, fecha: iso(i["batteryReading" + n + "At"]) });
    }
    return {
      m_control: String(i.serialBoard).trim(),
      cliente: texto(i.customerName) || texto(i.deviceCustomerName),
      serie_contenedor: texto(i.serial),
      imei: texto(i.imei),
      sim: texto(i.iccid),
      modelo_bateria: texto(i.batteryModelCode),
      serie_bateria: texto(i.serialBattery),
      modelo_cierre: texto(i.lockModelCode),
      serie_cierre: texto(i.serialLock),
      modelo_lector: texto(i.readerModelCode),
      serie_lector: texto(i.serialReader),
      lote: texto(i.lot),
      fabricante: texto(i.manufacturer),
      firmware: texto(i.firmwareName),
      hardware: texto(i.hardwareName),
      fecha_instalacion: soloDia(i.setupDate),
      fecha_fabricacion: soloDia(i.manufacturedDate),
      broker: texto(i.brokerName),
      estado_montaje: texto(ESTADO_API_ES[i.installationStateName] || i.installationStateName),
      modelo: texto(i.equipmentModelName),
      fraccion: texto(i.equipmentCategoryName),
      tipo_carga: texto(i.equipmentTypeName),
      latitud: numero(i.latitude),
      longitud: numero(i.longitude),
      ultima_apertura: iso(i.lastOpeningAt),
      ultima_comunicacion: iso(i.lastCommunicationAt),
      tipo_comunicacion: texto(i.communicationType),
      lecturas_bateria: lecturas,
      alarma_no_comunica: !!i.alertCommunications,
      alarma_error_servo: !!i.alertDamageServo,
      alarma_vuelco: !!i.alertDumped,
      alarma_incendio: !!i.alertFire,
      alarma_bloqueado: !!i.alertLocked,
      alarma_sin_bateria: !!i.alertNoBattery,
      alarma_tapa_abierta: !!i.alertOpenCover,
      secuencial: !!i.alertSequence,
      alarma_cambiar_bateria: !!i.recomendationChangeBattery,
      alarma_cambiar_ubicacion: !!i.recomendationChangeLocation,
      alarma_revisar_comunicacion: !!i.recomendationCheckCommunication,
      alarma_operacion_erratica: !!i.recomendationErraticOperation
    };
  }

  // Columnas "de ficha" que se comparan para el resumen (telemetría, alarmas y lecturas cambian a diario y no se comparan)
  const COLUMNAS_FICHA = ["cliente", "serie_contenedor", "imei", "sim", "modelo_bateria", "serie_bateria", "modelo_cierre", "serie_cierre",
    "modelo_lector", "serie_lector", "lote", "fabricante", "firmware", "hardware", "fecha_instalacion", "fecha_fabricacion", "broker",
    "estado_montaje", "modelo", "fraccion", "tipo_carga"];

  async function llamarPuente(params) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error("Sesión de LockBin vencida. Vuelve a entrar.");
    const r = await fetch(`${RUTA_PUENTE}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const cuerpoTexto = await r.text();
    let cuerpo = {};
    try { cuerpo = JSON.parse(cuerpoTexto); } catch (e) { /* no es JSON */ }
    if (!r.ok) throw new Error(cuerpo.error || `Error HTTP ${r.status}`);
    return cuerpo;
  }

  // No nos fiamos de las cabeceras de total/páginas (en producción no llegan): se piden páginas hasta que una venga vacía o incompleta.
  async function traerEquiposApi() {
    const TAM = 120;
    let items = [], pagina = 0, totalCabecera = 0;
    while (pagina < 1000) {
      const r = await llamarPuente({ accion: "equipos", pageNo: pagina, pageSize: TAM, sort: "id,asc" });
      const lote = r.items || [];
      if (pagina === 0) totalCabecera = Number(r.total) || 0;
      items = items.concat(lote);
      pagina++;
      estadoEl.textContent = `Leyendo la plataforma: página ${pagina} (${items.length} equipos${totalCabecera > TAM ? " de " + totalCabecera : ""})...`;
      if (lote.length < TAM) break;
    }
    items.totalDeclarado = totalCabecera > TAM ? totalCabecera : 0;
    items.paginas = pagina;
    return items;
  }

  async function traerNuestros() {
    let todas = [];
    const cols = ["m_control", "estado", ...COLUMNAS_FICHA].join(", ");
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabaseClient.from("equipos").select(cols).order("m_control").range(desde, desde + 999);
      if (error) throw error;
      todas = todas.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    return todas;
  }

  // "estado" (texto del Excel) ← generalStatus de la API. No conocemos los textos exactos, así que se APRENDEN de lo que ya
  // hay: para cada generalStatus, el texto más frecuente que nuestros equipos ya tienen (mínimo 5 equipos y 60 %).
  function aprenderEstados(api, porMc) {
    const cuentas = {};
    api.forEach(i => {
      const n = porMc.get(norm(i.serialBoard));
      if (!n || !i.generalStatus) return;
      const t = (n.estado || "").trim();
      if (!t) return;
      const c = (cuentas[i.generalStatus] = cuentas[i.generalStatus] || { total: 0, textos: {} });
      c.total++; c.textos[t] = (c.textos[t] || 0) + 1;
    });
    const mapa = {};
    Object.entries(cuentas).forEach(([g, c]) => {
      const [txt, n] = Object.entries(c.textos).sort((a, b) => b[1] - a[1])[0];
      if (n >= 5 && n / c.total >= 0.6) mapa[g] = txt;
    });
    return mapa;
  }

  btnRevisar.addEventListener("click", async () => {
    btnRevisar.disabled = true; btnAplicar.disabled = true; resumenEl.innerHTML = ""; plan = null;
    try {
      const api = await traerEquiposApi();
      estadoEl.textContent = "Comparando con nuestra tabla...";
      const nuestros = await traerNuestros();
      const porMc = new Map(nuestros.map(e => [norm(e.m_control), e]));

      const sinMc = api.filter(i => !norm(i.serialBoard));
      const vistos = new Map();
      let repetidos = 0;
      api.filter(i => norm(i.serialBoard)).forEach(i => { if (vistos.has(norm(i.serialBoard))) repetidos++; vistos.set(norm(i.serialBoard), i); });

      // «estado» (OK / Necesita atención...): solo se escribe si se ha podido aprender el texto de TODOS los generalStatus presentes
      const mapaEstado = aprenderEstados([...vistos.values()], porMc);
      const estadosApi = [...new Set([...vistos.values()].map(i => i.generalStatus).filter(Boolean))];
      const escribirEstado = estadosApi.length > 0 && estadosApi.every(g => mapaEstado[g]);

      const filas = [], nuevos = [], cambios = [];
      const porColumna = {};
      vistos.forEach((i, mcN) => {
        const fila = aFila(i);
        if (escribirEstado) fila.estado = i.generalStatus ? mapaEstado[i.generalStatus] : null;
        fila.actualizado_en = new Date().toISOString();
        filas.push(fila);
        const nuestro = porMc.get(mcN);
        if (!nuestro) { nuevos.push(fila); return; }
        const dif = {};
        COLUMNAS_FICHA.forEach(col => {
          const a = fila[col], b = nuestro[col];
          if (normSinAcentos(a) !== normSinAcentos(b)) { dif[col] = [b, a]; porColumna[col] = (porColumna[col] || 0) + 1; }
        });
        if (Object.keys(dif).length) cambios.push({ mc: nuestro.m_control, dif });
      });

      const yaNoActivos = nuestros.filter(e => !vistos.has(norm(e.m_control)));
      const pendientesDeMarcar = yaNoActivos.filter(e => norm(e.estado_montaje) !== "DESVINCULADO");
      // Seguridad: solo se marca si la lectura de la plataforma está completa y no es sospechosamente pequeña
      const lecturaCompleta = api.length >= (api.totalDeclarado || 0);
      const activosNuestros = nuestros.filter(e => norm(e.estado_montaje) !== "DESVINCULADO").length;
      const lecturaPlausible = vistos.size >= activosNuestros * 0.5;
      const marcarDesvinculados = lecturaCompleta && lecturaPlausible ? pendientesDeMarcar.map(e => e.m_control) : [];
      const omitidoPorSeguridad = pendientesDeMarcar.length > 0 && !marcarDesvinculados.length;
      const camposApi = api.length ? Object.keys(api[0]).sort() : [];
      plan = { filas, marcarDesvinculados };

      const muestra = cambios.slice(0, 40).map(c => `<tr><td>${esc(c.mc)}</td><td>${Object.entries(c.dif).map(([k, [b, a]]) => `${esc(k)}: <s>${esc(b ?? "—")}</s> → <strong>${esc(a ?? "—")}</strong>`).join("<br>")}</td></tr>`).join("");
      resumenEl.innerHTML = `
        <p><strong>${api.length}</strong> equipos activos en la plataforma (${api.paginas} páginas leídas) · <strong>${nuestros.length}</strong> en nuestra tabla.</p>
        <ul>
          <li>🆕 Equipos nuevos que se crearían: <strong>${nuevos.length}</strong></li>
          <li>✏️ Equipos existentes con datos de ficha distintos: <strong>${cambios.length}</strong>${Object.keys(porColumna).length ? " (" + Object.entries(porColumna).map(([k, n]) => `${esc(k)}: ${n}`).join(", ") + ")" : ""}</li>
          <li>📡 Se refrescan en TODOS (${filas.length}): comunicación, última apertura, lecturas de batería, alarmas, ubicación.</li>
          <li>📦 En nuestra tabla pero ya NO activos en la plataforma: <strong>${yaNoActivos.length}</strong>. ${marcarDesvinculados.length ? `Se marcarán como <strong>Desvinculado</strong> (estado de montaje): <strong>${marcarDesvinculados.length}</strong>. Nunca se borran.` : (omitidoPorSeguridad ? "⚠️ No se marcan como desvinculados: la lectura de la plataforma parece incompleta. Vuelve a pulsar «Revisar»." : "Ya figuran como desvinculados.")}</li>
          <li>${escribirEstado ? "✅" : "⚠️"} Columna «estado»: ${escribirEstado ? "se actualiza (" + Object.entries(mapaEstado).map(([g, t]) => esc(g) + " → «" + esc(t) + "»").join(", ") + ")" : "no se toca (no pude deducir sus textos; estados en la API: " + (estadosApi.map(esc).join(", ") || "ninguno") + ")"}</li>
          ${sinMc.length ? `<li>⚠️ En la plataforma sin MC (se ignoran): <strong>${sinMc.length}</strong></li>` : ""}
          ${repetidos ? `<li>⚠️ MC repetidos en la plataforma: <strong>${repetidos}</strong> (se usa el último)</li>` : ""}
        </ul>
        ${cambios.length ? `<details><summary>Ver los primeros ${Math.min(40, cambios.length)} cambios de ficha</summary><div class="scroll-x-tabla" style="max-height:320px;"><table class="tabla-revision"><thead><tr><th>MC</th><th>Cambios</th></tr></thead><tbody>${muestra}</tbody></table></div></details>` : ""}
        ${yaNoActivos.length ? `<details><summary>Ver los ${yaNoActivos.length} MC que ya no están activos</summary><p style="font-size:.85rem;word-break:break-word;">${yaNoActivos.slice(0, 400).map(e => esc(e.m_control)).join(", ")}${yaNoActivos.length > 400 ? "…" : ""}</p></details>` : ""}
        <details><summary>Ejemplo de una fila tal como se guardaría</summary><pre style="font-size:.8rem;white-space:pre-wrap;word-break:break-word;">${esc(JSON.stringify(filas[0] || {}, null, 2))}</pre></details>
        <details><summary>Campos que devuelve la API</summary><p style="font-size:.85rem;word-break:break-word;">${camposApi.map(esc).join(", ")}</p></details>`;
      estadoEl.textContent = filas.length ? "Revisa el resumen y pulsa «Aplicar cambios»." : "La plataforma no devolvió equipos con MC.";
      btnAplicar.disabled = !filas.length;
    } catch (err) {
      console.error(err);
      estadoEl.textContent = "❌ " + err.message;
    } finally {
      btnRevisar.disabled = false;
    }
  });

  btnAplicar.addEventListener("click", async () => {
    if (!plan) return;
    if (!confirm(`Se actualizarán ${plan.filas.length} equipos con los datos de la plataforma (los nuevos se crean)${(plan.marcarDesvinculados || []).length ? ` y se marcarán ${plan.marcarDesvinculados.length} como Desvinculado` : ""}. No se borra ningún equipo.\n\n¿Continuar?`)) return;
    btnAplicar.disabled = true; btnRevisar.disabled = true;
    try {
      let hechos = 0;
      for (let i = 0; i < plan.filas.length; i += TAMANO_LOTE) {
        const lote = plan.filas.slice(i, i + TAMANO_LOTE);
        const { error } = await supabaseClient.from("equipos").upsert(lote, { onConflict: "m_control" });
        if (error) throw new Error(error.message + " — en el lote de la fila " + (i + 1) + " a la " + (i + lote.length));
        hechos += lote.length;
        estadoEl.textContent = `Aplicando... ${hechos} de ${plan.filas.length} equipos`;
      }
      const aMarcar = plan.marcarDesvinculados || [];
      for (let i = 0; i < aMarcar.length; i += 200) {
        const trozo = aMarcar.slice(i, i + 200);
        const { error } = await supabaseClient.from("equipos").update({ estado_montaje: "Desvinculado", actualizado_en: new Date().toISOString() }).in("m_control", trozo);
        if (error) throw new Error("Al marcar desvinculados: " + error.message);
        estadoEl.textContent = `Marcando desvinculados... ${Math.min(i + 200, aMarcar.length)} de ${aMarcar.length}`;
      }
      estadoEl.textContent = `✅ Listo. ${hechos} equipos sincronizados${aMarcar.length ? " y " + aMarcar.length + " marcados como desvinculados" : ""}.`;
      resumenEl.innerHTML = "";
      plan = null;
      if (typeof cargarTotalEquipos === "function") cargarTotalEquipos();
    } catch (err) {
      console.error(err);
      estadoEl.textContent = "❌ Error al aplicar: " + err.message + " (lo ya subido se mantiene; puedes volver a pulsar «Revisar»).";
    } finally {
      btnRevisar.disabled = false;
    }
  });
})();
