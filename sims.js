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

function pintar() {
  const q = document.getElementById("f-buscar").value.trim().toLowerCase();
  const est = document.getElementById("f-estado").value;
  const lista = todasSims.filter(s => (!est || s.estado === est) &&
    (!q || [s.iccid, s.mc_origen, s.mc_destino, s.id_ot, s.cliente, s.operador, s.ubicacion].some(v => String(v || "").toLowerCase().includes(q))));
  const sel = document.getElementById("f-estado");
  const nEst = e => todasSims.filter(s => s.estado === e).length;
  [["Guardada", "Guardadas (pendientes)"], ["Devuelta al mismo equipo", "Devueltas al mismo equipo"], ["Pasada a MC nuevo", "Pasadas a MC nuevo"]].forEach(([v, t]) => {
    const op = [...sel.options].find(o => o.value === v); if (op) op.textContent = `${t} (${nEst(v)})`;
  });
  [...sel.options].find(o => o.value === "").textContent = `Todas (${todasSims.length})`;
  document.getElementById("sims-contador").textContent = `${lista.length} SIMs · ${todasSims.filter(s => s.estado === "Guardada").length} guardadas en total`;
  document.getElementById("sims-tbody").innerHTML = lista.length ? lista.map(s => {
    const guardada = s.estado === "Guardada";
    return `<tr data-id="${s.id}">
      <td title="${escH(s.iccid)}">${escH(simCorta(s.iccid))}</td><td>${escH(s.operador || simOperador(s.iccid) || "")}</td><td><strong>${escH(s.mc_origen || "—")}</strong></td>
      <td>${escH(s.id_ot || "")}</td><td>${escH(s.cliente || "")}</td><td>${escH(s.ubicacion || "")}</td>
      <td>${guardada ? "📶 Guardada" : escH(s.estado) + (s.mc_destino ? " → <strong>" + escH(s.mc_destino) + "</strong>" : "")}</td>
      <td>${new Date(s.resuelta_en || s.creada_en).toLocaleDateString("es-ES")}</td>
      <td>${guardada ? `<button type="button" class="btn-primario sim-mismo">↩ Devuelta al mismo equipo</button> <button type="button" class="btn-secundario sim-nuevo">➡ Pasada a MC nuevo…</button> ` : `<button type="button" class="btn-secundario sim-reabrir">Reabrir</button> `}<button type="button" class="btn-secundario sim-borrar" title="Borrar el registro">✕</button></td></tr>`;
  }).join("") : '<tr><td colspan="9">No hay SIMs con ese filtro.</td></tr>';
}

async function cerrarSim(id, cambios) {
  const { error } = await supabaseClient.from("sims_custodia").update({ ...cambios, resuelta_por: await simUsuario(), resuelta_en: new Date().toISOString() }).eq("id", id);
  if (error) { alert("No se pudo guardar: " + error.message); return; }
  await cargarSims();
}
document.getElementById("sims-tbody").addEventListener("click", async e => {
  const tr = e.target.closest("tr"); if (!tr) return;
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
