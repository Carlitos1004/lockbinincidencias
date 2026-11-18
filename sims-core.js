// =========================================================================
// sims-core.js — utilidades comunes de la custodia de SIMs
// =========================================================================
const simDigitos = t => String(t || "").replace(/\D/g, "");
// ·····123456 (las 6 últimas cifras), para verla sin ocupar toda la fila
const simCorta = iccid => { const d = simDigitos(iccid); return d ? "·····" + d.slice(-6) : "—"; };

// Une lo que escribe la persona (completo o solo las últimas cifras) con el ICCID de la plataforma.
// El ICCID impreso en la SIM a veces no lleva la última cifra (control), por eso se compara con y sin ella.
// Devuelve { iccid, coincide, error }
function simResolverIccid(escrito, plataforma) {
  const e = simDigitos(escrito), p = simDigitos(plataforma);
  if (!e) return p ? { iccid: p, coincide: true } : { iccid: "", coincide: false, error: "No hay ICCID: escribe el de la SIM." };
  if (e.length < 6) return { iccid: "", coincide: false, error: "Escribe al menos las 6 últimas cifras del ICCID." };
  if (p) {
    const p0 = p.slice(0, -1), e0 = e.slice(0, -1);
    if (p.endsWith(e) || p0.endsWith(e) || p.startsWith(e) || e.startsWith(p0) || p.startsWith(e0)) return { iccid: p.length >= e.length ? p : e, coincide: true };
  }
  return { iccid: e, coincide: false };
}
async function simUsuario() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user ? user.email : null;
}

// País del emisor según el ICCID (89 + código de país): 351 Portugal, 34 España, 39 Italia, 30 Grecia
function simPais(iccid) {
  const d = simDigitos(iccid);
  if (d.startsWith("89351")) return "Portugal";
  if (d.startsWith("8934")) return "España";
  if (d.startsWith("8939")) return "Italia";
  if (d.startsWith("8930")) return "Grecia";
  return "";
}

// Operador según el inicio (7 cifras) del ICCID. Solo lo confirmado; se amplía añadiendo líneas.
// Pendientes de confirmar: 8934076 (¿Movistar?), 8935677 (¿Melita?)
const SIM_PREFIJOS_OPERADOR = {
  "8935103": "NOS",
  "8934013": "Orange",
  "8934012": "Orange",
  "8988228": "DT",
  "8988239": "DT"
};
function simOperador(iccid) { return SIM_PREFIJOS_OPERADOR[simDigitos(iccid).slice(0, 7)] || ""; }
