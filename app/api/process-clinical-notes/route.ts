import { NextRequest, NextResponse } from 'next/server';
import { elevenlabs } from '@ai-sdk/elevenlabs';
import { experimental_transcribe as transcribe } from 'ai';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// System prompt del documento notas_clinicas_diabetes_followup_complicaciones.md
const CLINICAL_NOTES_SYSTEM_PROMPT = `Eres un asistente clínico especializado en elaborar notas de seguimiento para pacientes con diabetes, enfocado en detectar complicaciones, eventos recientes y hábitos/autocuidado.

Recibirás una transcripción de la consulta médica (ya limpia, con roles "Paciente" / "Profesional de salud", sin datos personales identificables), correspondiente a una visita de control.

Tu tarea:

1. Extraer los puntos clínicos más importantes en estas áreas:
   - Síntomas o signos actuales de complicaciones: neuropatía (hormigueo, entumecimiento, ardor, pérdida de sensibilidad), problemas vasculares, circulación deficiente, heridas, úlceras, cambios en la piel, infecciones, dolor en extremidades, dificultad para cicatrizar, etc.
   - Eventos recientes relevantes desde la última visita: episodios de hipoglucemia o hiperglucemia, hospitalizaciones, infecciones, complicaciones agudas, cualquier evento adverso comentado.
   - Autocuidado / hábitos / estilo de vida: adherencia a dieta, ejercicio, cuidado de pies, higiene, cambios recientes en estilo de vida, cumplimiento del tratamiento, controles de rutina, medidas de prevención, evaluación del autocuidado.

2. Ignorar datos estáticos o históricos no relevantes para esta visita. Solo extraer lo que **varía o es nuevo** en la conversación.

3. Omitir cualquier información personal identificable (nombre, documento, edad exacta, datos de contacto).

4. Entregar la salida en español, como una nota clínica bien estructurada en párrafos o viñetas (no JSON), con secciones claras:
   - Complicaciones / signos actuales
   - Eventos recientes / alertas
   - Autocuidado / hábitos / cumplimiento / recomendaciones

Ejemplo de estructura sugerida:

- **Complicaciones / hallazgos clínicos recientes**: …
- **Eventos recientes / alertas**: …
- **Autocuidado / adherencia / hábitos / recomendaciones**: …

Extrae únicamente lo que efectivamente haya cambiado o se haya mencionado en esta consulta.`;

// Función para pre-procesar y limpiar la transcripción
function preprocessTranscript(transcript: string | any): string {
  let cleanText = '';

  // Si es un string simple, usarlo directamente
  if (typeof transcript === 'string') {
    cleanText = transcript;
  } 
  // Si tiene estructura de segmentos con diarización
  else if (transcript.segments && Array.isArray(transcript.segments)) {
    cleanText = transcript.segments
      .map((segment: any) => {
        const speaker = segment.speaker || segment.speakerLabel || 'Hablante';
        const text = segment.text || segment.transcript || '';
        const timestamp = segment.start ? `[${formatTimestamp(segment.start)}]` : '';
        return `${timestamp} [${speaker}]: ${text}`;
      })
      .join('\n');
  }
  // Si tiene estructura de texto con metadata
  else if (transcript.text) {
    cleanText = transcript.text;
  }
  // Si es un objeto con propiedades de texto
  else {
    cleanText = JSON.stringify(transcript);
  }

  // Normalizar: eliminar espacios múltiples, normalizar saltos de línea
  return cleanText
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

// Función auxiliar para formatear timestamps
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const context = formData.get('context') as string || 'Consulta de seguimiento de diabetes - Termografía de pies';

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No se proporcionó archivo de audio' },
        { status: 400 }
      );
    }

    // Validar que ElevenLabs API Key esté configurada
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error('ELEVENLABS_API_KEY no está configurada');
      return NextResponse.json(
        { error: 'Configuración de API no disponible. Verifica ELEVENLABS_API_KEY en variables de entorno.' },
        { status: 500 }
      );
    }

    // Validar que OpenAI API Key esté configurada
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY no está configurada');
      return NextResponse.json(
        { error: 'Configuración de API no disponible. Verifica OPENAI_API_KEY en variables de entorno.' },
        { status: 500 }
      );
    }

    console.log(`Iniciando procesamiento de audio: ${audioFile.name}, tamaño: ${audioFile.size} bytes`);

    // Paso 1: Convertir File a Buffer para ElevenLabs
    const audioBuffer = await audioFile.arrayBuffer();
    const audioData = Buffer.from(audioBuffer);

    // Paso 2: Transcripción con ElevenLabs (con diarización)
    console.log('Iniciando transcripción con ElevenLabs Scribe...');
    let transcriptionResult;
    
    try {
      transcriptionResult = await transcribe({
        model: elevenlabs.transcription('scribe_v1'),
        audio: audioData,
        providerOptions: {
          elevenlabs: {
            languageCode: 'es', // Español
            diarize: true, // Habilita la diarización de hablantes
            timestampsGranularity: 'word', // Marcas de tiempo a nivel de palabra
          },
        },
      });
      console.log('Transcripción completada exitosamente');
    } catch (transcriptionError) {
      console.error('Error en transcripción ElevenLabs:', transcriptionError);
      return NextResponse.json(
        { 
          error: 'Error al transcribir el audio',
          details: transcriptionError instanceof Error ? transcriptionError.message : 'Error desconocido en transcripción'
        },
        { status: 500 }
      );
    }

    // Paso 3: Pre-procesamiento del transcript
    const normalizedTranscript = preprocessTranscript(transcriptionResult);
    
    if (!normalizedTranscript || normalizedTranscript.trim().length === 0) {
      return NextResponse.json(
        { error: 'La transcripción está vacía. Verifica que el audio contenga habla.' },
        { status: 400 }
      );
    }

    console.log(`Transcripción procesada: ${normalizedTranscript.length} caracteres`);

    // Paso 4: Generar notas clínicas con IA usando el system prompt del documento
    console.log('Generando notas clínicas con OpenAI...');
    let clinicalNotes;
    
    try {
      const { text } = await generateText({
        model: openai('gpt-4o'), // Usar gpt-4o para mejor calidad, o 'gpt-4-turbo' como alternativa
        system: CLINICAL_NOTES_SYSTEM_PROMPT,
        prompt: `Transcripción de la consulta médica:

${normalizedTranscript}

Contexto adicional: ${context}

Genera las notas clínicas estructuradas según las instrucciones del sistema. Extrae únicamente información relevante sobre complicaciones, eventos recientes y autocuidado mencionados en esta consulta.`,
        temperature: 0.3, // Baja temperatura para respuestas más consistentes y precisas
        maxTokens: 2000, // Límite razonable para notas clínicas
      });
      
      clinicalNotes = text;
      console.log('Notas clínicas generadas exitosamente');
    } catch (aiError) {
      console.error('Error generando notas clínicas con IA:', aiError);
      return NextResponse.json(
        { 
          error: 'Error al generar notas clínicas',
          details: aiError instanceof Error ? aiError.message : 'Error desconocido en generación de IA',
          transcription: normalizedTranscript.substring(0, 500) // Incluir parte de la transcripción para debugging
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      notes: clinicalNotes,
      processed: true,
      timestamp: new Date().toISOString(),
      transcriptionLength: normalizedTranscript.length,
      audioSize: audioFile.size,
      audioType: audioFile.type,
    });
  } catch (error) {
    console.error('Error general procesando notas clínicas:', error);
    return NextResponse.json(
      { 
        error: 'Error al procesar las notas clínicas',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    );
  }
}
