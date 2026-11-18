// =========================================================================
// serializados-core.js — estado de los seriales de "Materiales Serializados"
// =========================================================================
// Un serial está "Usado en campo" solo si de verdad aparece como serial
// nuevo en algún reporte de la OT (historial_fallas.nuevo_serial o
// componentes_retirados.serial_nuevo). Si el reporte se corrige o se borra
// y el serial desaparece, vuelve a "Sacado del almacén" para poder
// devolverlo a stock. "Devuelto al almacén" nunca se toca.

async function recalcularEstadoSerializados(sb, idOt) {
  if (!idOt) return { cambios: 0 };

  async function paginar(tabla, columnas) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from(tabla).select(columnas).eq("id_ot", idOt).range(desde, desde + 999);
      if (error) throw error;
      filas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return filas;
  }

  try {
    const [tickets, piezas, { data: serializados, error }] = await Promise.all([
      paginar("historial_fallas", "nuevo_serial"),
      paginar("componentes_retirados", "serial_nuevo"),
      sb.from("materiales_serializados").select("id, serial, estado").eq("id_ot", idOt)
    ]);
    if (error) throw error;

    const usados = new Set();
    const anadir = txt => String(txt || "").toUpperCase().split(/[\s,;]+/).filter(Boolean).forEach(s => usados.add(s));
    tickets.forEach(t => anadir(t.nuevo_serial));
    piezas.forEach(c => anadir(c.serial_nuevo));

    let cambios = 0;
    const ahora = new Date().toISOString();
    for (const s of (serializados || [])) {
      const serial = String(s.serial || "").toUpperCase();
      let nuevoEstado = null;
      if (s.estado === "Usado en campo" && !usados.has(serial)) nuevoEstado = "Sacado del almacén";
      else if (s.estado === "Sacado del almacén" && usados.has(serial)) nuevoEstado = "Usado en campo";
      if (!nuevoEstado) continue;
      const { error: errUpd } = await sb.from("materiales_serializados")
        .update({ estado: nuevoEstado, fecha_actualizacion: ahora }).eq("id", s.id);
      if (!errUpd) cambios++;
    }
    return { cambios };
  } catch (e) {
    console.warn("recalcularEstadoSerializados:", e.message || e);
    return { cambios: 0, error: e };
  }
}

// ---- Tipo de batería automático ----
// Nivel 1 (exacto): el serial ya se conoce — está en Equipos (serie_bateria → modelo_bateria BA01/BA02/BA03)
//                   o ya se clasificó antes en otra OT. Se aplica solo.
// Nivel 2 (sugerido): el serial es nuevo, pero otros del mismo lote (mismas 6 primeras letras/cifras, p. ej. BA2601)
//                   son casi todos del mismo tipo. Solo se PRESELECCIONA en "pendientes de clasificar"; hay que confirmarlo.
const subtipoDeModelo = m => {
  const x = String(m || "").trim().toUpperCase();
  return x.startsWith("BA02") ? "Batería Recargable" : x.startsWith("BA01") ? "Batería No Recargable" : x.startsWith("BA03") ? "Batería PKCELL" : null;
};
const subtipoDeTipo = t => { const m = String(t || "").match(/^(Batería (?:Recargable|No Recargable|PKCELL))/); return m ? m[1] : null; };

async function clasificarBateriasAuto(sb, seriales) {
  const lista = [...new Set(seriales.map(s => String(s).trim().toUpperCase()).filter(Boolean))];
  const exacto = {}, sugerido = {};
  if (!lista.length) return { exacto, sugerido };
  for (let i = 0; i < lista.length; i += 100) {
    const trozo = lista.slice(i, i + 100);
    const { data: eq } = await sb.from("equipos").select("serie_bateria, modelo_bateria").in("serie_bateria", trozo);
    (eq || []).forEach(e => { const st = subtipoDeModelo(e.modelo_bateria); if (st) exacto[String(e.serie_bateria).toUpperCase()] = st; });
    const { data: ms } = await sb.from("materiales_serializados").select("serial, tipo_componente").in("serial", trozo).like("tipo_componente", "Batería %");
    (ms || []).forEach(r => { const st = subtipoDeTipo(r.tipo_componente); if (st && !exacto[String(r.serial).toUpperCase()]) exacto[String(r.serial).toUpperCase()] = st; });
  }
  // Sugerencia por lote para los que siguen sin tipo
  const pendientes = lista.filter(s => !exacto[s]);
  const lotes = [...new Set(pendientes.map(s => s.slice(0, 6)))];
  for (const lote of lotes) {
    const cuenta = {};
    const { data: eq } = await sb.from("equipos").select("modelo_bateria").ilike("serie_bateria", lote + "%").limit(400);
    (eq || []).forEach(e => { const st = subtipoDeModelo(e.modelo_bateria); if (st) cuenta[st] = (cuenta[st] || 0) + 1; });
    const { data: ms } = await sb.from("materiales_serializados").select("tipo_componente").ilike("serial", lote + "%").like("tipo_componente", "Batería %").limit(400);
    (ms || []).forEach(r => { const st = subtipoDeTipo(r.tipo_componente); if (st) cuenta[st] = (cuenta[st] || 0) + 1; });
    const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
    const [mejor, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || [];
    if (mejor && total >= 3 && n / total >= 0.9) pendientes.filter(s => s.startsWith(lote)).forEach(s => { sugerido[s] = mejor; });
  }
  return { exacto, sugerido };
}
