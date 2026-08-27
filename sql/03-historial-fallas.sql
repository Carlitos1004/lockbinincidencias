-- =========================================================================
-- TABLA DE HISTORIAL DE FALLAS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- =========================================================================

create table if not exists historial_fallas (
  id uuid primary key default gen_random_uuid(),
  id_registro text unique not null, -- ej. "TK-MC2602048-483"
  fecha timestamptz default now(),
  cliente text,
  m_control text references equipos(m_control),
  falla text,
  estado text default '🚨 ABIERTO', -- 🚨 ABIERTO / ✅ CERRADO
  accion_calle text,
  comentarios text,
  estado_equipo text,  -- 🟢 FUNCIONANDO / 🟡 CAMBIO NECESARIO / 🔴 PENDIENTE
  fecha_cierre timestamptz,
  origen text,          -- correo de quien reportó
  id_ot text,
  estatus_revision text,
  destino text
);

alter table historial_fallas enable row level security;

-- Manager y Operario ven y crean/actualizan todo
create policy "Manager y Operario ven historial de fallas"
  on historial_fallas for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario crean fallas"
  on historial_fallas for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario actualizan fallas"
  on historial_fallas for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

-- Cliente ve solo las fallas de SUS equipos
create policy "Cliente ve fallas de sus equipos"
  on historial_fallas for select
  using (
    exists (
      select 1 from perfiles
      join equipos on equipos.cliente = perfiles.cliente_nombre
      where perfiles.id = auth.uid()
      and perfiles.rol = 'cliente'
      and equipos.m_control = historial_fallas.m_control
    )
  );
