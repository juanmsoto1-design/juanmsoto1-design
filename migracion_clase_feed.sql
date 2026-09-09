-- ==============================================================================
-- Migración SQL para Supabase: Salón de Clases (clase.html)
-- ==============================================================================

-- 1. Función RPC: estudiantes_por_codigo_materia(p_codigo_registro text)
-- Devuelve los estudiantes de una materia buscando por materias.codigo_registro
CREATE OR REPLACE FUNCTION public.estudiantes_por_codigo_materia(p_codigo_registro text)
RETURNS TABLE (
  id uuid,
  no_orden integer,
  nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.no_orden, e.nombre
  FROM public.estudiantes e
  JOIN public.materias m ON m.id = e.materia_id
  WHERE m.codigo_registro = UPPER(TRIM(p_codigo_registro))
     OR m.codigo_registro = TRIM(p_codigo_registro)
  ORDER BY e.no_orden ASC NULLS LAST, e.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.estudiantes_por_codigo_materia(text) TO anon, authenticated;


-- 2. Función RPC: materia_por_codigo_registro(p_codigo_registro text)
-- Devuelve datos básicos de la materia para el encabezado del salón de clases
CREATE OR REPLACE FUNCTION public.materia_por_codigo_registro(p_codigo_registro text)
RETURNS TABLE (
  id uuid,
  nombre text,
  profesor text,
  periodo text,
  año text,
  codigo_registro text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.nombre, m.profesor, m.periodo, m.año, m.codigo_registro
  FROM public.materias m
  WHERE m.codigo_registro = UPPER(TRIM(p_codigo_registro))
     OR m.codigo_registro = TRIM(p_codigo_registro);
END;
$$;

GRANT EXECUTE ON FUNCTION public.materia_por_codigo_registro(text) TO anon, authenticated;


-- 3. Función RPC: mis_asignaciones_por_materia(p_codigo_registro text, p_estudiante_id uuid)
-- Devuelve todas las asignaciones de la materia cruzadas con las entregas del estudiante (LEFT JOIN)
CREATE OR REPLACE FUNCTION public.mis_asignaciones_por_materia(
  p_codigo_registro text,
  p_estudiante_id uuid
)
RETURNS TABLE (
  id uuid,
  titulo text,
  descripcion text,
  tipo text,
  fecha_entrega date,
  hora_entrega time without time zone,
  puntos numeric,
  codigo_acceso text,
  estado text,
  puntuacion numeric,
  intentos integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.titulo,
    a.descripcion,
    a.tipo,
    a.fecha_entrega,
    a.hora_entrega,
    a.puntos,
    a.codigo_acceso,
    CASE 
      WHEN ent.puntuacion IS NOT NULL THEN 'calificado'
      WHEN ent.id IS NOT NULL THEN 'entregado'
      ELSE 'pendiente'
    END AS estado,
    ent.puntuacion,
    COALESCE(ent.intentos, 0) AS intentos
  FROM public.asignaciones a
  JOIN public.materias m ON m.id = a.materia_id
  LEFT JOIN public.entregas ent ON ent.asignacion_id = a.id AND ent.estudiante_id = p_estudiante_id
  WHERE m.codigo_registro = UPPER(TRIM(p_codigo_registro))
     OR m.codigo_registro = TRIM(p_codigo_registro)
  ORDER BY a.fecha_entrega ASC NULLS LAST, a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mis_asignaciones_por_materia(text, uuid) TO anon, authenticated;


-- 4. Función RPC: tabla_posiciones_por_codigo_materia(p_codigo_registro text)
-- Tabla de posiciones global del salón de clases con puntos totales acumulados
CREATE OR REPLACE FUNCTION public.tabla_posiciones_por_codigo_materia(p_codigo_registro text)
RETURNS TABLE (
  estudiante_id uuid,
  nombre text,
  no_orden integer,
  puntos_totales numeric,
  asignaciones_calificadas bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id AS estudiante_id,
    e.nombre,
    e.no_orden,
    COALESCE(SUM(ent.puntuacion), 0) AS puntos_totales,
    COUNT(ent.puntuacion) AS asignaciones_calificadas
  FROM public.estudiantes e
  JOIN public.materias m ON m.id = e.materia_id
  LEFT JOIN public.asignaciones a ON a.materia_id = m.id
  LEFT JOIN public.entregas ent ON ent.asignacion_id = a.id AND ent.estudiante_id = e.id AND ent.puntuacion IS NOT NULL
  WHERE m.codigo_registro = UPPER(TRIM(p_codigo_registro))
     OR m.codigo_registro = TRIM(p_codigo_registro)
  GROUP BY e.id, e.nombre, e.no_orden
  ORDER BY puntos_totales DESC, e.no_orden ASC NULLS LAST, e.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tabla_posiciones_por_codigo_materia(text) TO anon, authenticated;
