// =========================================================================
// NOMBRES DE USUARIO
// Los registros guardan el correo de quien hizo cada cosa. Aquí se traduce
// ese correo al nombre del perfil (función SQL nombres_usuarios, SQL 82).
// Si no se encuentra el nombre (usuario borrado, cliente, importación),
// se muestra el correo tal cual.
// =========================================================================

let _mapaNombresUsuarios = {};
let _promesaNombresUsuarios = null;

function cargarNombresUsuarios() {
  if (!_promesaNombresUsuarios) {
    _promesaNombresUsuarios = (async () => {
      try {
        const { data, error } = await supabaseClient.rpc("nombres_usuarios");
        if (error) throw error;
        _mapaNombresUsuarios = {};
        (data || []).forEach(u => { _mapaNombresUsuarios[(u.email || "").toLowerCase()] = u.nombre; });
      } catch (err) {
        console.error("No se pudieron cargar los nombres de usuarios:", err);
      }
    })();
  }
  return _promesaNombresUsuarios;
}

function _escUsuario(t) {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Texto plano: nombre si se conoce, si no el correo, si no "—".
function nombreUsuario(email) {
  if (!email) return "—";
  const limpio = String(email).replace(/\s*\(migración\)\s*$/i, "").trim().toLowerCase();
  return _mapaNombresUsuarios[limpio] || email;
}

// HTML: el nombre, y el correo al pasar el ratón (o al tocar en el móvil).
function htmlUsuario(email) {
  if (!email) return "—";
  const nombre = nombreUsuario(email);
  if (nombre === email) return _escUsuario(email);
  return `<span class="usuario-nombre" title="${_escUsuario(email)}" style="cursor:help;">${_escUsuario(nombre)}</span>`;
}

cargarNombresUsuarios();
