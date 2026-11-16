// =========================================================================
// SINCRONIZAR EQUIPOS DESDE LA PLATAFORMA (botón manual)
// Reemplaza la subida del Excel: trae los equipos ACTIVOS de la API de
// Operaciones (a través del puente /api/lockbin-api) y actualiza la tabla
// "equipos". Funciona en dos pasos:
//   1) "Revisar": compara y muestra qué cambiaría (no escribe nada).
//   2) "Aplicar": crea los equipos nuevos y corrige solo las columnas que
//      difieren. Nunca borra equipos ni pisa un dato con uno vacío.
// =========================================================================
(function () {
  const RUTA_PUENTE = "/api/lockbin-api";
  const ESTADO_API_ES = { PENDING_INSTALL: "Pendiente", INSTALLED: "Instalado", ON_REVISION: "En revisión" };
  const norm = v => (v == null ? "" : String(v)).trim().toUpperCase();
  const normSinAcentos = v => norm(v).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const estadoEs = n => (n == null || n === "" ? "" : (ESTADO_API_ES[n] || n));

  // Columnas que se corrigen en equipos que YA existen: [columna nuestra, campo de la API, normalizador, valor a guardar]
  const CAMPOS_EXISTENTES = [
    ["imei", i => i.imei, norm],
    ["cliente", i => i.customerName, normSinAcentos],
    ["serie_bateria", i => i.serialBattery, norm],
    ["serie_cierre", i => i.serialLock, norm],
    ["serie_lector", i => i.serialReader, norm],
    ["estado_montaje", i => estadoEs(i.installationStateName), normSinAcentos]
  ];
  // Columnas extra que solo se rellenan al CREAR un equipo nuevo
  const CAMPOS_NUEVOS = [
    ["modelo_bateria", i => i.batteryModelCode],
    ["modelo_cierre", i => i.lockModelCode],
    ["modelo_lector", i => i.readerModelCode]
  ];

  const btnRevisar = document.getElementById("sync-revisar-btn");
  const btnAplicar = document.getElementById("sync-aplicar-btn");
  const estadoEl = document.getElementById("sync-estado");
  const resumenEl = document.getElementById("sync-resumen");
  let plan = null;

  async function llamarPuente(params) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error("Sesión de LockBin vencida. Vuelve a entrar.");
    const r = await fetch(`${RUTA_PUENTE}?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const texto = await r.text();
    let cuerpo = {};
    try { cuerpo = JSON.parse(texto); } catch (e) { /* no es JSON */ }
    if (!r.ok) throw new Error(cuerpo.error || `Error HTTP ${r.status}`);
    return cuerpo;
  }

  async function traerEquiposApi() {
    let items = [], pagina = 0, totalPaginas = 1, total = 0;
    while (pagina < totalPaginas && pagina < 1000) {
      const r = await llamarPuente({ accion: "equipos", pageNo: pagina, pageSize: 120, sort: "id,asc" });
      total = r.total; totalPaginas = r.totalPaginas;
      items = items.concat(r.items || []);
      pagina++;
      estadoEl.textContent = `Leyendo la plataforma: página ${pagina} de ${Math.max(totalPaginas, 1)} (${items.length} de ${total})...`;
    }
    return items;
  }

  async function traerNuestros() {
    let todas = [];
    const cols = "m_control, " + CAMPOS_EXISTENTES.map(c => c[0]).join(", ");
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabaseClient.from("equipos").select(cols).order("m_control").range(desde, desde + 999);
      if (error) throw error;
      todas = todas.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    return todas;
  }

  btnRevisar.addEventListener("click", async () => {
    btnRevisar.disabled = true; btnAplicar.disabled = true; resumenEl.innerHTML = ""; plan = null;
    try {
      const api = await traerEquiposApi();
      estadoEl.textContent = "Comparando con nuestra tabla...";
      const nuestros = await traerNuestros();
      const porMc = new Map(nuestros.map(e => [norm(e.m_control), e]));

      const sinMc = api.filter(i => !norm(i.serialBoard));
      const vistos = new Map();           // MC -> item (si la API repite un MC, nos quedamos con el último)
      let repetidos = 0;
      api.filter(i => norm(i.serialBoard)).forEach(i => { if (vistos.has(norm(i.serialBoard))) repetidos++; vistos.set(norm(i.serialBoard), i); });

      const nuevos = [], cambios = [];
      const porColumna = {};
      vistos.forEach((i, mcN) => {
        const mc = String(i.serialBoard).trim();
        const nuestro = porMc.get(mcN);
        if (!nuestro) {
          const fila = { m_control: mc };
          CAMPOS_EXISTENTES.forEach(([col, get]) => { const v = get(i); fila[col] = v == null || String(v).trim() === "" ? null : String(v).trim(); });
          CAMPOS_NUEVOS.forEach(([col, get]) => { const v = get(i); fila[col] = v == null || String(v).trim() === "" ? null : String(v).trim(); });
          nuevos.push(fila);
          return;
        }
        const cambio = {};
        CAMPOS_EXISTENTES.forEach(([col, get, f]) => {
          const v = get(i);
          if (v == null || String(v).trim() === "") return;            // la API no trae el dato: no se toca
          if (f(nuestro[col]) !== f(v)) { cambio[col] = String(v).trim(); porColumna[col] = (porColumna[col] || 0) + 1; }
        });
        if (Object.keys(cambio).length) cambios.push({ mc: nuestro.m_control, cambio, antes: Object.fromEntries(Object.keys(cambio).map(c => [c, nuestro[c]])) });
      });

      const yaNoActivos = nuestros.filter(e => !vistos.has(norm(e.m_control))).map(e => e.m_control);
      const camposApi = api.length ? Object.keys(api[0]).sort() : [];
      plan = { nuevos, cambios };

      const filasMuestra = cambios.slice(0, 40).map(c => `<tr><td>${esc(c.mc)}</td><td>${Object.keys(c.cambio).map(k => `${esc(k)}: <s>${esc(c.antes[k] ?? "—")}</s> → <strong>${esc(c.cambio[k])}</strong>`).join("<br>")}</td></tr>`).join("");
      resumenEl.innerHTML = `
        <p><strong>${api.length}</strong> equipos activos en la plataforma · <strong>${nuestros.length}</strong> en nuestra tabla.</p>
        <ul>
          <li>🆕 Equipos nuevos que se crearían: <strong>${nuevos.length}</strong></li>
          <li>✏️ Equipos existentes con datos distintos: <strong>${cambios.length}</strong>${Object.keys(porColumna).length ? " (" + Object.entries(porColumna).map(([k, n]) => `${esc(k)}: ${n}`).join(", ") + ")" : ""}</li>
          <li>📦 En nuestra tabla pero ya no activos en la plataforma: <strong>${yaNoActivos.length}</strong> (no se tocan ni se borran)</li>
          ${sinMc.length ? `<li>⚠️ En la plataforma sin MC (se ignoran): <strong>${sinMc.length}</strong></li>` : ""}
          ${repetidos ? `<li>⚠️ MC repetidos en la plataforma: <strong>${repetidos}</strong> (se usa el último)</li>` : ""}
        </ul>
        ${cambios.length ? `<details><summary>Ver los primeros ${Math.min(40, cambios.length)} cambios</summary><div class="scroll-x-tabla" style="max-height:320px;"><table class="tabla-revision"><thead><tr><th>MC</th><th>Cambios</th></tr></thead><tbody>${filasMuestra}</tbody></table></div></details>` : ""}
        ${yaNoActivos.length ? `<details><summary>Ver los ${yaNoActivos.length} MC que ya no están activos</summary><p style="font-size:.85rem;word-break:break-word;">${yaNoActivos.slice(0, 400).map(esc).join(", ")}${yaNoActivos.length > 400 ? "…" : ""}</p></details>` : ""}
        <details><summary>Campos que devuelve la API (por si falta alguno por traer)</summary><p style="font-size:.85rem;word-break:break-word;">${camposApi.map(esc).join(", ")}</p></details>`;
      estadoEl.textContent = nuevos.length + cambios.length ? "Revisa el resumen y pulsa «Aplicar cambios»." : "✅ Todo está al día, no hay nada que actualizar.";
      btnAplicar.disabled = !(nuevos.length + cambios.length);
    } catch (err) {
      console.error(err);
      estadoEl.textContent = "❌ " + err.message;
    } finally {
      btnRevisar.disabled = false;
    }
  });

  btnAplicar.addEventListener("click", async () => {
    if (!plan) return;
    if (!confirm(`Se crearán ${plan.nuevos.length} equipos y se corregirán ${plan.cambios.length}. No se borra nada.\n\n¿Continuar?`)) return;
    btnAplicar.disabled = true; btnRevisar.disabled = true;
    try {
      let hechos = 0; const total = plan.nuevos.length + plan.cambios.length;
      for (let i = 0; i < plan.nuevos.length; i += 500) {
        const lote = plan.nuevos.slice(i, i + 500);
        const { error } = await supabaseClient.from("equipos").upsert(lote, { onConflict: "m_control" });
        if (error) throw new Error(error.message);
        hechos += lote.length;
        estadoEl.textContent = `Aplicando... ${hechos} de ${total}`;
      }
      for (let i = 0; i < plan.cambios.length; i += 20) {
        const grupo = plan.cambios.slice(i, i + 20);
        const res = await Promise.all(grupo.map(c => supabaseClient.from("equipos").update(c.cambio).eq("m_control", c.mc)));
        const fallo = res.find(r => r.error);
        if (fallo) throw new Error(fallo.error.message);
        hechos += grupo.length;
        estadoEl.textContent = `Aplicando... ${hechos} de ${total}`;
      }
      estadoEl.textContent = `✅ Listo. ${plan.nuevos.length} equipos nuevos y ${plan.cambios.length} corregidos.`;
      resumenEl.innerHTML = "";
      plan = null;
      if (typeof cargarTotalEquipos === "function") cargarTotalEquipos();
    } catch (err) {
      console.error(err);
      estadoEl.textContent = "❌ Error al aplicar: " + err.message + " (lo ya aplicado se mantiene; puedes volver a pulsar «Revisar»).";
    } finally {
      btnRevisar.disabled = false;
    }
  });
})();
