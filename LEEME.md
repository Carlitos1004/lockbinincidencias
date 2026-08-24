# LockBin Web — Primeros pasos

## 1. Configura Supabase

1. Entra a tu proyecto en supabase.com → menú **SQL Editor**.
2. Abre `setup-supabase.sql`, copia TODO el contenido, pégalo ahí y dale a **Run**.
3. Ve a **Authentication → Users → Add user → Create new user** y crea tus 3 usuarios de prueba (correo + contraseña) — mira los comentarios al final de `setup-supabase.sql` para los pasos exactos de asignarles un rol.
4. Ve a **Project Settings → API** y copia:
   - `Project URL`
   - `anon public` key

## 2. Conecta el código a tu Supabase

Abre `config.js` y reemplaza las dos líneas:

```js
const SUPABASE_URL = "PEGA_AQUI_TU_PROJECT_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_ANON_PUBLIC_KEY";
```

## 3. Pruébalo en tu computadora (opcional, antes de publicar)

No necesitas instalar nada — son archivos estáticos. Basta con abrir `index.html` haciendo doble clic, o si tienes Python instalado, desde esta carpeta:

```
python3 -m http.server 8000
```

y entra a `http://localhost:8000` en el navegador.

## 4. Publícalo para que se vea desde cualquier lugar

1. Crea un repositorio nuevo en **github.com** (por ejemplo, `lockbin-web`), y sube esta carpeta completa (arrástrala en la interfaz web de GitHub, o usa GitHub Desktop si prefieres no usar comandos).
2. Entra a **vercel.com**, inicia sesión con tu cuenta de GitHub.
3. `Add New → Project` → selecciona el repositorio `lockbin-web` → `Deploy` (no necesitas cambiar ninguna configuración, son archivos estáticos).
4. En un par de minutos te da una URL pública (`lockbin-web.vercel.app` o similar) — esa es tu app, accesible desde cualquier lugar.
5. Cada vez que subas cambios nuevos a GitHub, Vercel los publica solo, automáticamente.

## Qué probar ahora

Entra con cada uno de tus 3 usuarios de prueba y confirma que cada uno cae en su panel correspondiente (Manager → `admin.html`, Operario → `tecnico.html`, Cliente → `cliente.html`), y que "Cerrar sesión" te regresa al login.

## Archivos de este proyecto

| Archivo | Qué hace |
|---|---|
| `setup-supabase.sql` | Crea la tabla de roles en Supabase (correr una sola vez) |
| `index.html` / `auth.js` | Pantalla de login |
| `config.js` | Tus claves de conexión a Supabase (edítalo tú) |
| `admin.html` / `tecnico.html` / `cliente.html` | Los 3 paneles (por ahora, solo confirman el login) |
| `sesion.js` | Compartido por los 3 paneles: verifica sesión y cierra sesión |
| `styles.css` | Estilos de toda la app |
