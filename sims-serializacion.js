// =========================================================================
// SIMs de los equipos de una OT (Serialización de Materiales): al pulsar «Guardar SIM», se consulta
// la plataforma por el MC, se copia el ICCID de la SIM que lleva el equipo y se guarda en custodia
// (la SIM del cliente, p. ej. NOS) antes de probar el equipo con una SIM de aquí.
// =========================================================================
const escSm = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };

async function iccidDePlataforma(mc) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Sesión vencida.");
  const r = await fetch(`/api/lockbin-api?accion=equipos&serialBoard=${encodeURIComponent(mc)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  const e = (j.items || []).find(x => String(x.serialBoard || "").toUpperCase() === mc);
  if (!e) return { encontrado: false };
  return { encontrado: true, iccid: simDigitos(e.iccid), cliente: e.customerName || e.deviceCustomerName || null };
}

async function renderSimsMateriales(idOt, filasMat, boxId) {
  const box = document.getElementById(boxId || "sims-mat-box");
  if (!box) return;
  const esManager = ((window.perfilActual && window.perfilActual.rol) || sessionStorage.getItem("lb_rol")) === "manager";
  const mcs = [...new Set((filasMat || []).filter(f => /^m[oó]dulo de control/i.test(f.tipo_componente || "")).map(f => String(f.serial).toUpperCase()))].sort();
  if (!mcs.length) { box.hidden = true; return; }
  const { data: regs, error } = await supabaseClient.from("sims_custodia").select("*").eq("id_ot", idOt);
  if (error) { box.hidden = false; box.innerHTML = `<h2>📶 SIMs de los equipos</h2><p>${escSm(error.message)} (¿corriste el SQL 107?)</p>`; return; }
  const porMc = {}; (regs || []).forEach(r => { (porMc[r.mc_origen] = porMc[r.mc_origen] || []).push(r); });
    const pendientes = mcs.filter(m => !porMc[m]);
  box.hidden = false;
  box.innerHTML = `<h2>📶 SIMs de los equipos de esta OT</h2>
    <p style="font-size:.9rem;">Pulsa <strong>Guardar SIM</strong> <u>antes de cambiar la SIM</u> del equipo: se consulta la plataforma y se copia el ICCID de la SIM que lleva (${mcs.length - pendientes.length} de ${mcs.length} guardadas). Dónde queda cada SIM (pegada al MC o en caja/bolsa) se decide después de revisar el equipo, en «SIMs guardadas».</p>
    ${esManager ? `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;">
      ${pendientes.length ? `<button type="button" class="btn-primario" id="simm-todos">📶 Guardar SIM de los ${pendientes.length} pendientes</button>` : ""}
      <a href="sims.html" class="btn-secundario" style="text-decoration:none;padding:6px 12px;">📋 Ver SIMs guardadas</a></div>` : `<p><em>Solo un manager puede guardar SIMs desde aquí.</em></p>`}
    <div class="scroll-x-tabla" style="max-height:340px;"><table class="tabla-revision"><thead><tr><th>MC</th><th>SIM</th><th></th></tr></thead><tbody>
    ${mcs.map(mc => { const r = (porMc[mc] || [])[0];
      return r ? `<tr><td><strong>${escSm(mc)}</strong></td><td>✅ ${escSm(r.operador || "")} ${escSm(simCorta(r.iccid))} · <em>${escSm(r.estado)}</em>${r.ubicacion ? " · 📍 " + escSm(r.ubicacion) : ""}</td><td></td></tr>`
        : `<tr data-mc="${escSm(mc)}"><td><strong>${escSm(mc)}</strong></td><td class="simm-estado">sin guardar</td><td>${esManager ? `<button type="button" class="btn-primario simm-guardar">📶 Guardar SIM</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div><p id="simm-msg" class="resultado-msg" hidden></p>`;

  const msg = t => { const p = document.getElementById("simm-msg"); if (p) { p.textContent = t; p.hidden = !t; } };
  // Guarda la SIM de un MC. Devuelve un texto de resultado (vacío si todo fue bien)
  async function guardar(mc) {
    let info;
    try { info = await iccidDePlataforma(mc); } catch (e) { return `${mc}: ❌ ${e.message}`; }
    if (!info.encontrado) return `${mc}: no está activo en la plataforma (¿ya desvinculado?).`;
    if (!info.iccid) return `${mc}: la plataforma no devuelve ninguna SIM para este equipo.`;
    const ubic = null;   // dónde queda la SIM se decide después de revisar el equipo (página de SIMs)
    const { error: e2 } = await supabaseClient.from("sims_custodia").insert({ iccid: info.iccid, operador: simOperador(info.iccid) || null, mc_origen: mc, id_ot: idOt, cliente: info.cliente, ubicacion: ubic || null, creada_por: await simUsuario() });
    if (e2) return e2.code === "23505" ? `${mc}: esa SIM (${simCorta(info.iccid)}) ya está guardada para otro equipo.` : `${mc}: ❌ ${e2.message}`;
    return "";
  }
  box.querySelectorAll(".simm-guardar").forEach(btn => btn.addEventListener("click", async () => {
    const mc = btn.closest("tr").dataset.mc; btn.disabled = true;
    const r = await guardar(mc);
    if (r) { msg(r); btn.disabled = false; } else await renderSimsMateriales(idOt, filasMat, boxId);
  }));
  const todos = document.getElementById("simm-todos");
  if (todos) todos.addEventListener("click", async () => {
    if (!confirm(`Se consultará la plataforma y se guardará la SIM de ${pendientes.length} equipos. ¿Continuar?`)) return;
    todos.disabled = true; const problemas = [];
    for (let k = 0; k < pendientes.length; k++) { msg(`Guardando ${k + 1} de ${pendientes.length}: ${pendientes[k]}…`); const r = await guardar(pendientes[k]); if (r) problemas.push(r); }
    await renderSimsMateriales(idOt, filasMat, boxId);
    msg(problemas.length ? `Guardadas ${pendientes.length - problemas.length} de ${pendientes.length}. Revisa:\n` + problemas.join("\n") : `✅ ${pendientes.length} SIMs guardadas.`);
    const p = document.getElementById("simm-msg"); if (p) p.style.whiteSpace = "pre-wrap";
  });
}
