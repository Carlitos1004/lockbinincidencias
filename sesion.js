// =========================================================================
// Compartido por admin.html / tecnico.html / cliente.html
// Verifica que haya sesión activa (si no, manda de vuelta al login) y
// conecta el botón de "Cerrar sesión".
// =========================================================================

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }

  const nombre = sessionStorage.getItem("lockbin_nombre") || session.user.email;
  const spanNombre = document.getElementById("nombre-usuario");
  if (spanNombre) spanNombre.textContent = nombre;
})();

const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("lockbin_nombre");
    window.location.href = "index.html";
  });
}
