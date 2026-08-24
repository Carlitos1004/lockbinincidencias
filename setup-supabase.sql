-- =========================================================================
-- CONFIGURACIÓN INICIAL DE SUPABASE PARA LOCKBIN
-- =========================================================================
-- Cómo usar este archivo:
-- 1. Entra a tu proyecto en supabase.com
-- 2. Ve al menú "SQL Editor" (icono de una hoja con "SQL")
-- 3. Pega TODO este archivo y dale a "Run"
-- =========================================================================

-- Tabla de perfiles: guarda el ROL de cada usuario (Manager/Operario/Cliente).
-- Supabase ya trae su propia tabla de usuarios (auth.users) para el login
-- con correo/contraseña — esta tabla nueva SOLO agrega el rol y datos extra.
create table if not exists perfiles (
  id uuid references auth.users(id) primary key,
  nombre text,
  rol text check (rol in ('manager', 'operario', 'cliente')) not null,
  cliente_nombre text, -- solo se usa si rol = 'cliente': debe coincidir EXACTO
                        -- con el nombre de Cliente en tus datos, para filtrar
                        -- después qué equipos puede ver cada cliente.
  creado_en timestamp with time zone default now()
);

-- Seguridad: cada usuario solo puede leer SU PROPIO perfil (para saber su
-- rol al iniciar sesión). Los datos de otros usuarios no se exponen.
alter table perfiles enable row level security;

create policy "Cada usuario ve su propio perfil"
  on perfiles for select
  using (auth.uid() = id);

-- =========================================================================
-- CÓMO CREAR TUS PRIMEROS 3 USUARIOS DE PRUEBA (hazlo después de correr
-- lo de arriba):
--
-- 1. Ve a "Authentication" → "Users" → "Add user" → "Create new user"
--    Crea 3 usuarios con correo + contraseña, por ejemplo:
--      manager@lockbin.test
--      operario@lockbin.test
--      cliente@lockbin.test
--
-- 2. Copia el "User UID" de cada uno (aparece en la lista de usuarios).
--
-- 3. Vuelve al "SQL Editor" y corre esto por cada usuario, reemplazando
--    el UID y los datos (ajusta rol y cliente_nombre según corresponda):
--
-- insert into perfiles (id, nombre, rol, cliente_nombre) values
--   ('PEGA-AQUI-EL-UID-DEL-MANAGER', 'Carlos', 'manager', null);
--
-- insert into perfiles (id, nombre, rol, cliente_nombre) values
--   ('PEGA-AQUI-EL-UID-DEL-OPERARIO', 'Técnico 1', 'operario', null);
--
-- insert into perfiles (id, nombre, rol, cliente_nombre) values
--   ('PEGA-AQUI-EL-UID-DEL-CLIENTE', 'Contacto Cliente', 'cliente', 'PORTO');
-- =========================================================================
