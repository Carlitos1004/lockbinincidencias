// =========================================================================
// Bloque "SIMs retiradas" dentro de Revisión de taller (por OT)
// Registra la SIM del cliente (p. ej. NOS) que se quita antes de probar con otra SIM de aquí.
// =========================================================================
const escS = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };

async function renderSimsOt(idOt, comps, ot) {
  const box = document.getElementById("sims-box");
  if (!box) return;
  // Solo los MC que llegan a revisión como "Módulo de Control" (los equipos que solo traen batería u otras piezas no se anotan)
  const mcs = [...new Set((comps || []).filter(c => /m[oó]dulo/i.test(c.tipo_componente || "")).map(c => c.m_control).filter(Boolean))].sort();
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
  box.hidden = false;
  document.getElementById("sims-resumen").textContent = `📶 SIMs del cliente retiradas — ${(regs || []).length} de ${mcs.length} equipos${nGuardadas ? ` · ${nGuardadas} guardadas` : ""}`;
  const filas = mcs.map(mc => {
    const r = (porMc[mc] || [])[0];
    if (r) {
      return `<tr data-mc="${escS(mc)}"><td><strong>${escS(mc)}</strong></td><td><small>${escS(simCorta(plat[mc]))}</small></td>
        <td colspan="2">✅ ${escS(r.operador || "")} ${escS(simCorta(r.iccid))} · <em>${escS(r.estado)}</em>${r.ubicacion ? " · 📍 " + escS(r.ubicacion) : ""}${r.mc_destino ? " → " + escS(r.mc_destino) : ""}</td>
        <td><button type="button" class="btn-secundario sim-quitar" data-id="${r.id}" title="Borrar este registro (por error)">✕</button></td></tr>`;
    }
    return `<tr data-mc="${escS(mc)}" data-dev="${devuelve[mc] ? 1 : 0}"><td><strong>${escS(mc)}</strong></td><td><small title="ICCID que tiene Equipos (puede ser la SIM de pruebas)">${escS(simCorta(plat[mc]))}${(simOperador(plat[mc]) || simPais(plat[mc])) ? " · " + escS(simOperador(plat[mc]) || simPais(plat[mc])) : ""}</small>${devuelve[mc] ? ' <span class="orep-badge" title="Se devuelve al cliente: su SIM va pegada al equipo">↩ se devuelve</span>' : ""}</td>
      <td><input type="text" class="sim-iccid" placeholder="${plat[mc] ? "vacío = la de la plataforma" : "ICCID o últimas cifras"}" style="width:200px;"></td>
      <td></td><td><button type="button" class="btn-primario sim-guardar">📶 Guardar SIM</button></td></tr>`;
  }).join("");
  document.getElementById("sims-cont").innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0;">
      <label>Operador <input type="text" id="sim-operador" list="sim-operadores" placeholder="NOS" value="${escS(op0)}" style="width:120px;"></label>
      <datalist id="sim-operadores"><option value="NOS"><option value="Orange"><option value="DT"><option value="Movistar"><option value="Melita"></datalist>
      <input type="text" id="sim-filtro" placeholder="Filtrar MC…" style="width:130px;">
      <label><input type="checkbox" id="sim-solo-no-dev" checked> Ocultar los que se devuelven</label>
      <a href="sims.html" class="btn-secundario" style="text-decoration:none;padding:6px 12px;">📋 Ver todas las SIMs guardadas</a>
    </div>
    <details style="margin:6px 0;"><summary style="cursor:pointer;font-weight:600;">📥 Cargar SIMs desde un Excel de equipos (anterior a la OT)</summary>
      <p style="font-size:.85rem;margin:6px 0;">Usa una exportación de la plataforma hecha <strong>antes</strong> de cambiar las SIM (lleva las columnas «M. de Control» y «SIM»). Se rellenan los equipos de esta lista que aún no tienen SIM registrada.</p>
      <input type="file" id="sim-excel" accept=".xlsx,.xls">
      <label style="display:block;margin:6px 0;"><input type="checkbox" id="sim-excel-devueltas" checked> Registrarlas ya como «Devuelta al mismo equipo» (la SIM va pegada al equipo)</label>
      <div id="sim-excel-prev"></div>
    </details>
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
  let planExcel = [];
  document.getElementById("sim-excel").addEventListener("change", async ev => {
    const prev = document.getElementById("sim-excel-prev");
    const f = ev.target.files[0];
    if (!f) return;
    if (typeof XLSX === "undefined") { prev.textContent = "No se cargó el lector de Excel; recarga la página."; return; }
    prev.textContent = "Leyendo…";
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
      const cab = (filas[0] || []).map(x => String(x || "").trim().toLowerCase());
      const iMc = cab.findIndex(x => x.includes("control") || x === "mc");
      const iSim = cab.findIndex(x => x === "sim" || x.includes("iccid"));
      if (iMc < 0 || iSim < 0) { prev.textContent = "⚠️ No encuentro las columnas «M. de Control» y «SIM» en la primera fila."; return; }
      const delExcel = {}; let numericos = 0;
      filas.slice(1).forEach(r => {
        const mc = String(r[iMc] || "").trim().toUpperCase();
        if (!mc) return;
        if (typeof r[iSim] === "number") { numericos++; return; }   // un número largo pierde cifras en Excel: no se fía
        const d = simDigitos(r[iSim]);
        if (d.length >= 15) delExcel[mc] = d;
      });
      planExcel = []; const sinDato = [], rarosOp = [];
      const opEsc = document.getElementById("sim-operador").value.trim();
      mcs.forEach(mc => {
        if (porMc[mc]) return;
        const d = delExcel[mc];
        if (!d) { sinDato.push(mc); return; }
        const op = simOperador(d);
        if (opEsc && op && op.toLowerCase() !== opEsc.toLowerCase()) rarosOp.push(`${mc} (${op})`);
        planExcel.push({ mc, iccid: d, op });
      });
      const resumenOp = {}; planExcel.forEach(p => { const k = p.op || "operador sin identificar"; resumenOp[k] = (resumenOp[k] || 0) + 1; });
      prev.innerHTML = `<p style="margin:6px 0;"><strong>${planExcel.length}</strong> equipos con SIM encontrada (${Object.entries(resumenOp).map(([k, v]) => v + " " + escS(k)).join(", ") || "—"}).` +
        `${sinDato.length ? `<br>⚠️ Sin dato en el Excel: ${escS(sinDato.slice(0, 15).join(", "))}${sinDato.length > 15 ? "…" : ""}` : ""}` +
        `${rarosOp.length ? `<br>⚠️ Operador distinto del que indicas arriba: ${escS(rarosOp.slice(0, 10).join(", "))}${rarosOp.length > 10 ? "…" : ""}` : ""}` +
        `${numericos ? `<br>⚠️ ${numericos} SIM del Excel estaban guardadas como número (pierden cifras) y se ignoraron.` : ""}</p>` +
        (planExcel.length ? `<button type="button" class="btn-primario" id="sim-excel-aplicar">✅ Registrar ${planExcel.length} SIM</button>` : "");
      const ap = document.getElementById("sim-excel-aplicar");
      if (ap) ap.addEventListener("click", async () => {
        const devueltas = document.getElementById("sim-excel-devueltas").checked;
        const ubic = null;   // dónde queda la SIM se decide después, en la página de SIMs
        const usuario = await simUsuario(), ahora = new Date().toISOString();
        const filasIns = planExcel.map(p => ({ iccid: p.iccid, operador: p.op || opEsc || null, mc_origen: p.mc, id_ot: idOt, cliente: cliente || null,
          ubicacion: devueltas ? "Pegada al MC" : ubic, creada_por: usuario, nota: "Cargada desde Excel anterior a la OT",
          ...(devueltas ? { estado: "Devuelta al mismo equipo", resuelta_por: usuario, resuelta_en: ahora } : {}) }));
        ap.disabled = true; ap.textContent = "Guardando…";
        for (let i = 0; i < filasIns.length; i += 100) {
          const { error: ei } = await supabaseClient.from("sims_custodia").insert(filasIns.slice(i, i + 100));
          if (ei) { msg(ei.code === "23505" ? "❌ Alguna SIM del Excel ya está guardada en otro equipo; revisa «SIMs guardadas». Se guardó hasta el lote anterior." : "❌ " + ei.message); await renderSimsOt(idOt, comps, ot); return; }
        }
        await renderSimsOt(idOt, comps, ot);
      });
    } catch (err) { prev.textContent = "❌ No pude leer el Excel: " + err.message; }
  });
  document.getElementById("sim-pegar-btn").addEventListener("click", async () => {
    const operador = document.getElementById("sim-operador").value.trim() || null;
    const ubicacion = null;   // se decide después, en la página de SIMs
    localStorage.setItem("lb_sim_operador", operador || "");
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
      nuevas.push({ iccid: res.iccid, operador: simOperador(res.iccid) || operador, mc_origen: mc, id_ot: idOt, cliente: cliente || null, ubicacion, creada_por: usuario });
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
    { const opEsc = document.getElementById("sim-operador").value.trim(), opPlat = simOperador(plat[mc]);
      if (!tr.querySelector(".sim-iccid").value.trim() && opEsc && opPlat && opPlat.toLowerCase() !== opEsc.toLowerCase() &&
          !confirm(`El ICCID de la plataforma para ${mc} parece de ${opPlat}, y el operador que indicas es ${opEsc}. ¿Guardarlo igualmente? (Si la SIM retirada es otra, cancela y escribe su ICCID.)`)) return; }
    if (!res.coincide && plat[mc] && !confirm(`El ICCID que escribiste (${simCorta(res.iccid)}) no coincide con el de la plataforma para ${mc} (${simCorta(plat[mc])}). ¿Guardarlo igualmente?`)) return;
    const operadorEscrito = document.getElementById("sim-operador").value.trim();
    const operador = simOperador(res.iccid) || operadorEscrito || null;
    const ubicacion = null;   // se decide después, en la página de SIMs
    localStorage.setItem("lb_sim_operador", operadorEscrito);
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
