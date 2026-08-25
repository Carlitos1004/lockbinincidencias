// =========================================================================
// SESIÓN GENÉRICA — para páginas que usan varios roles a la vez (como el
// detalle de OT). Solo exige que haya sesión activa; no redirige por rol.
// Deja el perfil disponible en window.perfilActual para que la página
// decida qué mostrar/ocultar según el rol.
// =========================================================================

window.perfilActual = null;

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }

  const { data: perfil, error } = await supabaseClient
    .from("perfiles")
    .select("rol, nombre, cliente_nombre")
    .eq("id", session.user.id)
    .single();

  if (error || !perfil) {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
    return;
  }

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
