-- =========================================================================
-- RENOMBRAR "NUEVO"/"USADO" A "1RA CATEGORÍA"/"2DA CATEGORÍA"
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Actualiza el texto en los componentes y garantías ya guardados, para que
-- coincidan con las nuevas opciones de Revisión de Taller.
-- =========================================================================

update componentes_retirados set destino = '✓ Equipo OK - Stock (1ra categoría)'
  where destino = '✓ Equipo OK- Stock (nuevo)';
update componentes_retirados set destino = '✓ Equipo OK - Stock (2da categoría)'
  where destino = '✓ Equipo OK - Stock (usado)';
update componentes_retirados set destino = '❌ Equipo dañado - Enviar a AMMI (2da categoría)'
  where destino = '❌ Equipo dañado - Enviar a AMMI (usado)';
update componentes_retirados set destino = '❌ Equipo dañado - Enviar a AMMI (1ra categoría)'
  where destino = '❌ Equipo dañado - Enviar a AMMI (nuevo)';

update garantias set criterio_revision = '✓ Equipo OK - Stock (1ra categoría)'
  where criterio_revision = '✓ Equipo OK- Stock (nuevo)';
update garantias set criterio_revision = '✓ Equipo OK - Stock (2da categoría)'
  where criterio_revision = '✓ Equipo OK - Stock (usado)';
update garantias set criterio_revision = '❌ Equipo dañado - Enviar a AMMI (2da categoría)'
  where criterio_revision = '❌ Equipo dañado - Enviar a AMMI (usado)';
update garantias set criterio_revision = '❌ Equipo dañado - Enviar a AMMI (1ra categoría)'
  where criterio_revision = '❌ Equipo dañado - Enviar a AMMI (nuevo)';

-- Actualiza la función de Stock General para que busque el texto nuevo
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
    where destino in ('✓ Equipo OK - Stock (1ra categoría)', '✓ Equipo OK - Stock (2da categoría)')
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
