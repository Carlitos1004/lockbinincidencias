// =========================================================================
// SESIÓN MULTI-ROL — para páginas que pueden usar más de un rol (como la
// Ruta, que ahora usan tanto Operario como Manager). La página debe
// definir ROLES_PERMITIDOS = ["manager", "operario"] antes de este script.
// =========================================================================

const PANEL_POR_ROL_MULTI = {
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
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  if (!ROLES_PERMITIDOS.includes(perfil.rol)) {
    window.location.href = PANEL_POR_ROL_MULTI[perfil.rol] || "index.html";
    return;
  }

  const spanNombre = document.getElementById("nombre-usuario");
  if (spanNombre) spanNombre.textContent = perfil.nombre || session.user.email;

  window.perfilActual = perfil;
  document.dispatchEvent(new CustomEvent("perfil-listo", { detail: perfil }));
})();

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("lockbin_nombre");
    window.location.href = "index.html";
  });
}
