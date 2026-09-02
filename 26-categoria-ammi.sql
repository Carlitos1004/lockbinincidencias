-- =========================================================================
-- SEPARAR "CATEGORÍA PARA AMMI" DE "DESTINO"
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Antes, el Destino mezclaba 2 preguntas distintas para los envíos a AMMI:
-- si era equipo nuevo/de calle (1ra/2da categoría) Y si cubría garantía del
-- cliente, todo en un solo texto. Ahora son 2 campos separados.
-- =========================================================================

alter table componentes_retirados add column if not exists categoria_ammi text;
alter table componentes_retirados add column if not exists garantia_cliente text;

-- Migrar los destinos viejos de AMMI al nuevo esquema (primero esto, para
-- que el backfill de garantía de abajo encuentre el destino ya al día)
update componentes_retirados
set destino = '❌ Equipo dañado - Enviar a AMMI',
    categoria_ammi = '1ra categoría'
where destino = '❌ Equipo dañado - Enviar a AMMI (1ra categoría)';

update componentes_retirados
set destino = '❌ Equipo dañado - Enviar a AMMI',
    categoria_ammi = '2da categoría'
where destino = '❌ Equipo dañado - Enviar a AMMI (2da categoría)';

update componentes_retirados
set destino = '❌ Equipo dañado - Enviar a AMMI'
where destino in (
  '❌ Equipo dañado - Enviar a AMMI (equipo con garantía)',
  '❌ Equipo dañado sin garantía (esperando presupuesto)'
);

-- Para los componentes que YA tenían una fila en garantias (de antes de este
-- cambio), rescatamos qué habían elegido de garantía, para que no se pierda
-- al reabrir esa fila en Revisión de Taller.
update componentes_retirados cr
set garantia_cliente = case
  when lower(g.criterio_revision) like '%con garantía%' then 'SI'
  else 'NO'
end
from garantias g
where g.componente_id = cr.id
  and cr.destino = '❌ Equipo dañado - Enviar a AMMI';
