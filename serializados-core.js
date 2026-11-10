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
