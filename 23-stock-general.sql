-- =========================================================================
-- STOCK GENERAL
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
--
-- El disponible de cada tipo de componente se calcula en vivo, sumando 3
-- fuentes (nunca se guarda un número fijo, siempre se recalcula solo):
--
--   + Entradas manuales (compras nuevas, correcciones) — tabla stock_ajustes
--   + Componentes que volvieron a stock tras revisión (destino "Stock (usado)"
--     o "Stock (nuevo)" en Revisión de Taller)
--   - Lo "Utilizado" de cada OT en Materiales (lo que de verdad se consumió
--     en campo — "Llevados" no cuenta, porque lo que "Vuelve" ya no se
--     restó de ningún lado)
-- =========================================================================

create table if not exists stock_ajustes (
  id uuid primary key default gen_random_uuid(),
  tipo_componente text not null,
  cantidad integer not null, -- positivo = entra (compra), negativo = corrección hacia abajo
  motivo text not null,
  fecha timestamptz not null default now(),
  creado_por text
);

alter table stock_ajustes enable row level security;

create policy "Todos ven ajustes de stock"
  on stock_ajustes for select
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol in ('manager', 'operario')
    )
  );

create policy "Manager registra ajustes de stock"
  on stock_ajustes for insert
  with check (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

create policy "Manager borra ajustes de stock"
  on stock_ajustes for delete
  using (
    exists (
      select 1 from perfiles
      where perfiles.id = auth.uid()
      and perfiles.rol = 'manager'
    )
  );

-- Disponible en vivo por tipo de componente
create or replace function stock_actual()
returns table(
  tipo_componente text,
  entradas_manuales bigint,
  vueltos_a_stock bigint,
  consumido bigint,
  disponible bigint
)
language sql
security definer
as $$
  with tipos as (
    select distinct tipo_componente as tipo from materiales_ot
    union
    select distinct tipo_componente from componentes_retirados
    union
    select distinct tipo_componente from stock_ajustes
  ),
  ajustes as (
    select tipo_componente, sum(cantidad) as total
    from stock_ajustes
    group by tipo_componente
  ),
  vuelto as (
    select tipo_componente, count(*) as total
    from componentes_retirados
    where destino in ('✓ Equipo OK- Stock (nuevo)', '✓ Equipo OK - Stock (usado)')
    group by tipo_componente
  ),
  consumido as (
    select tipo_componente, sum(utilizados) as total
    from materiales_ot
    group by tipo_componente
  )
  select
    tipos.tipo,
    coalesce(a.total, 0),
    coalesce(v.total, 0),
    coalesce(c.total, 0),
    coalesce(a.total, 0) + coalesce(v.total, 0) - coalesce(c.total, 0)
  from tipos
  left join ajustes a on a.tipo_componente = tipos.tipo
  left join vuelto v on v.tipo_componente = tipos.tipo
  left join consumido c on c.tipo_componente = tipos.tipo
  order by tipos.tipo;
$$;
