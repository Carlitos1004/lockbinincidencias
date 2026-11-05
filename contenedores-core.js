// =========================================================================
// CONTENEDORES — identidad fija de un contenedor aunque cambie su MC
// =========================================================================
// Un contenedor es un sitio físico con un ID que no cambia (el del primer MC
// que tuvo). Cada MC pasa por él durante un periodo, una "estancia"
// (tabla contenedor_estancia, SQL 97): desde = fecha de instalación,
// hasta = fecha en que se retiró (null = sigue puesto). Un MC puede tener
// estancias en contenedores distintos (p. ej. se retira, vuelve de revisión y se
// instala en otro cliente) y el historial de cada contenedor solo cuenta las
// visitas hechas durante cada estancia.
// Un MC sin estancias cuenta como su propio contenedor.
// Si la tabla aún no existe (SQL 97 sin correr), todo funciona como antes.
// =========================================================================

const DIAS_AVISO_VISITA_RECIENTE = 60;

const fraccionar = (arr, n = 100) => {
  const trozos = [];
  for (let i = 0; i < arr.length; i += n) trozos.push(arr.slice(i, i + n));
  return trozos;
};

const fechaCorta = f => (f ? String(f).slice(0, 10) : null);
const hoyISO = () => new Date().toISOString().slice(0, 10);
const ordenEstancias = (a, b) => ((a.desde || "") < (b.desde || "") ? -1 : (a.desde || "") > (b.desde || "") ? 1 : a.id - b.id);

// ¿la fecha cae dentro de la estancia? (límites incluidos)
function dentroDeEstancia(fecha, st) {
  const f = fechaCorta(fecha);
  if (!f) return true;
  if (st.desde && f < st.desde) return false;
  if (st.hasta && f > st.hasta) return false;
  return true;
}

// Para cada MC dado devuelve su contenedor y toda la información de ese contenedor.
// alFecha (opcional): en vez de "ahora", el contenedor en el que estaba el MC en esa fecha.
// Devuelve { contenedorDe: {mc -> idContenedor}, estancias: {id -> [estancia...]}, miembros: {id -> [mc...]}, numeros: {id -> nº} }
async function resolverContenedores(sb, mcs, alFecha) {
  const unicos = [...new Set((mcs || []).filter(Boolean).map(m => String(m).trim().toUpperCase()))];
  const contenedorDe = {};
  unicos.forEach(m => { contenedorDe[m] = m; });
  const estancias = {};
  try {
    const propias = {};
    for (const trozo of fraccionar(unicos)) {
      const { data, error } = await sb.from("contenedor_estancia").select("*").in("m_control", trozo);
      if (error) throw error;
      (data || []).forEach(r => { (propias[r.m_control] = propias[r.m_control] || []).push(r); });
    }
    Object.keys(propias).forEach(mc => {
      const lista = propias[mc].sort(ordenEstancias);
      let elegida = null;
      if (alFecha) elegida = [...lista].reverse().find(s => dentroDeEstancia(alFecha, s));
      if (!elegida) elegida = [...lista].reverse().find(s => !s.hasta);   // la abierta (más reciente)
      if (!elegida) elegida = lista[lista.length - 1];                    // la última que tuvo
      contenedorDe[mc] = elegida.contenedor_id;
    });
    const ids = [...new Set(Object.values(contenedorDe))];
    for (const trozo of fraccionar(ids)) {
      const { data, error } = await sb.from("contenedor_estancia").select("*").in("contenedor_id", trozo);
      if (error) throw error;
      (data || []).forEach(r => { (estancias[r.contenedor_id] = estancias[r.contenedor_id] || []).push(r); });
    }
    Object.keys(estancias).forEach(id => estancias[id].sort(ordenEstancias));
  } catch (err) {
    console.warn("Contenedores no disponibles (¿SQL 97?):", err.message || err);
  }
  const miembros = {};
  const ids = [...new Set(Object.values(contenedorDe))];
  ids.forEach(id => {
    const lista = (estancias[id] || []).map(s => s.m_control);
    const base = lista.length ? lista : [id];
    miembros[id] = [...new Set(base)];
  });
  // Número visible del contenedor (si se le puso uno)
  const numeros = {};
  try {
    for (const trozo of fraccionar(ids)) {
      const { data } = await sb.from("contenedores").select("contenedor_id, numero").in("contenedor_id", trozo);
      (data || []).forEach(r => { if (r.numero) numeros[r.contenedor_id] = r.numero; });
    }
  } catch (err) { /* tabla aún sin crear (SQL 95) */ }
  return { contenedorDe, estancias, miembros, numeros };
}

