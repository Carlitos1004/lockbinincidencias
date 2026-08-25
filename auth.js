// =========================================================================
// LOGIN — autentica con Supabase y redirige según el rol (perfiles.rol)
// =========================================================================

const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");
const loginBtn = document.getElementById("login-btn");

// Si ya hay una sesión activa (por ejemplo, recargaste la página), redirige
// directo sin pedir login de nuevo.
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await redirigirSegunRol(session.user.id);
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  ocultarError();
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    mostrarError("Correo o contraseña incorrectos.");
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
    return;
  }

  await redirigirSegunRol(data.user.id);
});

async function redirigirSegunRol(userId) {
  const { data: perfil, error } = await supabaseClient
    .from("perfiles")
    .select("rol, nombre")
    .eq("id", userId)
    .single();

  if (error || !perfil) {
    mostrarError("Tu cuenta no tiene un rol asignado todavía. Contacta al administrador.");
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
    return;
  }

  // Guardamos el nombre para mostrarlo luego en el panel correspondiente
  sessionStorage.setItem("lockbin_nombre", perfil.nombre || "");

  if (perfil.rol === "manager") {
    window.location.href = "admin.html";
  } else if (perfil.rol === "operario") {
    window.location.href = "ruta.html";
  } else if (perfil.rol === "cliente") {
    window.location.href = "cliente.html";
  } else {
    mostrarError("Rol desconocido: " + perfil.rol);
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
  }
}

function mostrarError(texto) {
  errorMsg.textContent = texto;
  errorMsg.hidden = false;
}

function ocultarError() {
  errorMsg.hidden = true;
}
