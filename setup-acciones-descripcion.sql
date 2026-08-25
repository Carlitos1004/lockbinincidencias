-- =========================================================================
-- GUARDAR LA DESCRIPCIÓN DE LA ACCIÓN DE FORMA ESTRUCTURADA
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Antes, las casillas de "Descripción de la acción" solo se guardaban
-- mezcladas dentro del texto libre de accion_calle — no había forma de
-- reconstruir cuáles estaban marcadas al reabrir el ticket. Ahora se
-- guardan aparte, como una lista.
-- =========================================================================

alter table historial_fallas add column if not exists acciones_descripcion text[];
