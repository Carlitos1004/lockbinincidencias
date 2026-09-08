-- =========================================================================
-- ¿ESTUVO EN CALLE? (editable, con valor por defecto calculado)
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
--
-- Regla por defecto: si tiene un cliente real asociado (cliente_original,
-- o cliente que no sea "INTERNO"), se asume que SÍ estuvo en calle. Si
-- viene de una OT manual con cliente "INTERNO" (categoría, sin cliente
-- real), se asume que NO.
--
-- Esto es solo el punto de partida — sigue siendo editable a mano en
-- Revisión de Taller para los casos raros (ej. equipo categoría 1 que ya
-- está en la nave del cliente pero aún sin instalar).
-- =========================================================================

alter table componentes_retirados add column if not exists estuvo_en_calle boolean;

update componentes_retirados
set estuvo_en_calle = (
  coalesce(cliente_original, cliente) is not null
  and coalesce(cliente_original, cliente) <> 'INTERNO'
)
where estuvo_en_calle is null;