// Visitas (historial_fallas) de una lista de MC. Devuelve {mc -> [filas, más recientes primero]}
async function visitasPorMc(sb, mcs, excluirOt) {
  const porMc = {};
  const lista = [...new Set((mcs || []).filter(Boolean))];
  for (const trozo of fraccionar(lista)) {
    let q = sb.from("historial_fallas").select("m_control, falla, accion_calle, comentarios, fecha, id_ot, cliente").in("m_control", trozo).order("fecha", { ascending: false });
    if (excluirOt) q = q.neq("id_ot", excluirOt);
    const { data } = await q;
    (data || []).forEach(h => { (porMc[h.m_control] = porMc[h.m_control] || []).push(h); });
  }
  return porMc;
}

// Visitas de cada contenedor SOLO durante las estancias de cada MC. Devuelve {idContenedor -> [filas, recientes primero]}
async function visitasDeContenedores(sb, info, ids, excluirOt) {
  const lista = [...new Set(ids)];
  const mcs = [...new Set(lista.flatMap(id => info.miembros[id] || [id]))];
  const porMc = await visitasPorMc(sb, mcs, excluirOt);
  const res = {};
  lista.forEach(id => {
    const estancias = (info.estancias[id] && info.estancias[id].length) ? info.estancias[id] : [{ m_control: id, desde: null, hasta: null }];
    const vistas = new Set();
    const todas = [];
    estancias.forEach(st => {
      (porMc[st.m_control] || []).forEach(h => {
        if (vistas.has(h) || !dentroDeEstancia(h.fecha, st)) return;
        vistas.add(h);
        todas.push(h);
      });
    });
    res[id] = todas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  });
  return res;
}

const diasDesde = (fecha) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);

// Distancia en metros entre dos coordenadas
function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Registra un cambio de MC: el MC viejo termina su estancia en su contenedor y el
// nuevo empieza una estancia en ese mismo contenedor (hereda su identidad).
// Si el MC nuevo estaba puesto en otro sitio, esa estancia se cierra (no se mezclan contenedores).
async function registrarCambioMc(sb, mcAnterior, mcNuevo, idOt, origen = "ruta", fecha, cliente) {
  const viejo = String(mcAnterior || "").trim().toUpperCase();
  const nuevo = String(mcNuevo || "").trim().toUpperCase();
  const f = fechaCorta(fecha) || hoyISO();
  if (!viejo || !nuevo || viejo === nuevo) return { ok: false, error: "MC no válidos" };
  try {
    // 1) contenedor del MC retirado en esa fecha
    const { data: stViejo, error: e1 } = await sb.from("contenedor_estancia").select("*").eq("m_control", viejo);
    if (e1) throw e1;
    const lista = (stViejo || []).sort(ordenEstancias);
    let st = [...lista].reverse().find(s => dentroDeEstancia(f, s)) || lista[lista.length - 1];
    let cid;
    if (!st) {
      cid = viejo;
      const { error } = await sb.from("contenedor_estancia").insert({ contenedor_id: cid, m_control: viejo, desde: null, hasta: f, id_ot_salida: idOt || null, cliente: cliente || null, origen });
      if (error) throw error;
    } else {
      cid = st.contenedor_id;
      if (!st.hasta || st.hasta > f) {
        const { error } = await sb.from("contenedor_estancia").update({ hasta: f, id_ot_salida: idOt || null }).eq("id", st.id);
        if (error) throw error;
      }
    }
    // 2) el MC nuevo: si ya está registrado en este cambio no se repite; si estaba abierto en otro sitio, se cierra
    const { data: stNuevo, error: e2 } = await sb.from("contenedor_estancia").select("*").eq("m_control", nuevo);
    if (e2) throw e2;
    const previas = stNuevo || [];
    if (previas.some(s => s.contenedor_id === cid && ((idOt && s.id_ot_entrada === idOt) || s.desde === f))) return { ok: true, contenedor: cid, yaEstaba: true };
    for (const s of previas.filter(s => !s.hasta && (!s.desde || s.desde <= f))) {
      await sb.from("contenedor_estancia").update({ hasta: f }).eq("id", s.id);
    }
    const siguiente = previas.filter(s => s.desde && s.desde > f).sort(ordenEstancias)[0];
    const { error } = await sb.from("contenedor_estancia").insert({
      contenedor_id: cid, m_control: nuevo, desde: f, hasta: siguiente ? siguiente.desde : null,
      mc_anterior: viejo, id_ot_entrada: idOt || null, cliente: cliente || null, origen
    });
    if (error) throw error;
    return { ok: true, contenedor: cid };
  } catch (err) {
    console.error("No se pudo registrar el cambio de MC en el contenedor:", err);
    return { ok: false, error: err.message || String(err) };
  }
}

// Compatibilidad con el nombre anterior
const vincularMcContenedor = (sb, mcAnterior, mcNuevo, idOt, origen, fecha, cliente) =>
  registrarCambioMc(sb, mcAnterior, mcNuevo, idOt, origen, fecha, cliente);
