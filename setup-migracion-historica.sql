-- =========================================================================
-- AJUSTES PARA LA MIGRACIÓN DE DATOS HISTÓRICOS DESDE SHEETS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez, ANTES de importar
-- los datos viejos.
-- =========================================================================

-- 1. Quitar la exigencia de que el Módulo de Control exista en "equipos"
--    para historial_fallas y componentes_retirados. Un equipo puede ser
--    reemplazado o dado de baja con el tiempo, pero su historial de fallas
--    y componentes debe conservarse igual, exista o no hoy en la tabla
--    "equipos" actual.
alter table historial_fallas drop constraint if exists historial_fallas_m_control_fkey;
alter table componentes_retirados drop constraint if exists componentes_retirados_m_control_fkey;
alter table componentes_retirados drop constraint if exists componentes_retirados_id_registro_fkey;

-- 2. Agregar las 3 columnas de Garantías que existían en Sheets y no
--    teníamos, para no perder esa información al migrar.
alter table garantias add column if not exists criterio_revision text;
alter table garantias add column if not exists fecha_entrega date;
alter table garantias add column if not exists garantia_tiempo text;

-- 3. Agregar la columna de Observaciones de Materiales, que existía en
--    Sheets y no teníamos.
alter table materiales_ot add column if not exists observaciones text;
