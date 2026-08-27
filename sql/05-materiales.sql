-- =========================================================================
-- TABLA DE GESTIÓN DE MATERIALES
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Formato largo: una fila por combinación (OT, Tipo de Componente).
-- =========================================================================

create table if not exists materiales_ot (
  id uuid primary key default gen_random_uuid(),
  id_ot text not null,
  tipo_componente text not null, -- "Lector Electrónico" / "Cierre Electrónico" / "Batería" / "Módulo de Control"
  llevados integer default 0,     -- lo escribe el Manager/Operario antes de salir a campo
  utilizados integer default 0,   -- se calcula solo, contando componentes_retirados
  vuelven integer default 0,      -- llevados - utilizados
  unique (id_ot, tipo_componente)
);

alter table materiales_ot enable row level security;

create policy "Manager y Operario ven materiales"
  on materiales_ot for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario gestionan materiales"
  on materiales_ot for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario actualizan materiales"
  on materiales_ot for update
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager y Operario borran materiales"
  on materiales_ot for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

-- =========================================================================
-- FUNCIÓN: recalcula "utilizados" y "vuelven" para una OT específica,
-- contando componentes_retirados (excluyendo lo marcado "excluir_materiales").
-- La llamamos desde la app cada vez que se necesite refrescar los números.
-- =========================================================================
create or replace function recalcular_materiales_ot(p_id_ot text)
returns void
language plpgsql
security definer
as $$
begin
  update materiales_ot m
  set utilizados = coalesce((
    select count(*)
    from componentes_retirados c
    where c.id_ot = p_id_ot
    and c.tipo_componente = m.tipo_componente
    and c.excluir_materiales = false
  ), 0),
  vuelven = m.llevados - coalesce((
    select count(*)
    from componentes_retirados c
    where c.id_ot = p_id_ot
    and c.tipo_componente = m.tipo_componente
    and c.excluir_materiales = false
  ), 0)
  where m.id_ot = p_id_ot;
end;
$$;
