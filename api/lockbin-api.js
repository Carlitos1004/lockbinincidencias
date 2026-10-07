// =========================================================================
// Puente (proxy) hacia la API de Operaciones de LockBin
// =========================================================================
// La web NO puede llamar directamente a la API (CORS), y además las
// credenciales de la API no deben estar nunca en el navegador. Esta función
// corre en el servidor de Vercel: guarda la sesión de la API, la renueva sola
// y solo deja pasar una lista cerrada de operaciones.
//
//   GET  ?accion=whoami | equipos      → lectura
//   POST {accion: battery|lock|reader|recycle, deviceId, valor} → escritura
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   LOCKBIN_API_USER          usuario de la API (obligatoria)
//   LOCKBIN_API_PASS          contraseña de la API (obligatoria)
//   LOCKBIN_API_BASE          opcional, por defecto https://api.lockbin.dev
//   LOCKBIN_API_ALLOW_WRITES  opcional: "1" permite escribir en un host que NO
//                             sea el de preproducción (api.lockbin.dev).
//                             Mientras no se ponga, las escrituras solo
//                             funcionan contra preproducción.
//
// Quién puede llamarla: solo usuarios de LockBin con rol "manager"
// (se comprueba el token de Supabase en cada petición). Cada escritura
// queda registrada en la tabla api_operaciones_log.
// =========================================================================

const API_BASE = (process.env.LOCKBIN_API_BASE || "https://api.lockbin.dev").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://haoveumvgejetfqpmwtj.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhb3ZldW12Z2VqZXRmcXBtd3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjU1NjcsImV4cCI6MjEwMzE0MTU2N30.P0amDoIYqPZ60VCvGvr1ISUccNgXUzrD2BaJTSD-FIA";
const ROLES_PERMITIDOS = ["manager"];
const TIMEOUT_MS = 9000;
const HOST_PREPRODUCCION = "api.lockbin.dev";

// Cookies de la sesión de la API. Se conservan mientras la instancia del
// servidor siga "caliente"; si se pierden, simplemente se vuelve a iniciar sesión.
let jar = {};

function guardarCookies(resp) {
  const lista = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
  for (const c of lista) {
    const par = c.split(";")[0];
    const i = par.indexOf("=");
    if (i < 1) continue;
    const nombre = par.slice(0, i).trim();
    const valor = par.slice(i + 1).trim();
    if (valor === "") delete jar[nombre]; else jar[nombre] = valor;
  }
}

function cabeceraCookie() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchConTiempo(url, opciones = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

async function iniciarSesionApi() {
  const login = process.env.LOCKBIN_API_USER;
  const password = process.env.LOCKBIN_API_PASS;
  if (!login || !password) throw fallo(500, "Faltan LOCKBIN_API_USER / LOCKBIN_API_PASS en Vercel.");
  jar = {};
  const r = await fetchConTiempo(API_BASE + "/api/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password })
  });
  if (!r.ok) throw fallo(502, `La API rechazó el inicio de sesión del servidor (HTTP ${r.status}).`);
  guardarCookies(r);
}

async function renovarSesionApi() {
  const r = await fetchConTiempo(API_BASE + "/api/auth/refreshtoken", {
    method: "POST",
    headers: { Cookie: cabeceraCookie() }
  });
  if (!r.ok) return false;
  guardarCookies(r);
  return true;
}

// Llamada a la API con sesión. Si responde 401 (la petición NO se procesó)
// renueva o vuelve a entrar y reintenta UNA vez. Con cualquier otro estado
// no se reintenta nunca, para no duplicar una escritura.
async function llamarApi(ruta, { method = "GET", body = null } = {}) {
  const pedir = () => fetchConTiempo(API_BASE + ruta, {
    method,
    headers: {
      Cookie: cabeceraCookie(),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!jar.lockbin) {
    if (jar["lockbin-rt"] && await renovarSesionApi()) { /* sesión renovada */ }
    else await iniciarSesionApi();
  }
  let r = await pedir();
  if (r.status === 401) {
    if (!(await renovarSesionApi())) await iniciarSesionApi();
    r = await pedir();
  }
  return r;
}

async function verificarUsuario(req) {
  const cab = req.headers.authorization || "";
  const token = cab.startsWith("Bearer ") ? cab.slice(7) : "";
  if (!token) throw fallo(401, "Falta la sesión de LockBin.");
  const cabSupabase = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: "application/json" };

  const ru = await fetchConTiempo(`${SUPABASE_URL}/auth/v1/user`, { headers: cabSupabase });
  if (!ru.ok) throw fallo(401, "Sesión de LockBin no válida o vencida.");
  const usuario = await ru.json();

  const rp = await fetchConTiempo(
    `${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(usuario.id)}&select=rol`,
    { headers: cabSupabase }
  );
  const perfiles = rp.ok ? await rp.json() : [];
  const rol = perfiles[0]?.rol;
  if (!ROLES_PERMITIDOS.includes(rol)) throw fallo(403, "Tu rol no tiene acceso a esta función.");
  return { id: usuario.id, email: usuario.email || null, rol, token };
}

function construirRutaEquipos(q) {
  const partes = [];
  const unico = (v) => (Array.isArray(v) ? v[0] : v);

  const serialBoard = unico(q.serialBoard);
  if (serialBoard) {
    if (!/^[A-Za-z0-9_*\-]{1,40}$/.test(serialBoard)) throw fallo(400, "serialBoard no válido.");
    partes.push("serialBoard=" + encodeURIComponent(serialBoard));
  }
  const customerId = unico(q.customerId);
  if (customerId) {
    if (!/^\d{1,10}$/.test(customerId)) throw fallo(400, "customerId no válido.");
    partes.push("customerId=" + customerId);
  }
  const pageNo = unico(q.pageNo) ?? "0";
  if (!/^\d{1,4}$/.test(pageNo) || Number(pageNo) > 1000) throw fallo(400, "pageNo no válido.");
  partes.push("pageNo=" + pageNo);

  const pageSize = unico(q.pageSize) ?? "120";
  if (!/^\d{1,3}$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 120) throw fallo(400, "pageSize no válido (1–120).");
  partes.push("pageSize=" + pageSize);

  const sort = unico(q.sort);
  if (sort) {
    if (!/^[A-Za-z]{1,30}(,(asc|desc))?$/.test(sort)) throw fallo(400, "sort no válido.");
    partes.push("sort=" + sort);
  }
  return "/api/operations/v1/equipment/?" + partes.join("&");
}

// ---------- Escrituras ----------
const ESCRITURAS = {
  battery: { metodo: "PATCH", sufijo: "battery", campo: "serial" },
  lock:    { metodo: "PATCH", sufijo: "lock",    campo: "serial" },
  reader:  { metodo: "PATCH", sufijo: "reader",  campo: "serial" },
  recycle: { metodo: "POST",  sufijo: "recycle", campo: "newSerialBoard" }
};

function escrituraPermitida() {
  let host = "";
  try { host = new URL(API_BASE).host; } catch (e) { /* host vacío */ }
  return host === HOST_PREPRODUCCION || process.env.LOCKBIN_API_ALLOW_WRITES === "1";
}

async function registrarOperacion(usuario, fila) {
  try {
    const r = await fetchConTiempo(`${SUPABASE_URL}/rest/v1/api_operaciones_log`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${usuario.token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ usuario_id: usuario.id, usuario_email: usuario.email, ...fila })
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function manejarEscritura(req, usuario) {
  if (!escrituraPermitida()) {
    throw fallo(403, "Las escrituras están desactivadas: la API configurada no es la de preproducción.");
  }
  let cuerpo = req.body;
  if (typeof cuerpo === "string") { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (!cuerpo || typeof cuerpo !== "object") throw fallo(400, "Cuerpo de la petición no válido.");

  const def = ESCRITURAS[cuerpo.accion];
  if (!def) throw fallo(400, "Acción de escritura no permitida.");
  const deviceId = String(cuerpo.deviceId ?? "");
  if (!/^\d{1,10}$/.test(deviceId)) throw fallo(400, "deviceId no válido.");
  const valor = String(cuerpo.valor ?? "").trim();
  if (!/^[A-Za-z0-9_.\-]{1,40}$/.test(valor)) throw fallo(400, "El serial indicado no es válido.");

  const datosApi = { [def.campo]: valor };
  const r = await llamarApi(`/api/operations/v1/device/${deviceId}/${def.sufijo}`, { method: def.metodo, body: datosApi });

  const texto = await r.text();
  let respuesta = null;
  try { respuesta = texto ? JSON.parse(texto) : null; } catch (e) { respuesta = { texto: texto.slice(0, 300) }; }

  const registrado = await registrarOperacion(usuario, {
    accion: cuerpo.accion,
    device_id: Number(deviceId),
    datos: datosApi,
    estado_api: r.status,
    respuesta
  });

  return { estadoApi: r.status, respuesta, registrado };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  try {
    const usuario = await verificarUsuario(req);

    if (req.method === "POST") {
      return res.status(200).json(await manejarEscritura(req, usuario));
    }

    const accion = Array.isArray(req.query.accion) ? req.query.accion[0] : req.query.accion;

    if (accion === "whoami") {
      const r = await llamarApi("/api/auth/whoami");
      if (!r.ok) throw fallo(502, `La API respondió HTTP ${r.status} en whoami.`);
      const u = await r.json();
      return res.status(200).json({ ...u, escrituraPermitida: escrituraPermitida(), host: API_BASE.replace(/^https?:\/\//, "") });
    }

    if (accion === "equipos") {
      const r = await llamarApi(construirRutaEquipos(req.query));
      if (r.status === 204) return res.status(200).json({ total: 0, totalPaginas: 0, items: [] });
      if (r.status === 403) throw fallo(502, "La cuenta de la API no tiene ROLE_OPERATIONS (HTTP 403).");
      if (!r.ok) throw fallo(502, `La API respondió HTTP ${r.status}.`);
      const items = await r.json();
      return res.status(200).json({
        total: Number(r.headers.get("x-allsnsd-total")) || items.length,
        totalPaginas: Number(r.headers.get("x-allsnsd-totalpages")) || 1,
        items
      });
    }

    throw fallo(400, "Acción no permitida.");
  } catch (err) {
    const status = err.status || (err.name === "AbortError" ? 504 : 500);
    const mensaje = err.name === "AbortError" ? "La API tardó demasiado en responder." : (err.status ? err.message : "Error interno del puente.");
    return res.status(status).json({ error: mensaje });
  }
};
