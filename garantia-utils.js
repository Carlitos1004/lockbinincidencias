// =========================================================================
// CÁLCULO DE VIGENCIA DE GARANTÍAS
// Replica exacto la lógica que ya tenían en Google Sheets (columnas G/H/I
// de la hoja Garantias), pero calculada EN VIVO en vez de guardada fija —
// así "Vigente/Vencida" siempre refleja la fecha de HOY, sin depender de
// que alguien vuelva a abrir el Sheet para que se recalcule.
// =========================================================================

const DIAS_GARANTIA = 730; // 2 años, igual que la fórmula original

// "Fecha de entrega" -> "SÍ (Vigente)" / "NO (Vencida)" / "Sin Registro"
function calcularGarantiaTiempo(fechaEntrega) {
  if (!fechaEntrega) return "Sin Registro";
  const dias = Math.floor((Date.now() - new Date(fechaEntrega).getTime()) / 86400000);
  if (isNaN(dias)) return "Sin Registro";
  return dias <= DIAS_GARANTIA ? "SÍ (Vigente)" : "NO (Vencida)";
}

// Destino elegido en la revisión + fecha de entrega -> estado final legible
function calcularEstadoFinalGarantia(criterioRevision, fechaEntrega) {
  if (!criterioRevision) return "";
  if (criterioRevision.toLowerCase().includes("con garantía")) {
    const tiempo = calcularGarantiaTiempo(fechaEntrega);
    return tiempo === "SÍ (Vigente)"
      ? "✅ APLICAR GARANTÍA"
      : "❌ GARANTÍA DENEGADA (Tiempo Vencido)";
  }
  return "❌ NO APLICA (Daño por mal uso / Criterio Técnico)";
}

// true/false simple, para filtrar o mostrar en reportes
function esGarantiaAplicable(criterioRevision, fechaEntrega) {
  return calcularEstadoFinalGarantia(criterioRevision, fechaEntrega).startsWith("✅");
}

// Busca la fecha de entrega: primero por Módulo de Control, si no
// aparece, por el serial del componente dañado.
async function buscarFechaEntrega(mControl, serialComponente) {
  if (mControl) {
    const { data } = await supabaseClient
      .from("fechas_entrega")
      .select("fecha_entrega")
      .eq("identificador", mControl)
      .maybeSingle();
    if (data?.fecha_entrega) return data.fecha_entrega;
  }
  if (serialComponente) {
    const { data } = await supabaseClient
      .from("fechas_entrega")
      .select("fecha_entrega")
      .eq("identificador", serialComponente)
      .maybeSingle();
    if (data?.fecha_entrega) return data.fecha_entrega;
  }
  return null;
}
