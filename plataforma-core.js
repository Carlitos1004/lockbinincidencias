// =========================================================================
// plataforma-core.js — ayudantes para hablar con la plataforma (API de
// Operaciones) a través del puente /api/lockbin-api. Nunca lanzan error:
// devuelven siempre { ok, resultado, mensaje }, para que un fallo de la
// plataforma no rompa lo que se está guardando en LockBin.
// =========================================================================

// Da de baja en la plataforma el equipo que tiene este MC (= desvincular).
// resultado: "desvinculado" | "ya_dado_de_baja" | "no_esta_en_plataforma" | "error"
// ok es true en los tres primeros: en los tres el MC queda desvinculado.
async function desvincularEnPlataforma(sb, mc) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, resultado: "error", mensaje: "Sesión de LockBin vencida." };
    const r = await fetch("/api/lockbin-api", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "desvincular", mc })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, resultado: "error", mensaje: j.error || `HTTP ${r.status}` };
    return { ok: ["desvinculado", "ya_dado_de_baja", "no_esta_en_plataforma"].includes(j.resultado), resultado: j.resultado, mensaje: null, detalle: j };
  } catch (e) {
    return { ok: false, resultado: "error", mensaje: e.message };
  }
}
