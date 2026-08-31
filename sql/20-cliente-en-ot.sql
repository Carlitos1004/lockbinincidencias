-- =========================================================================
-- CLIENTE EN ÓRDENES DE TRABAJO
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Hasta ahora, el "cliente" de una OT se sacaba solo de sus tickets en
-- historial_fallas. Para las OT que no tienen ningún ticket (actuaciones
-- sin falla, como un cambio masivo de materiales), no había dónde guardar
-- el cliente. Esta columna lo resuelve.
-- =========================================================================

alter table ordenes_trabajo add column if not exists cliente text;
