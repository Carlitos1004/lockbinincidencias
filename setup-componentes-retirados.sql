-- =========================================================================
-- TABLA DE COMPONENTES RETIRADOS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Necesita que "historial_fallas" y "equipos" ya existan.
-- =========================================================================

create table if not exists componentes_retirados (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz default now(),
  cliente text,
  m_control text references equipos(m_control),
  tipo_componente text,     -- "Lector Electrónico" / "Cierre Electrónico" / "Batería" / "Módulo de Control"
  serial_retirado text,
  id_registro text references historial_fallas(id_registro),
  id_ot text,
  estado text default 'Pendiente revisión',
  -- Pendiente revisión / Revisado / Descartado / Cambiado por el cliente / Faltante/Perdido
  reparacion text,          -- lo que se anota en la revisión de taller (se llena después)
  destino text,             -- a dónde va el componente (se llena después, en revisión)
  excluir_materiales boolean default false -- true = no cuenta como material usado (cliente lo retiró)
);

alter table componentes_retirados enable row level security;

create policy "Manager y Operario ven componentes retirados"
  on componentes_retirados for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario crean componentes retirados"
  on componentes_retirados for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario actualizan componentes retirados"
  on componentes_retirados for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );
