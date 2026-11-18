// =========================================================================
// plataforma-consulta.js — panel "🌐 En la plataforma" (solo lectura, solo manager)
// Consulta en directo, a través del puente /api/lockbin-api:
//   · /device/    → todos los dispositivos, estén instalados o desvinculados
//   · /equipment/ → solo los equipos ACTIVOS hoy
// y enseña, para un MC o un IMEI, el dispositivo con su estado actual y si
// ahora mismo está activo en un equipo. Es una foto de la plataforma de este
// momento; el historial de movimientos sigue siendo el de Vida del Equipo.
// =========================================================================
(function () {
  const ESTADO_ES = { PENDING_INSTALL: "Pendiente de instalar", INSTALLED: "Instalado", ON_REVISION: "En revisión" };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fecha = v => (v ? new Date(v).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : "—");
  const fechaHora = v => (v ? new Date(v).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "—");

  async function llamar(sb, params) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Sesión de LockBin vencida. Vuelve a entrar.");
    const r = await fetch(`/api/lockbin-api?${new URLSearchParams(params).toString()}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error HTTP ${r.status}`);
    return j.items || [];
  }

  async function esManager(sb) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return false;
      const { data } = await sb.from("perfiles").select("rol").eq("id", user.id).maybeSingle();
      return !!data && data.rol === "manager";
    } catch (e) { return false; }
  }

  // consulta: lista de { mc } o { imei }
  async function consultar(sb, consultas) {
    const dispositivos = [], activos = [];
    for (const c of consultas) {
      const filtro = c.mc ? { serialBoard: c.mc } : { imei: c.imei };
      const ds = await llamar(sb, { accion: "dispositivos", pageNo: 0, pageSize: 20, ...filtro });
      ds.forEach(d => { if (!dispositivos.some(x => x.deviceId === d.deviceId)) dispositivos.push(d); });
    }
    // ¿Está activo ahora en un equipo? (por el MC de cada dispositivo)
    for (const d of dispositivos) {
      if (!d.serialBoard) continue;
      const es = await llamar(sb, { accion: "equipos", serialBoard: d.serialBoard, pageNo: 0, pageSize: 5 });
      const eq = es.find(e => String(e.serialBoard || "").toUpperCase() === String(d.serialBoard).toUpperCase());
      if (eq) activos.push({ mc: String(d.serialBoard).toUpperCase(), eq });
    }
    return { dispositivos, activos };
  }

  function html({ dispositivos, activos }) {
    if (!dispositivos.length) return `<p>La plataforma no tiene ningún dispositivo con ese dato.</p>`;
    return dispositivos.map(d => {
      const act = activos.find(a => a.mc === String(d.serialBoard || "").toUpperCase());
      const chipActivo = act
        ? `<span class="orep-badge orep-ok" style="background:#e4f3e0;color:#2e7d32;">🟢 Activo en un equipo${act.eq.serial ? " · contenedor " + esc(act.eq.serial) : ""}</span>`
        : `<span class="orep-badge" style="background:#ececec;color:#555;">⚪ No está activo en ningún equipo (desvinculado o sin instalar)</span>`;
      const filas = [
        ["MC", d.serialBoard], ["IMEI", d.imei], ["SIM (ICCID)", d.iccid],
        ["Estado de montaje", ESTADO_ES[d.installationStateName] || d.installationStateName],
        ["Cliente del dispositivo", d.deviceCustomerName],
        ["Cliente del equipo activo", act && act.eq.customerName],
        ["Batería", [d.serialBattery, d.batteryModelCode].filter(Boolean).join(" · ")],
        ["Cierre", [d.serialLock, d.lockModelCode].filter(Boolean).join(" · ")],
        ["Lector", [d.serialReader, d.readerModelCode].filter(Boolean).join(" · ")],
        ["Fecha de instalación", fecha(d.setupDate)], ["Fecha de fabricación", fecha(d.manufacturedDate)],
        ["Lote / fabricante", [d.lot, d.manufacturer].filter(Boolean).join(" · ")],
        ["Firmware / hardware", [d.firmwareName, d.hardwareName].filter(Boolean).join(" · ")],
        ["Broker", d.brokerName],
        ...(act ? [["Última comunicación", fechaHora(act.eq.lastCommunicationAt)]] : [])
      ].filter(([, v]) => v != null && v !== "" && v !== "—");
      return `<div style="border:1.5px solid #d5ddd6;border-radius:12px;padding:10px 14px;margin:8px 0;">
        <div style="margin-bottom:6px;">${chipActivo}</div>
        <table class="tabla-revision"><tbody>${filas.map(([k, v]) => `<tr><td style="width:210px;"><strong>${esc(k)}</strong></td><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`;
    }).join("");
  }

  // Dibuja el botón en "cont" (solo si el usuario es manager). consultas: [{mc}|{imei}]
  window.montarPanelPlataforma = async function (cont, sb, consultas) {
    cont.innerHTML = "";
    const lista = (consultas || []).filter(c => c && (c.mc || c.imei));
    if (!lista.length || !(await esManager(sb))) return;
    cont.innerHTML = `<div style="margin:14px 0;"><button type="button" class="btn-secundario" id="btn-plataforma-consulta">🌐 Ver en la plataforma</button>
      <div id="panel-plataforma-cuerpo" style="margin-top:8px;"></div></div>`;
    const btn = cont.querySelector("#btn-plataforma-consulta");
    const cuerpo = cont.querySelector("#panel-plataforma-cuerpo");
    btn.addEventListener("click", async () => {
      btn.disabled = true; cuerpo.textContent = "Consultando la plataforma…";
      try { cuerpo.innerHTML = html(await consultar(sb, lista)); }
      catch (e) { cuerpo.innerHTML = `<p class="resultado-msg resultado-error" style="display:block;">❌ ${esc(e.message)}</p>`; }
      finally { btn.disabled = false; }
    });
  };
})();
