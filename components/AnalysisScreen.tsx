'use client';

import { useEffect, useRef, useState } from 'react';
import RecordingIndicator from './RecordingIndicator';
import { 
  segmentFootKMeans,
  applyROICalibration,
  getROIStats,
  calculateStats,
  temperatureToColor
} from '@/lib/utils';

interface ThermalData {
  rows: number;
  cols: number;
  data: number[];
}

interface AnalysisScreenProps {
  capturedLeft: ThermalData | null;
  capturedRight: ThermalData | null;
  tempRange: { min: number; max: number };
  onBack: () => void;
  onNewScreening: () => void;
  isRecording: boolean;
  recordingTime: number;
  recordingBlob: Blob | null;
  onStopRecording: () => void;
}

type ROIKey = 'hallux' | 'firstMetatarsal' | 'heel';

interface ROIStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

interface FootROIStats {
  hallux: ROIStats | null;
  firstMetatarsal: ROIStats | null;
  heel: ROIStats | null;
}

// Thermal image visualization with ROI highlighting
function FootVisualization({ 
  data, 
  footSide,
  highlightedROI,
  tempRange,
  onROIHover
}: { 
  data: ThermalData; 
  footSide: 'izquierdo' | 'derecho';
  highlightedROI: ROIKey | null;
  tempRange: { min: number; max: number };
  onROIHover: (roi: ROIKey | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rois, setRois] = useState<{hallux: boolean[]; firstMetatarsal: boolean[]; heel: boolean[]} | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rows, cols, data: frameData } = data;
    const frame = new Float32Array(frameData);

    // Segmentar el pie del fondo usando K-means
    const footMask = segmentFootKMeans(frameData, rows, cols);

    // Aplicar calibración de ROIs
    const roiData = applyROICalibration(footMask, rows, cols, footSide);
    if (roiData) {
      setRois({
        hallux: roiData.hallux,
        firstMetatarsal: roiData.firstMetatarsal,
        heel: roiData.heel,
      });
    }

    const pixelSize = 8;
    const borderWidth = 0.5;
    canvas.width = cols * pixelSize;
    canvas.height = rows * pixelSize;

    // Dibujar imagen térmica
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const temp = frame[idx];
        const isFoot = footMask[idx];
        const [r, g, b] = temperatureToColor(temp, tempRange.min, tempRange.max);

        const x = col * pixelSize;
        const y = row * pixelSize;

        // Aplicar segmentación: fondo más oscuro/transparente
        if (isFoot) {
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        } else {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
        }

        ctx.fillRect(x, y, pixelSize - borderWidth, pixelSize - borderWidth);
      }
    }

    // Dibujar ROI destacado si hay uno
    if (highlightedROI && roiData) {
      const roiKey = highlightedROI === 'firstMetatarsal' ? 'firstMetatarsal' : highlightedROI;
      const roiMask = roiData[roiKey];
      if (!roiMask) return;
      
      const highlightColor = '#6c63ff';
      
      // Dibujar overlay semi-transparente
      ctx.fillStyle = 'rgba(108, 99, 255, 0.3)';
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (roiMask[idx]) {
            const x = col * pixelSize;
            const y = row * pixelSize;
            ctx.fillRect(x, y, pixelSize - borderWidth, pixelSize - borderWidth);
          }
        }
      }
      
      // Dibujar borde
      ctx.strokeStyle = highlightColor;
      ctx.lineWidth = 3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (!roiMask[idx]) continue;
          
          const x = col * pixelSize;
          const y = row * pixelSize;
          
          // Verificar bordes
          const topEdge = row === 0 || !roiMask[(row - 1) * cols + col];
          const bottomEdge = row === rows - 1 || !roiMask[(row + 1) * cols + col];
          const leftEdge = col === 0 || !roiMask[row * cols + (col - 1)];
          const rightEdge = col === cols - 1 || !roiMask[row * cols + (col + 1)];
          
          if (topEdge || bottomEdge || leftEdge || rightEdge) {
            ctx.beginPath();
            if (topEdge) {
              ctx.moveTo(x, y);
              ctx.lineTo(x + pixelSize - borderWidth, y);
            }
            if (bottomEdge) {
              ctx.moveTo(x, y + pixelSize - borderWidth);
              ctx.lineTo(x + pixelSize - borderWidth, y + pixelSize - borderWidth);
            }
            if (leftEdge) {
              ctx.moveTo(x, y);
              ctx.lineTo(x, y + pixelSize - borderWidth);
            }
            if (rightEdge) {
              ctx.moveTo(x + pixelSize - borderWidth, y);
              ctx.lineTo(x + pixelSize - borderWidth, y + pixelSize - borderWidth);
            }
            ctx.stroke();
          }
        }
      }
    }
  }, [data, footSide, tempRange, highlightedROI]);

  // Manejar hover en el canvas
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rois || !canvasRef.current || !data) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const pixelSize = 8;
    const col = Math.floor(x / pixelSize);
    const row = Math.floor(y / pixelSize);
    
    const { rows, cols } = data;
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      onROIHover(null);
      return;
    }
    
    const idx = row * cols + col;
    
    // Verificar qué ROI contiene este píxel
    if (rois.hallux && rois.hallux[idx]) {
      onROIHover('hallux');
    } else if (rois.firstMetatarsal && rois.firstMetatarsal[idx]) {
      onROIHover('firstMetatarsal');
    } else if (rois.heel && rois.heel[idx]) {
      onROIHover('heel');
    } else {
      onROIHover(null);
    }
  };

  const handleMouseLeave = () => {
    onROIHover(null);
  };

  if (!data) {
    return <div className="no-data">Cargando...</div>;
  }

  return (
    <canvas 
      ref={canvasRef} 
      className="analysis-thermal-canvas"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

export default function AnalysisScreen({ 
  capturedLeft, 
  capturedRight, 
  tempRange,
  onBack,
  onNewScreening,
  isRecording,
  recordingTime,
  recordingBlob,
  onStopRecording
}: AnalysisScreenProps) {
  const [highlightedROI, setHighlightedROI] = useState<ROIKey | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState<string>('');
  const [isProcessingNotes, setIsProcessingNotes] = useState(false);
  const [notesGenerated, setNotesGenerated] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [checklistItems, setChecklistItems] = useState({
    examenCompletado: true,
    educacionBrindada: true,
    seguimientoAgendado: false,
  });

  // Procesar audio cuando se detiene la grabación
  const processRecording = async (audioBlob: Blob) => {
    setIsProcessingNotes(true);
    setProcessingError(null);
    try {
      // Convertir blob a File para enviarlo
      const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
      
      // Crear FormData para enviar el audio
      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('context', 'Consulta de seguimiento de diabetes - Termografía de pies');

      // Enviar a endpoint para procesamiento con ElevenLabs + OpenAI
      const response = await fetch('/api/process-clinical-notes', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.notes) {
          setClinicalNotes(data.notes);
          setNotesGenerated(true);
        } else {
          throw new Error('No se recibieron notas clínicas del servidor');
        }
      } else {
        // Obtener detalles del error
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || `Error ${response.status}: ${response.statusText}`;
        
        console.error('Error del servidor:', errorMessage);
        setProcessingError(errorMessage);
        
        // Fallback: usar procesamiento local simulado solo si es un error de configuración
        if (response.status === 500 && errorMessage.includes('API')) {
          console.warn('Error de configuración de API, usando procesamiento simulado');
          await processRecordingLocally(audioBlob);
        } else {
          // Para otros errores, mostrar el mensaje pero no usar fallback
          throw new Error(errorMessage);
        }
      }
    } catch (error) {
      console.error('Error procesando grabación:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido al procesar la grabación';
      setProcessingError(errorMessage);
      
      // Solo usar fallback si es un error de red o similar
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.warn('Error de conexión, usando procesamiento simulado');
        await processRecordingLocally(audioBlob);
      }
    } finally {
      setIsProcessingNotes(false);
    }
  };

  // Procesamiento local simulado (para desarrollo)
  const processRecordingLocally = async (audioBlob: Blob) => {
    // Simular delay de procesamiento
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Notas clínicas de ejemplo basadas en el pipeline
    const exampleNotes = `**Complicaciones / hallazgos clínicos recientes**: 
- No se reportaron síntomas de neuropatía durante la consulta.
- Examen de termografía realizado sin complicaciones aparentes.

**Eventos recientes / alertas**: 
- No se mencionaron episodios de hipoglucemia o hiperglucemia recientes.
- Sin hospitalizaciones ni infecciones reportadas desde la última visita.

**Autocuidado / adherencia / hábitos / recomendaciones**: 
- Se recomienda continuar con el cuidado regular de los pies.
- Mantener adherencia al tratamiento prescrito.
- Realizar controles periódicos según indicación médica.`;

    setClinicalNotes(exampleNotes);
    setNotesGenerated(true);
  };

  // Detener grabación y procesar cuando el usuario lo solicite
  const handleStopAndProcess = () => {
    if (isRecording) {
      onStopRecording();
      // El blob se establecerá automáticamente cuando se detenga la grabación
      // y se procesará en el useEffect siguiente
    } else if (recordingBlob && !notesGenerated && !isProcessingNotes) {
      processRecording(recordingBlob);
    }
  };

  // Auto-procesar cuando la grabación se detiene y hay blob disponible
  useEffect(() => {
    if (!isRecording && recordingBlob && !notesGenerated && !isProcessingNotes) {
      // Pequeño delay para asegurar que el blob esté completo
      const timer = setTimeout(() => {
        processRecording(recordingBlob);
      }, 1500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, recordingBlob]);

  // Calcular estadísticas para cada ROI
  const getFootStats = (data: ThermalData | null, footSide: 'izquierdo' | 'derecho'): FootROIStats | null => {
    if (!data) return null;

    const footMask = segmentFootKMeans(data.data, data.rows, data.cols);
    const rois = applyROICalibration(footMask, data.rows, data.cols, footSide);

    if (!rois) return null;

    return {
      hallux: getROIStats(data.data, rois.hallux, footMask, data.rows, data.cols),
      firstMetatarsal: getROIStats(data.data, rois.firstMetatarsal, footMask, data.rows, data.cols),
      heel: getROIStats(data.data, rois.heel, footMask, data.rows, data.cols),
    };
  };

  const leftStats = getFootStats(capturedLeft, 'izquierdo');
  const rightStats = getFootStats(capturedRight, 'derecho');

  // Calcular estadísticas generales
  const getGeneralStats = (data: ThermalData | null) => {
    if (!data) return null;
    const footMask = segmentFootKMeans(data.data, data.rows, data.cols);
    const footTemps: number[] = [];
    for (let i = 0; i < data.data.length; i++) {
      if (footMask[i]) {
        footTemps.push(data.data[i]);
      }
    }
    if (footTemps.length === 0) return null;
    return calculateStats(footTemps);
  };

  const leftGeneralStats = getGeneralStats(capturedLeft);
  const rightGeneralStats = getGeneralStats(capturedRight);

  // Calcular diferencia máxima entre pies
  const calculateMaxDifference = (): number | null => {
    if (!leftStats || !rightStats) return null;
    
    const differences = [
      leftStats.hallux && rightStats.hallux ? Math.abs(rightStats.hallux.avg - leftStats.hallux.avg) : 0,
      leftStats.firstMetatarsal && rightStats.firstMetatarsal ? Math.abs(rightStats.firstMetatarsal.avg - leftStats.firstMetatarsal.avg) : 0,
      leftStats.heel && rightStats.heel ? Math.abs(rightStats.heel.avg - leftStats.heel.avg) : 0,
    ];
    
    return Math.max(...differences);
  };

  const maxDiff = calculateMaxDifference();

  // Calcular puntuación de riesgo (simplificada)
  const calculateRiskScore = (): number => {
    if (!maxDiff) return 0;
    // Escala simplificada: 0-100 basado en diferencias
    if (maxDiff < 1) return 30;
    if (maxDiff < 2) return 50 + (maxDiff - 1) * 20;
    return 70 + Math.min((maxDiff - 2) * 10, 30);
  };

  const riskScore = calculateRiskScore();
  const riskLevel = riskScore < 50 ? 'Bajo' : riskScore < 70 ? 'Moderado' : 'Alto';

  // Calcular diferencia para cada ROI
  const getROIDifference = (roiKey: ROIKey): number | null => {
    const left = leftStats?.[roiKey]?.avg;
    const right = rightStats?.[roiKey]?.avg;
    if (left === null || left === undefined || right === null || right === undefined) return null;
    return right - left;
  };

  const getROIDifferenceLevel = (diff: number | null): 'bajo' | 'moderado' | 'alto' => {
    if (diff === null) return 'bajo';
    const absDiff = Math.abs(diff);
    if (absDiff < 1) return 'bajo';
    if (absDiff < 2) return 'moderado';
    return 'alto';
  };

  const roiNames: Record<ROIKey, string> = {
    hallux: 'Hallux (Dedo Gordo)',
    firstMetatarsal: 'Metatarso',
    heel: 'Talón (Plantar)',
  };

  const roiData: { key: ROIKey; name: string }[] = [
    { key: 'hallux', name: roiNames.hallux },
    { key: 'firstMetatarsal', name: roiNames.firstMetatarsal },
    { key: 'heel', name: roiNames.heel },
  ];

  return (
    <div className="analysis-screen">
      <RecordingIndicator isRecording={isRecording} recordingTime={recordingTime} />
      {/* Header */}
      <div className="analysis-header">
        <div className="analysis-header-left">
          <button onClick={onBack} className="analysis-back-btn">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="analysis-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="45" height="48" viewBox="0 0 45 48" fill="none">
              <g clipPath="url(#clip0_9_8287)">
                <path d="M22.1182 6.04873L44.5478 -1L38.0032 22.9928L44.5478 46.9177L22.1182 39.9368L-0.375 46.9177L6.23319 22.9928L-0.375 -1L22.1182 6.04873Z" fill="#1338BE"/>
              </g>
              <defs>
                <clipPath id="clip0_9_8287">
                  <rect width="45" height="48" fill="white"/>
                </clipPath>
              </defs>
            </svg>
          </div>
          <div className="analysis-header-info">
            <h2>María González Rodríguez</h2>
            <p>5 Diciembre 2025 • 14:30 PM</p>
          </div>
          <div className={`analysis-risk-badge ${riskLevel.toLowerCase()}`}>
            Riesgo {riskLevel}
          </div>
        </div>
        <div className="analysis-header-right">
          <button className="analysis-export-btn">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 9V1M6.5 9L3 5.5M6.5 9L10 5.5M2 12H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Exportar Reporte
          </button>
          <button onClick={onNewScreening} className="analysis-new-btn">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1V12M1 6.5H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Nuevo Screening
          </button>
          <button className="analysis-profile-btn">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 9C11.4853 9 13.5 6.9853 13.5 4.5C13.5 2.01472 11.4853 0 9 0C6.51472 0 4.5 2.01472 4.5 4.5C4.5 6.9853 6.51472 9 9 9Z" fill="currentColor"/>
              <path d="M9 10.5C4.85786 10.5 1.5 12.0147 1.5 14.25V18H16.5V14.25C16.5 12.0147 13.1421 10.5 9 10.5Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="analysis-metrics-strip">
        <div className="analysis-metric-card">
          <div className="metric-header">
            <span>Puntuación de Riesgo</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L2 7L10 12L18 7L10 2Z" stroke="#6B7280" strokeWidth="1.5" fill="none"/>
              <path d="M2 13L10 18L18 13" stroke="#6B7280" strokeWidth="1.5" fill="none"/>
            </svg>
          </div>
          <div className="metric-value-large">
            <span className="metric-number" style={{ color: '#6c63ff' }}>{riskScore.toFixed(1)}</span>
            <div className="metric-change">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2V14M8 2L4 6M8 2L12 6" stroke="#ff5a5a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>15%</span>
            </div>
          </div>
          <p className="metric-description">Índice de Riesgo Térmico</p>
        </div>
        <div className="analysis-metric-card">
          <div className="metric-header">
            <span>ΔT Diferencia Máx</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2V18M2 10H18" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="10" r="1.5" fill="#6B7280"/>
            </svg>
          </div>
          <div className="metric-value-large">
            <span className="metric-number">{maxDiff ? maxDiff.toFixed(1) : 'N/A'}°C</span>
          </div>
          <p className="metric-description">Máxima Asimetría Entre Pies</p>
        </div>
        <div className="analysis-metric-card">
          <div className="metric-header">
            <span>Indicadores Clínicos</span>
          </div>
          <div className="metric-tags">
            <span className="metric-tag">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L9 5L13 5.5L10 8.5L10.5 13L7 11L3.5 13L4 8.5L1 5.5L5 5L7 1Z" fill="currentColor"/>
              </svg>
              Neuropatía
            </span>
            <span className="metric-tag metric-tag-pink">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5 10L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Úlcera Prev.
            </span>
          </div>
          <p className="metric-description">2 Condiciones Activas</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="analysis-main-content">
        {/* First Row: Thermal Analysis and Regional Analysis side by side */}
        <div className="analysis-top-row">
          {/* Thermal Analysis */}
          <div className="analysis-thermal-section">
            <div className="analysis-section-header">
              <h3>Análisis Térmico</h3>
              <div className="analysis-view-controls">
                <div className="view-toggle"></div>
                  <button className="view-icon-btn">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
              </div>
            </div>
            <div className="analysis-feet-container">
              <div className="analysis-foot-item">
                  <p className="foot-label">Pie Derecho</p>
                <div className="foot-canvas-wrapper">
                    {capturedRight ? (
                      <FootVisualization 
                        data={capturedRight} 
                        footSide="derecho"
                        highlightedROI={highlightedROI}
                        tempRange={tempRange}
                        onROIHover={setHighlightedROI}
                      />
                  ) : (
                    <div className="no-data">No hay datos</div>
                  )}
                </div>
              </div>
              <div className="analysis-foot-item">
                  <p className="foot-label">Pie Izquierdo</p>
                <div className="foot-canvas-wrapper">
                    {capturedLeft ? (
                      <FootVisualization 
                        data={capturedLeft} 
                        footSide="izquierdo"
                        highlightedROI={highlightedROI}
                        tempRange={tempRange}
                        onROIHover={setHighlightedROI}
                      />
                  ) : (
                    <div className="no-data">No hay datos</div>
                  )}
                </div>
              </div>
            </div>
            <div className="analysis-legend">
              <div className="legend-item">
                <div className="legend-dot bajo"></div>
                <span>Bajo Riesgo (&lt; 1°C ΔT)</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot moderado"></div>
                <span>Moderado (1-2°C ΔT)</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot alto"></div>
                <span>Alto Riesgo (&gt; 2°C ΔT)</span>
              </div>
            </div>
          </div>

          {/* Regional Analysis */}
          <div className="analysis-regional-section">
            <div className="analysis-section-header">
              <h3>Análisis Regional</h3>
              <span className="zone-count">{roiData.length} zonas</span>
            </div>
            <div className="analysis-roi-cards">
              {roiData.map((roi) => {
                const leftTemp = leftStats?.[roi.key]?.avg;
                const rightTemp = rightStats?.[roi.key]?.avg;
                const diff = getROIDifference(roi.key);
                const diffLevel = getROIDifferenceLevel(diff);
                
                return (
                  <div
                    key={roi.key}
                    className={`analysis-roi-card ${highlightedROI === roi.key ? 'highlighted' : ''}`}
                    onMouseEnter={() => setHighlightedROI(roi.key)}
                    onMouseLeave={() => setHighlightedROI(null)}
                  >
                    <div className="roi-card-header">
                      <div className="roi-card-info">
                        <h4>{roi.name}</h4>
                        <p>
                          L: {leftTemp ? leftTemp.toFixed(1) : 'N/A'}°C • R: {rightTemp ? rightTemp.toFixed(1) : 'N/A'}°C
                        </p>
                      </div>
                      <div className={`roi-risk-badge ${diffLevel}`}>
                        {diffLevel === 'bajo' ? 'Bajo' : diffLevel === 'moderado' ? 'Moderado' : 'Alto'}
                      </div>
                    </div>
                    <div className="roi-card-footer">
                      {diff !== null && (
                        <span className={`roi-difference ${diffLevel}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}°C
                          {diff !== 0 && (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="diff-arrow">
                              <path d="M7 2V12M7 2L3 6M7 2L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Second Row: Clinical Notes - Full Width */}
        <div className="analysis-clinical-notes">
          <div className="clinical-notes-header">
            <div className="clinical-notes-title">
              <div className="notes-icon">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8" stroke="white" strokeWidth="1.5"/>
                  <path d="M10 6V10L13 13" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <h3>Notas Clínicas</h3>
                <p>Notas y observaciones de la sesión</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isRecording && (
                <button 
                  className="notes-action-btn stop-recording-btn"
                  onClick={handleStopAndProcess}
                  disabled={isProcessingNotes}
                >
                  {isProcessingNotes ? 'Procesando...' : 'Detener y Generar Notas'}
                </button>
              )}
              {!isRecording && recordingBlob && !notesGenerated && !isEditingNotes && (
                <button 
                  className="notes-action-btn generate-notes-btn"
                  onClick={handleStopAndProcess}
                  disabled={isProcessingNotes}
                >
                  {isProcessingNotes ? 'Procesando...' : 'Generar Notas Clínicas'}
                </button>
              )}
              {(notesGenerated || clinicalNotes.trim().length > 0) && (
                <button 
                  className="notes-action-btn"
                  onClick={() => {
                    if (isEditingNotes) {
                      // Guardar cambios
                      setIsEditingNotes(false);
                    } else {
                      // Entrar en modo edición
                      setIsEditingNotes(true);
                    }
                  }}
                >
                  {isEditingNotes ? 'Guardar' : 'Editar'}
                </button>
              )}
            </div>
          </div>
          <div className="clinical-notes-textarea">
            {isProcessingNotes ? (
              <div className="notes-processing">
                <div className="processing-spinner"></div>
                <p>Procesando grabación y generando notas clínicas...</p>
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                  Transcribiendo audio con ElevenLabs y generando notas con IA...
                </p>
              </div>
            ) : processingError ? (
              <div className="notes-error">
                <p style={{ color: '#ef4444', marginBottom: '8px', fontWeight: 500 }}>
                  ⚠️ Error al procesar la grabación
                </p>
                <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '16px' }}>
                  {processingError}
                </p>
                <button
                  onClick={() => {
                    setProcessingError(null);
                    if (recordingBlob) {
                      processRecording(recordingBlob);
                    }
                  }}
                  className="retry-processing-btn"
                >
                  Intentar de nuevo
                </button>
                <textarea 
                  placeholder="Puede ingresar las notas clínicas manualmente aquí..." 
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  style={{ marginTop: '16px' }}
                />
              </div>
            ) : isEditingNotes || !notesGenerated ? (
              <textarea 
                placeholder={isEditingNotes ? "Edite las notas clínicas..." : "Ingrese observaciones y notas clínicas... o detenga la grabación para generar notas automáticamente"} 
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  padding: '16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  fontSize: '16px',
                  lineHeight: '24px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#6c63ff';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#e5e7eb';
                }}
              />
            ) : clinicalNotes ? (
              <div className="clinical-notes-content">
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  fontFamily: 'inherit',
                  margin: 0,
                  padding: 0,
                  fontSize: '16px',
                  lineHeight: '24px',
                  color: 'rgba(17, 24, 39, 0.8)'
                }}>{clinicalNotes}</pre>
              </div>
            ) : (
              <textarea 
                placeholder="Ingrese observaciones y notas clínicas... o detenga la grabación para generar notas automáticamente" 
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
              />
            )}
          </div>
          <div className="clinical-notes-checklist">
            <p className="checklist-title">Lista de Verificación</p>
            <div className="checklist-items">
              <div 
                className={`checklist-item ${checklistItems.examenCompletado ? 'checked' : ''}`}
                onClick={() => setChecklistItems(prev => ({ ...prev, examenCompletado: !prev.examenCompletado }))}
                style={{ cursor: 'pointer' }}
              >
                {checklistItems.examenCompletado ? (
                  <div className="checkmark">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                ) : (
                  <div className="checkmark-empty"></div>
                )}
                <span>Examen de pies completado</span>
              </div>
              <div 
                className={`checklist-item ${checklistItems.educacionBrindada ? 'checked' : ''}`}
                onClick={() => setChecklistItems(prev => ({ ...prev, educacionBrindada: !prev.educacionBrindada }))}
                style={{ cursor: 'pointer' }}
              >
                {checklistItems.educacionBrindada ? (
                  <div className="checkmark">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                ) : (
                  <div className="checkmark-empty"></div>
                )}
                <span>Educación al paciente brindada</span>
              </div>
              <div 
                className={`checklist-item ${checklistItems.seguimientoAgendado ? 'checked' : ''}`}
                onClick={() => setChecklistItems(prev => ({ ...prev, seguimientoAgendado: !prev.seguimientoAgendado }))}
                style={{ cursor: 'pointer' }}
              >
                {checklistItems.seguimientoAgendado ? (
                  <div className="checkmark">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                ) : (
                  <div className="checkmark-empty"></div>
                )}
                <span>Seguimiento agendado</span>
              </div>
            </div>
          </div>
          <div className="clinical-notes-footer">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="#6B7280" strokeWidth="1.5"/>
              <path d="M7 4V7L9 9" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p>Última actualización: Hoy a las 2:34 PM</p>
          </div>
        </div>
      </div>
    </div>
  );
}

