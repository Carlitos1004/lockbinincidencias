// =========================================================================
// CONTENEDORES — identidad fija de un contenedor aunque cambie su MC
// =========================================================================
// La historia de un equipo está por MC. Cuando se cambia el MC de un
// contenedor, el nuevo empieza "de cero". La tabla contenedor_mc enlaza cada
// MC con un ID de contenedor que NO cambia: el MC nuevo hereda el ID del MC
// al que sustituye. Un MC sin fila en la tabla es su propio contenedor.
// Si la tabla aún no existe (SQL 93 sin correr), todo funciona como antes.
// =========================================================================

const DIAS_AVISO_VISITA_RECIENTE = 60;

const fraccionar = (arr, n = 100) => {
  const trozos = [];
  for (let i = 0; i < arr.length; i += n) trozos.push(arr.slice(i, i + n));
  return trozos;
};

// Devuelve { contenedorDe: {mc -> idContenedor}, miembros: {idContenedor -> [mc, ...]} } para los MC dados
async function resolverContenedores(sb, mcs) {
  const unicos = [...new Set((mcs || []).filter(Boolean).map(m => String(m).trim().toUpperCase()))];
  const contenedorDe = {};
  unicos.forEach(m => { contenedorDe[m] = m; });
  const miembros = {};
  try {
    for (const trozo of fraccionar(unicos)) {
      const { data, error } = await sb.from("contenedor_mc").select("m_control, contenedor_id").in("m_control", trozo);
      if (error) throw error;
      (data || []).forEach(r => { contenedorDe[r.m_control] = r.contenedor_id; });
    }
    const ids = [...new Set(Object.values(contenedorDe))];
    for (const trozo of fraccionar(ids)) {
      const { data, error } = await sb.from("contenedor_mc").select("m_control, contenedor_id").in("contenedor_id", trozo);
      if (error) throw error;
      (data || []).forEach(r => {
        (miembros[r.contenedor_id] = miembros[r.contenedor_id] || new Set()).add(r.m_control);
      });
    }
  } catch (err) {
    console.warn("Contenedores no disponibles (¿SQL 93?):", err.message || err);
  }
  // El propio ID de contenedor también es un MC (el primero de la cadena)
  Object.values(contenedorDe).forEach(id => { (miembros[id] = miembros[id] || new Set()).add(id); });
  unicos.forEach(m => { (miembros[contenedorDe[m]] = miembros[contenedorDe[m]] || new Set()).add(m); });
  const miembrosArr = {};
  Object.keys(miembros).forEach(id => { miembrosArr[id] = [...miembros[id]]; });
  return { contenedorDe, miembros: miembrosArr };
}

// Visitas (historial_fallas) de una lista de MC. Devuelve {mc -> [filas, más recientes primero]}
async function visitasPorMc(sb, mcs, excluirOt) {
  const porMc = {};
  const lista = [...new Set((mcs || []).filter(Boolean))];
  for (const trozo of fraccionar(lista)) {
    let q = sb.from("historial_fallas").select("m_control, falla, accion_calle, comentarios, fecha, id_ot").in("m_control", trozo).order("fecha", { ascending: false });
    if (excluirOt) q = q.neq("id_ot", excluirOt);
    const { data } = await q;
    (data || []).forEach(h => { (porMc[h.m_control] = porMc[h.m_control] || []).push(h); });
  }
  return porMc;
}

const diasDesde = (fecha) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);

// Distancia en metros entre dos coordenadas
function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Enlaza el MC nuevo con el contenedor del MC que sustituye (o enlaza dos MC a mano)
async function vincularMcContenedor(sb, mcAnterior, mcNuevo, idOt, origen = "ruta") {
  const viejo = String(mcAnterior || "").trim().toUpperCase();
  const nuevo = String(mcNuevo || "").trim().toUpperCase();
  if (!viejo || !nuevo || viejo === nuevo) return { ok: false, error: "MC no válidos" };
  try {
    const { data: filaViejo } = await sb.from("contenedor_mc").select("contenedor_id").eq("m_control", viejo).maybeSingle();
    const cid = filaViejo?.contenedor_id || viejo;
    if (!filaViejo) {
      await sb.from("contenedor_mc").upsert({ m_control: viejo, contenedor_id: cid, origen: "inicial" }, { onConflict: "m_control", ignoreDuplicates: true });
    }
    const { error } = await sb.from("contenedor_mc").upsert({
      m_control: nuevo, contenedor_id: cid, mc_anterior: viejo, origen, id_ot: idOt || null, fecha: new Date().toISOString().slice(0, 10)
    }, { onConflict: "m_control" });
    if (error) throw error;
    return { ok: true, contenedor: cid };
  } catch (err) {
    console.error("No se pudo vincular el contenedor:", err);
    return { ok: false, error: err.message || String(err) };
  }
}
