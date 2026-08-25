-- =========================================================================
-- TABLA DE GARANTÍAS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- =========================================================================

create table if not exists garantias (
  id uuid primary key default gen_random_uuid(),
  componente_id uuid unique references componentes_retirados(id),
  id_ot text,
  cliente text,
  m_control text,
  dispositivo_danado text, -- serial del componente
  falla text,               -- lo encontrado en la revisión
  garantia text,            -- "SI" / "NO"
  observacion text,         -- se llena a mano después, nunca se sobreescribe sola
  nombre_imagen text,       -- se llena a mano después
  creado_en timestamptz default now()
);

alter table garantias enable row level security;

create policy "Manager y Operario ven garantias"
  on garantias for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager gestiona garantias"
  on garantias for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager actualiza garantias"
  on garantias for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
