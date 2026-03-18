# Plan de Mejora de Resúmenes Locales

## Alcance

Este documento verifica el análisis compartido sobre la calidad de resúmenes de Notadio y propone un plan realista para mejorar el sistema con estas restricciones:

- Todo debe correr localmente.
- El modelo de resumen actual es pequeño (`OLLAMA_MODEL=llama3.2`).
- No podemos depender de un segundo modelo grande ni de servicios cloud.
- Debemos priorizar robustez, fidelidad al contenido y costo computacional bajo.

La comparación con NotebookLM debe entenderse como una referencia de producto orientado a resumir contenido anclado a fuentes. Este documento no evalúa NotebookLM internamente; evalúa si el diagnóstico sobre Notadio es consistente con el código actual y con la falla descrita.

## Verificación del análisis recibido

### Veredicto general

El análisis es **mayormente correcto**. Describe bien el problema central: Notadio todavía tiende a resumir demasiado desde una plantilla estructural fija y no suficientemente desde la intención real del contenido.

### Puntos que sí están bien diagnosticados

#### 1. El sistema todavía empuja una estructura demasiado corporativa

Esto es cierto en términos de diseño global, aunque el código ya tiene defensas parciales.

Evidencia en el código:

- `backend/src/services/summaryService.ts` usa un esquema JSON único para casi todos los contenidos, con campos como `keyDecisions`, `actionItems`, `followUps` y `openQuestions`.
- El preset `genericMedia` sigue pidiendo “información accionable”.
- El preset `meeting` conserva guardrails que refuerzan secciones canónicas de reunión.
- El frontend presenta “AI Summary” como extracción de “key points, decisions, and action items”, lo cual también sesga la expectativa del sistema.

Conclusión: aunque ya existen reglas explícitas para no inventar tareas en contenido informal, la forma base del resumen sigue favoreciendo una lectura operativa/corporativa.

#### 2. La omisión del ejemplo central es totalmente plausible

Esto también es correcto y el código actual lo explica.

Causas probables:

- `selectSummaryInputLines()` reduce la transcripción por muestreo uniforme cuando supera el límite de caracteres.
- Ese muestreo no protege “momentos de evidencia” o ejemplos concretos.
- En resúmenes largos, la etapa de chunking y luego el reduce consolidan todavía más la información.

Consecuencia: un ejemplo crucial pero localizado, como el de “campeón del mundo de hacer conejos con globos”, puede desaparecer aunque sea el mejor soporte argumental del video.

#### 3. La conclusión filosófica se aplana

También es correcto.

El pipeline actual optimiza mejor para:

- `headline`
- `brief`
- `overview`
- listas de decisiones, riesgos y tareas

Eso favorece resumir “qué se dijo” en formato ejecutivo, pero no necesariamente “cuál es la tesis humana final” o “qué idea cultural/epistemológica sostiene el autor”.

#### 4. Los modelos pequeños sí son parte del problema

Esto es consistente con el sistema actual.

- El entorno usa `llama3.2`.
- El prompting ya intenta corregir alucinaciones, lo que indica que el modelo necesita mucha contención.
- Cuando el modelo falla, el fallback extractivo también puede producir falsos positivos porque usa heurísticas de palabras como `debe`, `hay que`, `pendiente`, etc.

Conclusión: no es solo un problema de prompt. También hay un límite real de capacidad del modelo local.

### Puntos del análisis que ya no sostienen con el código actual

#### 1. No parece que el frontend esté perdiendo el preset

Eso ya no coincide con el repositorio actual.

Evidencia:

- `frontend/src/App.tsx` sí envía `summaryPreset` al hacer submit de enhancements.
- `frontend/src/api.ts` serializa ese config completo al endpoint `/api/jobs/:jobId/enhancements`.
- `backend/src/index.ts` recibe y guarda `summaryPreset`.

Conclusión: el problema principal no parece ser “el preset no viaja”, sino que **el preset disponible sigue siendo insuficiente para ciertos tipos de contenido**, y además la estructura de salida sigue sesgando el resumen.

#### 2. Ya existen reglas anti-alucinación en prompts

El análisis previo asume que faltan por completo, pero hoy ya hay varias:

- `contentCreation` prohíbe explícitamente inventar tareas corporativas.
- `genericMedia` pide no inventar decisiones o tareas si el contenido es informal.
- El prompt general aclara que una conversación casual o stream no debe producir `actionItems`.

Conclusión: el problema ya no es ausencia de reglas. El problema es que **esas reglas compiten contra una estructura de salida que sigue pareciendo de reunión**, y contra un modelo pequeño que no siempre obedece bien.

## Causas raíz reales en Notadio

### 1. Esquema único para contenidos muy distintos

Actualmente se intenta describir reunión, podcast, stream, ensayo, conferencia y nota de voz con la misma forma base.

Eso fuerza preguntas implícitas incorrectas:

