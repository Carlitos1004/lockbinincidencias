// =========================================================================
// VANDALISMO — una sola forma de marcarlo para que todas las pantallas coincidan
// =========================================================================
// Hay dos niveles: el ticket (historial_fallas.vandalismo: true / false / null)
// y cada pieza del ticket (componentes_retirados.vandalismo: true / false).
// Cuando se marca desde Ruta, el reporte técnico o el Detalle de OT, se fija el
// ticket Y todas sus piezas a la vez. Revisión de Taller trabaja por pieza y
// deja el ticket en "sí" si alguna pieza lo está.
// =========================================================================

// valor: true (vandalismo) | false (no es vandalismo) | null (sin revisar)
async function fijarVandalismoTicket(sb, idRegistro, valor) {
  if (!idRegistro) return { ok: false, error: { message: "ticket sin id" } };
  const { error } = await sb.from("historial_fallas").update({ vandalismo: valor }).eq("id_registro", idRegistro);
  if (error) return { ok: false, error };
  const { error: e2 } = await sb.from("componentes_retirados").update({ vandalismo: valor === true }).eq("id_registro", idRegistro);
  if (e2) return { ok: false, error: e2 };
  return { ok: true };
}

// ¿Debe verse marcada la casilla de un ticket? (ticket marcado, alguna pieza marcada, o el aviso viejo
// "Vandalismo/robo" en la acción mientras nadie lo haya revisado)
function ticketEsVandalismo(ticket, piezas) {
  if (!ticket) return false;
  if (ticket.vandalismo === true) return true;
  if ((piezas || []).some(p => p.vandalismo)) return true;
  return ticket.vandalismo == null && /Vandalismo\/robo/i.test(ticket.accion_calle || "");
}
