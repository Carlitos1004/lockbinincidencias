// =========================================================================
// SIMs guardadas: lista, búsqueda y cierre (devuelta al mismo equipo / pasada a MC nuevo)
// =========================================================================
const escH = t => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
let todasSims = [];

async function cargarSims() {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabaseClient.from("sims_custodia").select("*").order("creada_en", { ascending: false }).range(desde, desde + 999);
    if (error) { mensaje("❌ " + error.message + " (¿corriste el SQL 107?)"); return; }
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  todasSims = filas;
  pintar();
}
function mensaje(t) { const p = document.getElementById("sims-msg"); p.textContent = t || ""; p.hidden = !t; }

const seleccion = new Set();          // ids marcados (se conservan al repintar)
const cerradas = new Set();          // OT plegadas
function filaSim(s, conUbic) {
  const guardada = s.estado === "Guardada";
  return `<tr data-id="${s.id}">
      <td>${guardada ? `<input type="checkbox" class="chk-sim" ${seleccion.has(s.id) ? "checked" : ""}>` : ""}</td>
      <td title="${escH(s.iccid)}">${escH(simCorta(s.iccid))}</td><td>${escH(s.operador || simOperador(s.iccid) || "")}</td><td><strong>${escH(s.mc_origen || "—")}</strong></td>
      <td>${escH(s.id_ot || "")}</td><td>${escH(s.cliente || "")}</td>${conUbic ? `<td>${escH(s.ubicacion || "—")}</td>` : ""}
      <td>${guardada ? "📶 Guardada" : escH(s.estado) + (s.mc_destino ? " → <strong>" + escH(s.mc_destino) + "</strong>" : "")}</td>
      <td>${new Date(s.resuelta_en || s.creada_en).toLocaleDateString("es-ES")}</td>
      <td>${guardada ? `<button type="button" class="btn-primario sim-mismo">↩ Devuelta al mismo equipo</button> <button type="button" class="btn-secundario sim-nuevo">➡ Pasada a MC nuevo…</button> ` : `<button type="button" class="btn-secundario sim-reabrir">Reabrir</button> `}<button type="button" class="btn-secundario sim-borrar" title="Borrar el registro">✕</button></td></tr>`;
}

function pintar() {
  const q = document.getElementById("f-buscar").value.trim().toLowerCase();
  const est = document.getElementById("f-estado").value;
  const fot = document.getElementById("f-ot").value;
  const agrupar = document.getElementById("f-agrupar").checked;
  // Desplegable de OT (conserva la elección)
  const selOt = document.getElementById("f-ot");
  const ots = [...new Set(todasSims.filter(s => !est || s.estado === est).map(s => s.id_ot || "(sin OT)"))].sort();
  selOt.innerHTML = '<option value="">Todas las OT</option>' + ots.map(o => `<option ${o === fot ? "selected" : ""}>${escH(o)}</option>`).join("");
  const lista = todasSims.filter(s => (!est || s.estado === est) && (!fot || (s.id_ot || "(sin OT)") === fot) &&
    (!q || [s.iccid, s.mc_origen, s.mc_destino, s.id_ot, s.cliente, s.operador, s.ubicacion].some(v => String(v || "").toLowerCase().includes(q))));
  const sel = document.getElementById("f-estado");
  const nEst = e => todasSims.filter(s => s.estado === e).length;
  [["Guardada", "Guardadas (pendientes)"], ["Devuelta al mismo equipo", "Devueltas al mismo equipo"], ["Pasada a MC nuevo", "Pasadas a MC nuevo"]].forEach(([v, t]) => {
    const op = [...sel.options].find(o => o.value === v); if (op) op.textContent = `${t} (${nEst(v)})`;
  });
  [...sel.options].find(o => o.value === "").textContent = `Todas (${todasSims.length})`;
  document.getElementById("sims-contador").textContent = `${lista.length} SIMs · ${todasSims.filter(s => s.estado === "Guardada").length} guardadas en total`;
  // La columna «Dónde queda» solo se muestra si alguna SIM la tiene rellena
  const conUbic = lista.some(s => s.ubicacion);
  document.querySelectorAll(".col-ubic").forEach(th => { th.hidden = !conUbic; });
  const ncol = 9 + (conUbic ? 1 : 0);
  const tb = document.getElementById("sims-tbody");
  if (!lista.length) tb.innerHTML = `<tr><td colspan="${ncol}">No hay SIMs con ese filtro.</td></tr>`;
  else if (!agrupar) tb.innerHTML = lista.map(s => filaSim(s, conUbic)).join("");
  else {
    const grupos = {};
    lista.forEach(s => { (grupos[s.id_ot || "(sin OT)"] = grupos[s.id_ot || "(sin OT)"] || []).push(s); });
    tb.innerHTML = Object.keys(grupos).sort().map(ot => {
      const g = grupos[ot], pend = g.filter(s => s.estado === "Guardada");
      const clientes = [...new Set(g.map(s => s.cliente).filter(Boolean))].join(", ");
      const todasMarc = pend.length && pend.every(s => seleccion.has(s.id));
      return `<tr class="sim-grupo" data-ot="${escH(ot)}" style="background:#e8efe9;cursor:pointer;"><td>${pend.length ? `<input type="checkbox" class="chk-grupo" ${todasMarc ? "checked" : ""} title="Marcar las pendientes de esta OT">` : ""}</td>
        <td colspan="${ncol - 1}"><strong>${cerradas.has(ot) ? "▶" : "▼"} ${escH(ot)}</strong>${clientes ? " · " + escH(clientes) : ""} · ${g.length} SIMs${pend.length ? ` · <strong>${pend.length} pendientes</strong>` : ""}</td></tr>` +
        (cerradas.has(ot) ? "" : g.map(s => filaSim(s, conUbic)).join(""));
    }).join("");
  }
  actualizarBarra();
}
function actualizarBarra() {
  const ids = [...seleccion].filter(id => todasSims.some(s => s.id === id && s.estado === "Guardada"));
  document.getElementById("sel-n").textContent = ids.length;
  document.getElementById("sims-barra").style.display = ids.length ? "flex" : "none";
}