- ¿Qué decisiones hubo?
- ¿Qué tareas quedaron?
- ¿Qué follow-ups existen?

Para un ensayo crítico o filosófico, las preguntas correctas son otras:

- ¿Cuál es la tesis?
- ¿Qué ejemplo la demuestra?
- ¿Qué contraargumento o riesgo plantea?
- ¿Cuál es la conclusión humana del autor?

### 2. Falta una categoría explícita para “ensayo/opinión/análisis”

Hoy existen:

- `meeting`
- `whatsappVoiceNote`
- `genericMedia`
- `contentCreation`

Ninguna representa bien:

- video ensayo
- editorial
- análisis cultural/tecnológico
- opinión argumentada

`genericMedia` es demasiado amplio y `contentCreation` se orienta más a stream/podcast/entretenimiento.

### 3. El muestreo de entrada favorece cobertura, no evidencia

`selectSummaryInputLines()` toma líneas repartidas a lo largo del transcript para caber en el límite. Eso ayuda a cubrir todo el audio, pero perjudica:

- ejemplos clave
- anécdotas demostrativas
- analogías que sostienen la tesis
- remates finales densos

NotebookLM-style quality depende más de “evidencia anclada” que de cobertura superficial.

### 4. El fallback extractivo también puede deformar contenido no operativo

`buildFallbackSummary()` extrae:

- `keyDecisions`
- `actionItems`
- `followUps`
- `openQuestions`

con heurísticas de términos frecuentes. En un ensayo u opinión, frases del tipo “hay que pensar mejor” o “debe importarnos” pueden terminar pareciendo tareas reales, aunque no lo sean.

### 5. El reduce final premia compresión por encima de fidelidad semántica

La etapa de consolidación compacta parciales y deduplica.

Eso funciona bien para:

- reuniones
- acuerdos
- pendientes
- status updates

Pero puede degradar:

- tesis matizadas
- ejemplos narrativos
- progresión argumental
- cierre filosófico

## Objetivo de producto

Notadio no debe intentar que todo audio termine convertido en minuta. Debe producir un resumen cuya estructura dependa del tipo real de contenido.

Objetivo concreto:

> Para contenido no operativo, el resumen debe priorizar tesis, evidencia, momentos clave y conclusión; y debe dejar vacíos los campos de trabajo cuando no apliquen.

## Plan priorizado

### Fase 1. Corregir la clasificación de tipo de contenido sin usar más LLM

Prioridad: alta  
Costo: bajo  
Impacto: alto

Implementar una clasificación heurística previa al resumen usando señales del transcript:

- densidad de primera persona singular
- presencia de llamadas a la audiencia
- frecuencia de verbos de compromiso reales
- presencia de léxico de reunión (`acordamos`, `seguimiento`, `entregable`, `deadline`)
- presencia de léxico argumentativo (`mi punto`, `el problema`, `esto demuestra`, `por eso`, `la conclusión`)

Resultado esperado:

- reunión -> `meeting`
- stream/podcast -> `contentCreation`
- ensayo/opinión/video explicativo -> nuevo preset `analysisEssay`
- fallback -> `genericMedia`

Esto evita gastar una llamada extra al LLM solo para clasificar.

### Fase 2. Crear un preset nuevo: `analysisEssay`

Prioridad: alta  
Costo: bajo  
Impacto: muy alto

Agregar un preset especializado para:

- video ensayo
- análisis de actualidad
- opinión argumentada
- contenido educativo con tesis

Este preset debe pedir explícitamente:

- tesis central
- evidencia o ejemplo más importante
- ideas secundarias
- conclusión del autor
- riesgos o implicaciones

Y debe forzar:

- `actionItems = []`
- `keyDecisions = []` salvo evidencia literal
- `followUps = []`
- `openQuestions = []` salvo preguntas realmente abiertas en el contenido

### Fase 3. Separar el esquema común del esquema de reunión

Prioridad: alta  
Costo: medio  
Impacto: muy alto

En vez de usar el mismo JSON para todo, dividir el contrato en dos niveles:

#### Esquema base universal

- `headline`
- `brief`
- `overview`
- `narrative`
- `topics`
- `sections`
- `evidenceMoments`
- `speakerIntent`
- `contentType`

#### Extensión opcional para contenido operativo

- `keyDecisions`
- `actionItems`
- `followUps`
- `openQuestions`
- `operationalNotes`

Regla:

- si `contentType` no es reunión o nota operativa, los campos operativos deben quedar vacíos y no dirigir la redacción principal.

### Fase 4. Preservar “evidencia anclada” en lugar de solo cobertura

Prioridad: alta  
Costo: medio  
Impacto: alto

Agregar una pequeña capa extractiva previa al LLM para detectar fragmentos candidatos de alto valor:

- segmentos con entidades raras o frases concretas
- segmentos con patrones de ejemplo (`por ejemplo`, `imagina`, `inventé`, `probé`, `me pasó`)
- segmentos cercanos a marcadores de tesis (`la idea`, `el punto`, `mi argumento`, `la conclusión`)

Luego construir el prompt con dos bloques:

- `Contexto general`
- `Momentos de evidencia`

Así el LLM pequeño no depende solo del muestreo uniforme.

### Fase 5. Desactivar extracción de tareas por heurística en presets no operativos

Prioridad: alta  
Costo: bajo  
Impacto: alto

Cambiar `buildFallbackSummary()` para que:

- solo intente extraer `actionItems` si el preset es `meeting` o `whatsappVoiceNote`
- no derive `followUps` automáticamente desde `actionItems` en presets narrativos
- use `evidenceMoments` y `coreClaims` para contenido tipo ensayo

Esto reduce alucinaciones aun cuando falle Ollama.

### Fase 6. Reducir la agresividad del reduce final para contenido argumentativo

Prioridad: media  
Costo: medio  
Impacto: medio-alto

Para `analysisEssay` y `genericMedia` no informal:

- usar menos compactación previa al reduce
- preservar la mejor sección por densidad semántica
- mantener al menos un ejemplo concreto y una conclusión explícita

Regla mínima:

- el reduce no puede eliminar todos los ejemplos concretos
- el resumen final debe incluir al menos una pieza de evidencia textual sintetizada

### Fase 7. Ajustar UI para que la intención del resumen sea visible

Prioridad: media  
Costo: bajo  
Impacto: medio

Cambios sugeridos:

- renombrar “AI Summary” a algo menos sesgado en uploads no operativos
- cambiar la descripción del preset según tipo:
  - reunión: decisiones y tareas
  - ensayo: tesis, evidencia y conclusión
  - stream/podcast: temas, dinámica y momentos destacados

Esto alinea mejor la expectativa del usuario y reduce el sesgo de diseño.

## Cambios concretos sugeridos en código

### Backend

Archivo principal:

- `backend/src/services/summaryService.ts`

Cambios:

- agregar preset `analysisEssay`
- separar instrucciones de esquema por tipo
- introducir `contentType`
- introducir `evidenceMoments`
- condicionar `buildFallbackSummary()` por preset
- reemplazar parte del muestreo uniforme por selección híbrida:
  - cobertura
  - momentos de evidencia
  - cierre final

### Frontend

Archivos:

- `frontend/src/api.ts`
- `frontend/src/App.tsx`

Cambios:

- exponer nuevo preset `analysisEssay`
- ajustar labels/descripciones
- no renderizar bloques de `Action Items` o `Key Decisions` como protagonistas cuando el preset no sea operativo

### Tipos

Archivos:

- `backend/src/types.ts`
- `frontend/src/api.ts`

Cambios:

- ampliar `SummaryPreset`
- agregar `contentType`
- agregar `evidenceMoments`

## Plan de implementación recomendado

### Sprint 1

- agregar preset `analysisEssay`
- desactivar extracción heurística de tareas fuera de presets operativos
- ajustar prompt base para tesis, evidencia y conclusión
- exponer preset en frontend

Resultado esperado:

- mejora visible inmediata en videos tipo ensayo sin subir costo de inferencia

### Sprint 2

- implementar selección híbrida de transcript input
- preservar momentos de evidencia
- ajustar reduce final para contenido narrativo/argumentativo

Resultado esperado:

- menor pérdida de ejemplos clave
- menor aplanamiento del argumento central

### Sprint 3

- separar esquema universal vs operativo
- actualizar UI para mostrar secciones según `contentType`
- agregar evaluación local reproducible

Resultado esperado:

- el sistema deja de comportarse como minuta universal

## Métricas de evaluación

No basta con medir “si generó JSON válido”. Debemos evaluar calidad semántica.

Rubrica recomendada por transcript:

- fidelidad a la tesis central
- preservación del ejemplo o evidencia principal
- ausencia de tareas/decisiones inventadas
- calidad de la conclusión final
- adecuación del tono al tipo de contenido

Escala sugerida:

- 0 = falla total
- 1 = pobre
- 2 = aceptable
- 3 = buena
- 4 = muy buena

Conjunto mínimo de prueba local:

- 3 reuniones reales
- 2 notas de voz
- 2 streams/podcasts
- 3 videos ensayo/opinión

## Recomendación final

La mejora más rentable no es “pedirle más al modelo pequeño” sino **quitarle trabajo de clasificación y quitarle una estructura equivocada**.

Si el sistema:

- detecta mejor el tipo de contenido,
- cambia de esquema según ese tipo,
- preserva evidencia clave,
- y deja vacíos los campos operativos cuando no aplican,

entonces Notadio puede acercarse mucho más a un resumen útil estilo “fuente-anclada” sin dejar de ser completamente local.

La prioridad correcta no es hacer el resumen más sofisticado. La prioridad correcta es hacerlo **más fiel al contenido real**.
