-- =========================================================================
-- ESTADÍSTICAS DE FALLAS
-- =========================================================================
-- Corre esto en el SQL Editor de Supabase, una sola vez.
-- Calcula todo en la base de datos (fallas más comunes, tasa de fallo por
-- cliente, resuelto/pendiente, tendencia mensual) en una sola función, sin
-- toparse con el límite de 1000 filas de las consultas normales.
-- =========================================================================

create or replace function estadisticas_fallas()
returns json
language sql
security definer
as $$
  select json_build_object(
    'fallas_comunes', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select falla, count(*) as cantidad
        from historial_fallas
        group by falla
        order by cantidad desc
        limit 15
      ) t
    ),
    'por_cliente', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select
          e.cliente,
          count(distinct e.m_control) as equipos_instalados,
          count(distinct hf.m_control) as equipos_con_falla
        from equipos e
        left join historial_fallas hf on hf.m_control = e.m_control
        where e.cliente is not null
        group by e.cliente
        order by count(distinct e.m_control) desc
      ) t
    ),
    'estado', (
      select json_build_object(
        'resuelto', (select count(*) from historial_fallas where estado_equipo = '🟢 FUNCIONANDO'),
        'pendiente', (select count(*) from historial_fallas where estado_equipo in ('🟡 CAMBIO NECESARIO', '🔴 PENDIENTE')),
        'sin_cerrar', (select count(*) from historial_fallas where estado_equipo is null or estado_equipo = ''),
        'total', (select count(*) from historial_fallas)
      )
    ),
    'tendencia_mensual', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(fecha, 'YYYY-MM') as mes, count(*) as cantidad
        from historial_fallas
        where fecha is not null
        group by mes
        order by mes
      ) t
    )
  );
$$;
