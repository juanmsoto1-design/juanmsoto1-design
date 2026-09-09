-- ==============================================================================
-- Migración SQL para Supabase: Tipo de asignación "Vocabulario / Verbos"
-- ==============================================================================

-- 1. Actualizar el constraint o enum de tipo en la tabla asignaciones
DO $$
BEGIN
  -- Si existe un check constraint en 'tipo', lo actualizamos
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.asignaciones'::regclass
      AND conname = 'asignaciones_tipo_check'
  ) THEN
    ALTER TABLE public.asignaciones DROP CONSTRAINT asignaciones_tipo_check;
  END IF;

  -- Si existe como enum
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_asignacion') THEN
    BEGIN
      ALTER TYPE tipo_asignacion ADD VALUE IF NOT EXISTS 'vocabulario';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- Agregar check constraint permitiendo 'vocabulario'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.asignaciones'::regclass
      AND conname = 'asignaciones_tipo_check'
  ) THEN
    ALTER TABLE public.asignaciones
      ADD CONSTRAINT asignaciones_tipo_check
      CHECK (tipo IN ('cuestionario', 'texto_libre', 'ensayo', 'reporte_lectura', 'exegesis', 'presentacion', 'vocabulario'));
  END IF;
END $$;

-- 2. Crear tabla vocabulario_palabras
CREATE TABLE IF NOT EXISTS public.vocabulario_palabras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id uuid NOT NULL REFERENCES public.asignaciones(id) ON DELETE CASCADE,
  palabra_original text NOT NULL,
  traduccion_referencia text,
  orden integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Crear tabla respuestas_vocabulario
CREATE TABLE IF NOT EXISTS public.respuestas_vocabulario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entrega_id uuid NOT NULL REFERENCES public.entregas(id) ON DELETE CASCADE,
  palabra_id uuid NOT NULL REFERENCES public.vocabulario_palabras(id) ON DELETE CASCADE,
  respuesta_estudiante text,
  puntuacion numeric,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT respuestas_vocabulario_entrega_palabra_key UNIQUE (entrega_id, palabra_id)
);

-- 4. Habilitar RLS y crear políticas
ALTER TABLE public.vocabulario_palabras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respuestas_vocabulario ENABLE ROW LEVEL SECURITY;

-- Políticas para vocabulario_palabras (gestión por profesores de la materia)
DROP POLICY IF EXISTS "Profesores pueden gestionar palabras de su materia" ON public.vocabulario_palabras;
CREATE POLICY "Profesores pueden gestionar palabras de su materia"
ON public.vocabulario_palabras
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.asignaciones a
    WHERE a.id = vocabulario_palabras.asignacion_id
      AND tiene_permiso_materia(a.materia_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.asignaciones a
    WHERE a.id = vocabulario_palabras.asignacion_id
      AND tiene_permiso_materia(a.materia_id)
  )
);

-- Políticas para respuestas_vocabulario (gestión por profesores de la materia)
DROP POLICY IF EXISTS "Profesores pueden ver y calificar respuestas de su materia" ON public.respuestas_vocabulario;
CREATE POLICY "Profesores pueden ver y calificar respuestas de su materia"
ON public.respuestas_vocabulario
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.entregas e
    JOIN public.asignaciones a ON a.id = e.asignacion_id
    WHERE e.id = respuestas_vocabulario.entrega_id
      AND tiene_permiso_materia(a.materia_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.entregas e
    JOIN public.asignaciones a ON a.id = e.asignacion_id
    WHERE e.id = respuestas_vocabulario.entrega_id
      AND tiene_permiso_materia(a.materia_id)
  )
);

-- 5. Función RPC: palabras_por_codigo(p_codigo text)
-- Devuelve id, orden, palabra_original (SIN traduccion_referencia)
CREATE OR REPLACE FUNCTION public.palabras_por_codigo(p_codigo text)
RETURNS TABLE (
  id uuid,
  orden integer,
  palabra_original text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT vp.id, vp.orden, vp.palabra_original
  FROM public.vocabulario_palabras vp
  JOIN public.asignaciones a ON a.id = vp.asignacion_id
  WHERE a.codigo_acceso = p_codigo
    AND a.tipo = 'vocabulario'
  ORDER BY vp.orden ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.palabras_por_codigo(text) TO anon, authenticated;

-- 6. Función RPC: entregar_vocabulario_por_codigo(p_codigo text, p_estudiante_id uuid, p_respuestas jsonb)
-- Valida máximo 2 intentos, crea/actualiza la fila en entregas y guarda respuestas
CREATE OR REPLACE FUNCTION public.entregar_vocabulario_por_codigo(
  p_codigo text,
  p_estudiante_id uuid,
  p_respuestas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asignacion_id uuid;
  v_entrega_id uuid;
  v_intentos integer := 0;
  v_item jsonb;
BEGIN
  -- 1. Buscar asignación por código
  SELECT id INTO v_asignacion_id
  FROM public.asignaciones
  WHERE codigo_acceso = p_codigo
    AND tipo = 'vocabulario';

  IF v_asignacion_id IS NULL THEN
    RAISE EXCEPTION 'Asignación de vocabulario no encontrada o código inválido.';
  END IF;

  -- 2. Verificar entrega previa
  SELECT id, COALESCE(intentos, 1) INTO v_entrega_id, v_intentos
  FROM public.entregas
  WHERE asignacion_id = v_asignacion_id
    AND estudiante_id = p_estudiante_id;

  IF v_entrega_id IS NOT NULL THEN
    IF v_intentos >= 2 THEN
      RAISE EXCEPTION 'Ya alcanzaste el máximo de 2 intentos permitidos para esta asignación.';
    END IF;

    -- Actualizar entrega existente (incrementar intentos, resetear puntuación)
    UPDATE public.entregas
    SET intentos = v_intentos + 1,
        puntuacion = NULL,
        estado = 'entregado'
    WHERE id = v_entrega_id;

    -- Borrar respuestas previas para guardar el nuevo intento
    DELETE FROM public.respuestas_vocabulario
    WHERE entrega_id = v_entrega_id;
  ELSE
    -- Crear nueva entrega
    INSERT INTO public.entregas (asignacion_id, estudiante_id, intentos, puntuacion, estado)
    VALUES (v_asignacion_id, p_estudiante_id, 1, NULL, 'entregado')
    RETURNING id INTO v_entrega_id;
  END IF;

  -- 3. Guardar las respuestas
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_respuestas)
  LOOP
    INSERT INTO public.respuestas_vocabulario (
      entrega_id,
      palabra_id,
      respuesta_estudiante
    ) VALUES (
      v_entrega_id,
      (v_item->>'palabra_id')::uuid,
      v_item->>'respuesta'
    )
    ON CONFLICT (entrega_id, palabra_id)
    DO UPDATE SET respuesta_estudiante = EXCLUDED.respuesta_estudiante;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'entrega_id', v_entrega_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.entregar_vocabulario_por_codigo(text, uuid, jsonb) TO anon, authenticated;

-- 7. Función RPC: mis_respuestas_vocabulario_por_codigo(p_codigo text, p_estudiante_id uuid)
-- Devuelve palabra_id, respuesta_estudiante, puntuacion de la entrega del estudiante
CREATE OR REPLACE FUNCTION public.mis_respuestas_vocabulario_por_codigo(
  p_codigo text,
  p_estudiante_id uuid
)
RETURNS TABLE (
  palabra_id uuid,
  respuesta_estudiante text,
  puntuacion numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT rv.palabra_id, rv.respuesta_estudiante, rv.puntuacion
  FROM public.respuestas_vocabulario rv
  JOIN public.entregas e ON e.id = rv.entrega_id
  JOIN public.asignaciones a ON a.id = e.asignacion_id
  WHERE a.codigo_acceso = p_codigo
    AND e.estudiante_id = p_estudiante_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mis_respuestas_vocabulario_por_codigo(text, uuid) TO anon, authenticated;
