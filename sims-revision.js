// =========================================================================
// Bloque "SIMs retiradas" dentro de Revisión de taller (por OT)
// Registra la SIM del cliente (p. ej. NOS) que se quita antes de probar con otra SIM de aquí.
// =========================================================================
const escS = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };

async function renderSimsOt(idOt, comps, ot) {
  const box = document.getElementById("sims-box");
  if (!box) return;
  const mcs = [...new Set((comps || []).map(c => c.m_control).filter(Boolean))].sort();
  if (!mcs.length) { box.hidden = true; return; }
  const cliente = (ot && ot.cliente) || "";
  // ¿Se devuelve al cliente? (su SIM va pegada al equipo: no hace falta registrarla)
  const devuelve = {};
  mcs.forEach(mc => {
    const delMc = comps.filter(c => c.m_control === mc);
    const cMc = delMc.find(c => /m[oó]dulo/i.test(c.tipo_componente || "")) || delMc[0];
    devuelve[mc] = !!(cMc && (cMc.destino || "").includes("Devolver al cliente"));
  });

  const plat = {};
  for (let i = 0; i < mcs.length; i += 100) {
    const { data } = await supabaseClient.from("equipos").select("m_control, sim").in("m_control", mcs.slice(i, i + 100));
    (data || []).forEach(e => { plat[e.m_control] = e.sim || ""; });
  }
  const { data: regs, error } = await supabaseClient.from("sims_custodia").select("*").eq("id_ot", idOt);
  if (error) { box.hidden = false; document.getElementById("sims-resumen").textContent = "📶 SIMs retiradas — " + error.message + " (¿corriste el SQL 107?)"; document.getElementById("sims-cont").innerHTML = ""; return; }
  const porMc = {};
  (regs || []).forEach(r => { (porMc[r.mc_origen] = porMc[r.mc_origen] || []).push(r); });

  const nGuardadas = (regs || []).filter(r => r.estado === "Guardada").length;
  const op0 = localStorage.getItem("lb_sim_operador") || "";
  const ub0 = localStorage.getItem("lb_sim_ubicacion") || "";
  box.hidden = false;
  document.getElementById("sims-resumen").textContent = `📶 SIMs del cliente retiradas — ${(regs || []).length} de ${mcs.length} equipos${nGuardadas ? ` · ${nGuardadas} guardadas` : ""}`;
  const filas = mcs.map(mc => {
    const r = (porMc[mc] || [])[0];
    if (r) {
      return `<tr data-mc="${escS(mc)}"><td><strong>${escS(mc)}</strong></td><td><small>${escS(simCorta(plat[mc]))}</small></td>
        <td colspan="2">✅ ${escS(r.operador || "")} ${escS(simCorta(r.iccid))} · <em>${escS(r.estado)}</em>${r.ubicacion ? " · 📍 " + escS(r.ubicacion) : ""}${r.mc_destino ? " → " + escS(r.mc_destino) : ""}</td>
        <td><button type="button" class="btn-secundario sim-quitar" data-id="${r.id}" title="Borrar este registro (por error)">✕</button></td></tr>`;
    }
    return `<tr data-mc="${escS(mc)}" data-dev="${devuelve[mc] ? 1 : 0}"><td><strong>${escS(mc)}</strong></td><td><small title="ICCID que tiene Equipos (puede ser la SIM de pruebas)">${escS(simCorta(plat[mc]))}${simPais(plat[mc]) ? " · " + escS(simPais(plat[mc])) : ""}</small>${devuelve[mc] ? ' <span class="orep-badge" title="Se devuelve al cliente: su SIM va pegada al equipo">↩ se devuelve</span>' : ""}</td>
      <td><input type="text" class="sim-iccid" placeholder="${plat[mc] ? "vacío = la de la plataforma" : "ICCID o últimas cifras"}" style="width:200px;"></td>
      <td></td><td><button type="button" class="btn-primario sim-guardar">📶 Guardar SIM</button></td></tr>`;
  }).join("");
  document.getElementById("sims-cont").innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;">
      <label>Operador <input type="text" id="sim-operador" list="sim-operadores" placeholder="NOS" value="${escS(op0)}" style="width:120px;"></label>
      <datalist id="sim-operadores"><option value="NOS"><option value="Vodafone"><option value="Movistar"><option value="Orange"><option value="TIM"><option value="Cosmote"></datalist>
      <label>Guardada en <input type="text" id="sim-ubicacion" placeholder="Caja / bolsa" value="${escS(ub0)}" style="width:150px;"></label>
      <input type="text" id="sim-filtro" placeholder="Filtrar MC…" style="width:130px;">
      <label><input type="checkbox" id="sim-solo-no-dev" checked> Ocultar los que se devuelven</label>
      <a href="sims.html" class="btn-secundario" style="text-decoration:none;padding:6px 12px;">📋 Ver todas las SIMs guardadas</a>
    </div>
    <details style="margin:6px 0;"><summary style="cursor:pointer;font-weight:600;">📋 Pegar lista (MC y serial de SIM)</summary>
      <p style="font-size:.85rem;margin:6px 0;">Una línea por equipo: el MC y el ICCID (o sus últimas cifras), separados por espacio, coma o tabulador. Puedes pegar directamente dos columnas de Excel.</p>
      <textarea id="sim-pegar" rows="6" style="width:100%;max-width:520px;font-family:monospace;" placeholder="MC2400056  8935106100000518707"></textarea>
      <div><button type="button" class="btn-primario" id="sim-pegar-btn">Guardar la lista</button></div>
    </details>
    <p style="font-size:.85rem;color:var(--gris-700);margin:0 0 8px;">Cliente: ${escS(cliente || "—")}. El ICCID de la plataforma se usa solo si dejas el campo vacío; también puedes escribir las últimas cifras impresas en la SIM.</p>
    <div class="scroll-x-tabla" style="max-height:340px;"><table class="tabla-revision"><thead><tr><th>MC</th><th>En plataforma</th><th>ICCID de la SIM</th><th></th><th></th></tr></thead><tbody id="sims-tbody">${filas}</tbody></table></div>
    <p id="sims-msg" class="resultado-msg" hidden></p>`;

  const msg = t => { const p = document.getElementById("sims-msg"); p.textContent = t; p.hidden = !t; };
  const aplicarFiltro = () => {
    const f = document.getElementById("sim-filtro").value.trim().toUpperCase();
    const ocultarDev = document.getElementById("sim-solo-no-dev").checked;
    document.querySelectorAll("#sims-tbody tr").forEach(tr => { tr.hidden = (f && !tr.dataset.mc.includes(f)) || (ocultarDev && tr.dataset.dev === "1"); });
  };
  document.getElementById("sim-filtro").addEventListener("input", aplicarFiltro);
  document.getElementById("sim-solo-no-dev").addEventListener("change", aplicarFiltro);
  aplicarFiltro();
  document.getElementById("sim-pegar-btn").addEventListener("click", async () => {
    const operador = document.getElementById("sim-operador").value.trim() || null;
    const ubicacion = document.getElementById("sim-ubicacion").value.trim() || null;
    localStorage.setItem("lb_sim_operador", operador || ""); localStorage.setItem("lb_sim_ubicacion", ubicacion || "");
    const usuario = await simUsuario();
    const nuevas = [], problemas = [], vistos = new Set();
    document.getElementById("sim-pegar").value.split(/\n/).forEach((linea, i) => {
      if (!linea.trim()) return;
      const mc = (linea.toUpperCase().match(/MC\d{4,12}/) || [])[0];
      const resto = linea.replace(/MC\d{4,12}/i, "");
      const e = simDigitos(resto);
      if (!mc) { problemas.push(`Línea ${i + 1}: no veo el MC.`); return; }
      if (!mcs.includes(mc)) { problemas.push(`${mc}: no es de esta OT.`); return; }
      if (porMc[mc]) { problemas.push(`${mc}: ya tiene una SIM registrada.`); return; }
      if (vistos.has(mc)) { problemas.push(`${mc}: repetido en la lista.`); return; }
      if (e.length < 6) { problemas.push(`${mc}: serial de SIM demasiado corto.`); return; }
      vistos.add(mc);
      const res = simResolverIccid(e, plat[mc]);
      nuevas.push({ iccid: res.iccid, operador, mc_origen: mc, id_ot: idOt, cliente: cliente || null, ubicacion, creada_por: usuario });
    });
    if (!nuevas.length) { msg(problemas.length ? "⚠️ Nada que guardar. " + problemas.join(" ") : "⚠️ Pega primero la lista."); return; }
    if (!confirm(`¿Guardar ${nuevas.length} SIM${problemas.length ? ` (se saltan ${problemas.length} líneas con problemas)` : ""}?`)) return;
    const btnP = document.getElementById("sim-pegar-btn"); btnP.disabled = true;
    const { error: ep } = await supabaseClient.from("sims_custodia").insert(nuevas);
    if (ep) { msg(ep.code === "23505" ? "❌ Alguna SIM de la lista ya está guardada en otro equipo; no se guardó nada." : "❌ " + ep.message); btnP.disabled = false; return; }
    await renderSimsOt(idOt, comps, ot);
    if (problemas.length) { const p = document.getElementById("sims-msg"); p.textContent = `Guardadas ${nuevas.length}. Saltadas: ` + problemas.join(" "); p.hidden = false; }
  });
  document.querySelectorAll(".sim-guardar").forEach(btn => btn.addEventListener("click", async () => {
    const tr = btn.closest("tr"), mc = tr.dataset.mc;
    const res = simResolverIccid(tr.querySelector(".sim-iccid").value, plat[mc]);
    if (res.error) { msg("⚠️ " + res.error); return; }
    if (!tr.querySelector(".sim-iccid").value.trim() && simPais(plat[mc]) === "España" && !confirm(`El ICCID de la plataforma para ${mc} parece de una SIM española, no la del cliente. ¿Guardarlo igualmente? (Si la SIM retirada es otra, cancela y escribe su ICCID.)`)) return;
    if (!res.coincide && plat[mc] && !confirm(`El ICCID que escribiste (${simCorta(res.iccid)}) no coincide con el de la plataforma para ${mc} (${simCorta(plat[mc])}). ¿Guardarlo igualmente?`)) return;
    const operador = document.getElementById("sim-operador").value.trim() || null;
    const ubicacion = document.getElementById("sim-ubicacion").value.trim() || null;
    localStorage.setItem("lb_sim_operador", operador || ""); localStorage.setItem("lb_sim_ubicacion", ubicacion || "");
    btn.disabled = true;
    const { error: e2 } = await supabaseClient.from("sims_custodia").insert({ iccid: res.iccid, operador, mc_origen: mc, id_ot: idOt, cliente: cliente || null, ubicacion, creada_por: await simUsuario() });
    if (e2) { msg(e2.code === "23505" ? `⚠️ Esa SIM (${simCorta(res.iccid)}) ya está guardada para otro equipo.` : "❌ " + e2.message); btn.disabled = false; return; }
    renderSimsOt(idOt, comps, ot);
  }));
  document.querySelectorAll(".sim-quitar").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("¿Borrar este registro de SIM? (solo si se anotó por error)")) return;
    const { error: e3 } = await supabaseClient.from("sims_custodia").delete().eq("id", btn.dataset.id);
    if (e3) { alert("No se pudo borrar: " + e3.message); return; }
    renderSimsOt(idOt, comps, ot);
  }));
}
