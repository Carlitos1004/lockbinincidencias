-- =========================================================================
-- TABLA DE ÓRDENES DE TRABAJO (simple, por ahora)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Más adelante esto va a crecer (fecha de cierre, resumen, etc.) — por
-- ahora solo necesitamos que exista un número de OT real al que "colgar"
-- los reportes y los componentes retirados.
-- =========================================================================

create table if not exists ordenes_trabajo (
  id_ot text primary key,
  fecha timestamptz default now(),
  creado_por text -- correo de quien la abrió
);

alter table ordenes_trabajo enable row level security;

create policy "Manager y Operario ven OTs"
  on ordenes_trabajo for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario crean OTs"
  on ordenes_trabajo for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );
