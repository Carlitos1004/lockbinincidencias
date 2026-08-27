-- =========================================================================
-- INSTRUCCIONES EN ÓRDENES DE TRABAJO
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- =========================================================================

alter table ordenes_trabajo add column if not exists instrucciones text;

-- Faltaba una política de UPDATE para ordenes_trabajo (antes solo había
-- select/insert) — la agrega solo para Manager.
create policy "Manager actualiza OTs"
  on ordenes_trabajo for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );
