-- =========================================================================
-- FECHAS DE ENTREGA (para calcular vigencia de garantías)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Combina "Equipos nuevos" (por Módulo de Control) y "Módulos sueltos"
-- (por serial de componente) en una sola tabla de búsqueda, ya que ambas
-- tienen la misma forma y nunca se solapan en formato de identificador.
-- =========================================================================

create table if not exists fechas_entrega (
  identificador text primary key, -- Módulo de Control O serial de componente
  cliente text,
  fecha_entrega date
);

alter table fechas_entrega enable row level security;

create policy "Manager y Operario ven fechas de entrega"
  on fechas_entrega for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager gestiona fechas de entrega"
  on fechas_entrega for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager actualiza fechas de entrega"
  on fechas_entrega for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
