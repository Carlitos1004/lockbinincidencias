// =========================================================================
// Compartido por admin.html / tecnico.html / cliente.html
// Verifica que haya sesión activa Y que el rol del usuario coincida con
// el panel en el que está — si no coincide, lo manda al panel correcto
// en vez de mostrarle uno que no le pertenece.
//
// Cada HTML debe definir ROL_ESPERADO antes de cargar este script, ej.:
//   <script>const ROL_ESPERADO = "manager";</script>
// =========================================================================

const PANEL_POR_ROL = {
  manager: "admin.html",
  operario: "ruta.html",
  cliente: "cliente.html"
};

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }

  const { data: perfil, error } = await supabaseClient
    .from("perfiles")
    .select("rol, nombre")
    .eq("id", session.user.id)
    .single();

  if (error || !perfil) {
    // Sesión válida pero sin perfil asignado: no lo dejamos ver ningún panel
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  if (perfil.rol !== ROL_ESPERADO) {
    // Está logueado, pero con un rol que no es el de este panel: lo mandamos
    // al panel que sí le corresponde (o al login si el rol es desconocido)
    window.location.href = PANEL_POR_ROL[perfil.rol] || "index.html";
    return;
  }

  const spanNombre = document.getElementById("nombre-usuario");
  if (spanNombre) spanNombre.textContent = perfil.nombre || session.user.email;
})();

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("lockbin_nombre");
    window.location.href = "index.html";
  });
}