async function cerrarSim(id, cambios) {
  const { error } = await supabaseClient.from("sims_custodia").update({ ...cambios, resuelta_por: await simUsuario(), resuelta_en: new Date().toISOString() }).eq("id", id);
  if (error) { alert("No se pudo guardar: " + error.message); return; }
  await cargarSims();
}
document.getElementById("sims-tbody").addEventListener("click", async e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  if (tr.classList.contains("sim-grupo")) {
    const ot = tr.dataset.ot;
    if (e.target.closest(".chk-grupo")) {   // marcar / desmarcar las pendientes de esa OT
      const marcar = e.target.checked;
      todasSims.filter(s => (s.id_ot || "(sin OT)") === ot && s.estado === "Guardada").forEach(s => marcar ? seleccion.add(s.id) : seleccion.delete(s.id));
    } else { cerradas.has(ot) ? cerradas.delete(ot) : cerradas.add(ot); }
    pintar(); return;
  }
  if (e.target.closest(".chk-sim")) { e.target.checked ? seleccion.add(tr.dataset.id) : seleccion.delete(tr.dataset.id); actualizarBarra(); return; }
  const id = tr.dataset.id;
  if (e.target.closest(".sim-mismo")) { await cerrarSim(id, { estado: "Devuelta al mismo equipo", mc_destino: null }); }
  else if (e.target.closest(".sim-nuevo")) {
    const mc = (prompt("¿En qué MC nuevo se colocó esta SIM? (ej. MC2603293)") || "").trim().toUpperCase();
    if (!mc) return;
    if (!/^MC\d{4,12}$/.test(mc)) { alert("Ese MC no parece válido."); return; }
    await cerrarSim(id, { estado: "Pasada a MC nuevo", mc_destino: mc });
  } else if (e.target.closest(".sim-reabrir")) {
    if (!confirm("¿Volver a marcarla como Guardada?")) return;
    const { error } = await supabaseClient.from("sims_custodia").update({ estado: "Guardada", mc_destino: null, resuelta_en: null, resuelta_por: null }).eq("id", id);
    if (error) { alert(error.code === "23505" ? "Ya hay otra SIM Guardada con ese ICCID." : "No se pudo: " + error.message); return; }
    await cargarSims();
  } else if (e.target.closest(".sim-borrar")) {
    if (!confirm("¿Borrar este registro? (solo si se anotó por error)")) return;
    const { error } = await supabaseClient.from("sims_custodia").delete().eq("id", id);
    if (error) { alert("No se pudo borrar: " + error.message); return; }
    await cargarSims();
  }
});
document.getElementById("f-buscar").addEventListener("input", pintar);
document.getElementById("f-estado").addEventListener("change", pintar);

document.getElementById("n-guardar").addEventListener("click", async () => {
  const res = simResolverIccid(document.getElementById("n-iccid").value, "");
  if (res.error) { mensaje("⚠️ " + res.error); return; }
  const mc = document.getElementById("n-mc").value.trim().toUpperCase() || null;
  const { error } = await supabaseClient.from("sims_custodia").insert({
    iccid: res.iccid, operador: simOperador(res.iccid) || document.getElementById("n-operador").value.trim() || null, mc_origen: mc,
    ubicacion: document.getElementById("n-ubic").value.trim() || null, creada_por: await simUsuario() });
  if (error) { mensaje(error.code === "23505" ? "⚠️ Esa SIM ya está guardada." : "❌ " + error.message); return; }
  mensaje("");
  ["n-iccid", "n-mc"].forEach(i => { document.getElementById(i).value = ""; });
  await cargarSims();
});
cargarSims();

document.getElementById("f-ot").addEventListener("change", pintar);
document.getElementById("f-agrupar").addEventListener("change", pintar);
document.getElementById("sel-limpiar").addEventListener("click", () => { seleccion.clear(); pintar(); });
document.getElementById("sel-todas").addEventListener("change", e => {
  const visibles = [...document.querySelectorAll("#sims-tbody tr[data-id] .chk-sim")].map(c => c.closest("tr").dataset.id);
  visibles.forEach(id => e.target.checked ? seleccion.add(id) : seleccion.delete(id)); pintar();
});
document.getElementById("sel-mismo").addEventListener("click", async () => {
  const ids = [...seleccion].filter(id => todasSims.some(s => s.id === id && s.estado === "Guardada"));
  if (!ids.length) return;
  if (!confirm(`¿Marcar ${ids.length} SIMs como «Devuelta al mismo equipo»?`)) return;
  const btn = document.getElementById("sel-mismo"); btn.disabled = true;
  const usuario = await simUsuario(), ahora = new Date().toISOString();
  for (let k = 0; k < ids.length; k += 100) {
    const { error } = await supabaseClient.from("sims_custodia").update({ estado: "Devuelta al mismo equipo", mc_destino: null, resuelta_por: usuario, resuelta_en: ahora }).in("id", ids.slice(k, k + 100));
    if (error) { alert("No se pudo guardar: " + error.message + (k ? ` (se guardaron las primeras ${k})` : "")); break; }
  }
  btn.disabled = false; seleccion.clear(); await cargarSims();
});
