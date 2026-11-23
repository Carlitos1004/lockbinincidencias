// Cambios de componentes y desvinculaciones en la plataforma (solo manager).
const SIG = { battery: "BA", lock: "CE", reader: "LE" };
const COL = { battery: "serie_bateria", lock: "serie_cierre", reader: "serie_lector" };
const NOMBRE = { battery: "Batería", lock: "Cierre", reader: "Lector" };
const IDS = { battery: "cp-bateria", lock: "cp-cierre", reader: "cp-lector" };
const $ = id => document.getElementById(id);
const mcActual = () => $("cp-mc").value.trim().toUpperCase();
let consultado = null;   // MC consultado

async function puente(params) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Sesión vencida. Vuelve a entrar.");
  const r = await fetch("/api/lockbin-api?" + new URLSearchParams(params), { headers: { Authorization: `Bearer ${session.access_token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

async function consultar() {
  const mc = mcActual();
  if (!/^MC\d{4,12}$/.test(mc)) { $("cp-actual").textContent = "Escribe un MC válido (MC + números)."; return null; }
  $("cp-actual").textContent = "Consultando…";
  ["bateria", "cierre", "lector"].forEach(k => { $("cp-act-" + k).textContent = ""; });
  try {
    const j = await puente({ accion: "equipos", serialBoard: mc });
    const e = (j.items || []).find(x => String(x.serialBoard || "").toUpperCase() === mc);
    const { data: loc } = await supabaseClient.from("equipos").select("cliente, estado_montaje, serie_bateria, serie_cierre, serie_lector").eq("m_control", mc).maybeSingle();
    consultado = mc;
    if (!e) {
      $("cp-actual").innerHTML = `⚠️ <strong>${mc}</strong> no está activo en la plataforma (desvinculado o sin setup).` + (loc ? ` En nuestros Equipos: ${loc.estado_montaje || "—"}.` : " Tampoco está en nuestros Equipos.");
      return null;
    }
    $("cp-actual").innerHTML = `✅ <strong>${mc}</strong> · ${e.customerName || e.deviceCustomerName || (loc && loc.cliente) || "sin cliente"} · estado en nuestros Equipos: ${loc ? loc.estado_montaje || "—" : "no está"}`;
    $("cp-act-bateria").textContent = "(ahora: " + (e.serialBattery || "—") + ")";
    $("cp-act-cierre").textContent = "(ahora: " + (e.serialLock || "—") + ")";
    $("cp-act-lector").textContent = "(ahora: " + (e.serialReader || "—") + ")";
    return { e, loc };
  } catch (err) {
    $("cp-actual").textContent = "❌ " + err.message;
    return null;
  }
}
$("cp-consultar").addEventListener("click", consultar);
$("cp-mc").addEventListener("keydown", ev => { if (ev.key === "Enter") consultar(); });
$("cp-mc").addEventListener("input", () => { consultado = null; });
$("cp-conf-desv").addEventListener("change", ev => { $("cp-desvincular").disabled = !ev.target.checked; });

async function datosEquipo(mc) {
  const { data } = await supabaseClient.from("equipos").select("imei, cliente").eq("m_control", mc).maybeSingle();
  return data || {};
}

$("cp-aplicar").addEventListener("click", async () => {
  const mc = mcActual(), sal = $("cp-salida");
  if (!/^MC\d{4,12}$/.test(mc)) { sal.textContent = "Escribe un MC válido."; return; }
  const comps = {};
  for (const k of Object.keys(IDS)) {
    const v = $(IDS[k]).value.trim().toUpperCase();
    if (!v) continue;
    if (!v.startsWith(SIG[k])) { sal.textContent = `El serial de ${NOMBRE[k].toLowerCase()} debería empezar por ${SIG[k]} (escribiste ${v}).`; return; }
    comps[k] = v;
  }
  if (!Object.keys(comps).length) { sal.textContent = "Escribe al menos un serial nuevo."; return; }
  if (!confirm(`En la plataforma, en ${mc}, se pondrá:\n${Object.entries(comps).map(([k, v]) => `${SIG[k]} = ${v}`).join("\n")}\n\n¿Aplicar?`)) return;
  const btn = $("cp-aplicar"); btn.disabled = true; sal.textContent = "Aplicando…";
  try {
    const antes = await consultar();   // para poner el serial anterior en la Vida
    const previos = antes ? { battery: antes.e.serialBattery, lock: antes.e.serialLock, reader: antes.e.serialReader } : {};
    const r = await componentesEnPlataforma(supabaseClient, mc, comps);
    if (r.resultado === "no_esta_en_plataforma") { sal.textContent = `⚠️ ${mc} no está activo en la plataforma: no se cambió nada.`; return; }
    const ETIQ = { cambiado: "✅ cambiado", sin_cambio: "ya estaba así", error: "❌ error", no_intentado: "— no intentado" };
    let texto = (r.ok ? "🌐 Aplicado." : "⚠️ No se pudo completar" + (r.mensaje ? " (" + r.mensaje + ")" : "") + ". Puedes volver a pulsar: lo ya aplicado no se repite.") + "\n" +
      (r.componentes || []).map(c => `  ${SIG[c.componente]}: ${c.valor} → ${ETIQ[c.resultado] || c.resultado}`).join("\n");
    const hechos = (r.componentes || []).filter(c => c.resultado === "cambiado" || c.resultado === "sin_cambio");
    const cambiados = hechos.filter(c => c.resultado === "cambiado");
    if (hechos.length) {
      const eq = await datosEquipo(mc);
      const nota = $("cp-nota").value.trim();
      let vida = false;
      for (const c of cambiados) {
        const notas = `${NOMBRE[c.componente]}: ${previos[c.componente] || "—"} → ${c.valor} (cambio manual en plataforma)${nota ? " · " + nota : ""}`;
        const { error } = await supabaseClient.from("historial_equipo").insert({ imei: eq.imei || null, mc, tipo_evento: "Cambio de componente", cliente: eq.cliente || null, [COL[c.componente]]: c.valor, notas });
        if (error) texto += `\n⚠️ No se pudo anotar en la Vida (${c.componente}): ${error.message}`; else vida = true;
        // si la pieza era del stock entregado a un cliente, queda como instalada
        await supabaseClient.from("entregas_cliente_items").update({ estado: "Instalada", mc_instalado: mc, instalada_en: new Date().toISOString() }).eq("serial", c.valor).eq("estado", "En stock del cliente");
      }
      const upd = { actualizado_en: new Date().toISOString() };
      hechos.forEach(c => { upd[COL[c.componente]] = c.valor; });
      const { error: eU } = await supabaseClient.from("equipos").update(upd).eq("m_control", mc);
      if (eU) texto += `\n⚠️ No se pudo actualizar nuestra ficha de Equipos: ${eU.message}`;
      if (vida && eq.imei) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: eq.imei });
      if (vida) texto += "\n📒 Anotado en la Vida del equipo.";
    }
    sal.textContent = texto;
    ["bateria", "cierre", "lector"].forEach(k => { $("cp-" + k).value = ""; });
    await consultar();
  } catch (e) { sal.textContent = "❌ " + e.message; }
  finally { btn.disabled = false; }
});

$("cp-desvincular").addEventListener("click", async () => {
  const mc = mcActual(), sal = $("cp-salida");
  if (!/^MC\d{4,12}$/.test(mc)) { sal.textContent = "Escribe un MC válido."; return; }
  if (!confirm(`Se DARÁ DE BAJA ${mc} en la plataforma.\nDejará de comunicar.\n\n¿Continuar?`)) return;
  const btn = $("cp-desvincular"); btn.disabled = true; sal.textContent = "Desvinculando…";
  try {
    const r = await desvincularEnPlataforma(supabaseClient, mc);
    const T = { desvinculado: "🔓 Equipo dado de baja en la plataforma.", ya_dado_de_baja: "ℹ️ Ya estaba dado de baja.", no_esta_en_plataforma: "ℹ️ No tenía equipo en la plataforma (ya estaba desvinculado).", error: "⚠️ La plataforma no aceptó la baja" + (r.mensaje ? " (" + r.mensaje + ")" : "") + "." };
    let texto = T[r.resultado] || "⚠️ Respuesta inesperada.";
    if (r.ok) {
      const eq = await datosEquipo(mc);
      const nota = $("cp-nota").value.trim();
      if (r.resultado === "desvinculado") {
        const { error } = await supabaseClient.from("historial_equipo").insert({ imei: eq.imei || null, mc, tipo_evento: "Desvinculación", cliente: eq.cliente || null, notas: "Desvinculado manualmente en la plataforma" + (nota ? " · " + nota : "") });
        if (error) texto += `\n⚠️ No se pudo anotar en la Vida: ${error.message}`; else { texto += "\n📒 Anotado en la Vida del equipo."; if (eq.imei) await supabaseClient.rpc("recalcular_registro_maestro", { p_imei: eq.imei }); }
      }
      const { error: eU } = await supabaseClient.from("equipos").update({ estado_montaje: "Desvinculado", actualizado_en: new Date().toISOString() }).eq("m_control", mc);
      if (eU) texto += `\n⚠️ No se pudo marcar Desvinculado en Equipos: ${eU.message}`; else texto += "\n✅ Equipos: marcado como Desvinculado.";
    }
    sal.textContent = texto;
    $("cp-conf-desv").checked = false;
  } catch (e) { sal.textContent = "❌ " + e.message; $("cp-desvincular").disabled = false; }
});
