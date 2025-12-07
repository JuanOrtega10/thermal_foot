'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { 
  temperatureToColor, 
  calculateStats, 
  segmentFootKMeans,
  getFootBoundingBox,
  normalizeCoordinates,
  applyROICalibration,
  type ROICalibration,
  type ROISelection
} from '@/lib/utils';
import DashboardScreen from './DashboardScreen';
import AnalysisScreen from './AnalysisScreen';
import PreparationScreen from './PreparationScreen';
import RecordingIndicator from './RecordingIndicator';

interface ThermalData {
  rows: number;
  cols: number;
  data: number[];
}

interface Stats {
  fps: number;
  min: number;
  max: number;
  avg: number;
}

// Componente para calibración de ROIs
function ROICalibrationCanvas({ 
  data, 
  tempRange, 
  footSide,
  onCalibrationComplete,
  onCancel
}: { 
  data: ThermalData; 
  tempRange: { min: number; max: number };
  footSide: 'izquierdo' | 'derecho';
  onCalibrationComplete: (calibration: ROICalibration) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentROI, setCurrentROI] = useState<keyof Omit<ROICalibration, 'calibratedOn'> | null>(null);
  const [selections, setSelections] = useState<{
    hallux?: ROISelection;
    firstMetatarsal?: ROISelection;
    heel?: ROISelection;
  }>({});
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ row: number; col: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ row: number; col: number } | null>(null);

  const { rows, cols, data: frameData } = data;
  const frame = new Float32Array(frameData);
  const footMask = segmentFootKMeans(frameData, rows, cols);
  const bbox = getFootBoundingBox(footMask, rows, cols);

  const pixelSize = 16;

  // Convertir coordenadas del canvas a coordenadas de matriz
  const canvasToMatrix = (x: number, y: number) => {
    const col = Math.floor(x / pixelSize);
    const row = Math.floor(y / pixelSize);
    return { row: Math.max(0, Math.min(rows - 1, row)), col: Math.max(0, Math.min(cols - 1, col)) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentROI || !bbox) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pos = canvasToMatrix(x, y);
    
    // Solo permitir selección dentro del pie
    const idx = pos.row * cols + pos.col;
    if (!footMask[idx]) return;

    setIsSelecting(true);
    setStartPos(pos);
    setCurrentPos(pos);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPos) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pos = canvasToMatrix(x, y);
    setCurrentPos(pos);
  };

  const handleMouseUp = () => {
    if (!isSelecting || !startPos || !currentPos || !currentROI || !bbox) return;

    const selection: ROISelection = {
      minRow: Math.min(startPos.row, currentPos.row),
      maxRow: Math.max(startPos.row, currentPos.row),
      minCol: Math.min(startPos.col, currentPos.col),
      maxCol: Math.max(startPos.col, currentPos.col),
    };

    setSelections(prev => ({ ...prev, [currentROI]: selection }));
    setIsSelecting(false);
    setStartPos(null);
    setCurrentPos(null);
  };

  const handleSaveCalibration = () => {
    if (!bbox || !selections.hallux || !selections.firstMetatarsal || !selections.heel) return;

    const calibration: ROICalibration = {
      hallux: normalizeCoordinates(selections.hallux, bbox),
      firstMetatarsal: normalizeCoordinates(selections.firstMetatarsal, bbox),
      heel: normalizeCoordinates(selections.heel, bbox),
      calibratedOn: {
        footSide,
        footHeight: bbox.maxRow - bbox.minRow + 1,
        footWidth: bbox.maxCol - bbox.minCol + 1,
      },
    };

    // Guardar en localStorage
    localStorage.setItem('roiCalibration', JSON.stringify(calibration));
    onCalibrationComplete(calibration);
  };

  // Dibujar canvas con selecciones
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

        ctx.fillStyle = isFoot ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, 0.15)`;
        ctx.fillRect(x, y, pixelSize - 1, pixelSize - 1);
      }
    }

    // Dibujar selecciones existentes con colores contrastantes
    const colors = {
      hallux: 'rgba(255, 255, 0, 0.3)',      // Amarillo
      firstMetatarsal: 'rgba(0, 255, 255, 0.3)', // Cyan
      heel: 'rgba(255, 0, 255, 0.3)',        // Magenta
    };

    Object.entries(selections).forEach(([roi, selection]) => {
      if (!selection) return;
      ctx.fillStyle = colors[roi as keyof typeof colors];
      ctx.fillRect(
        selection.minCol * pixelSize,
        selection.minRow * pixelSize,
        (selection.maxCol - selection.minCol + 1) * pixelSize,
        (selection.maxRow - selection.minRow + 1) * pixelSize
      );
    });

    // Dibujar selección actual
    if (isSelecting && startPos && currentPos) {
      const selection = {
        minRow: Math.min(startPos.row, currentPos.row),
        maxRow: Math.max(startPos.row, currentPos.row),
        minCol: Math.min(startPos.col, currentPos.col),
        maxCol: Math.max(startPos.col, currentPos.col),
      };
      ctx.fillStyle = colors[currentROI as keyof typeof colors] || 'rgba(255, 255, 0, 0.3)';
      ctx.fillRect(
        selection.minCol * pixelSize,
        selection.minRow * pixelSize,
        (selection.maxCol - selection.minCol + 1) * pixelSize,
        (selection.maxRow - selection.minRow + 1) * pixelSize
      );
    }
  }, [data, tempRange, selections, isSelecting, startPos, currentPos, currentROI, footMask, frame, rows, cols]);

  return (
    <div className="roi-calibration">
      <div className="calibration-header">
        <h3>Definir Áreas de Interés</h3>
        <button onClick={onCancel} className="cancel-calibration-btn">✕</button>
      </div>
      <div className="calibration-controls">
        <button 
          onClick={() => setCurrentROI('hallux')}
          className={`roi-select-btn ${currentROI === 'hallux' ? 'active' : ''} ${selections.hallux ? 'completed' : ''}`}
        >
          {selections.hallux ? '✓' : ''} Hallux
        </button>
        <button 
          onClick={() => setCurrentROI('firstMetatarsal')}
          className={`roi-select-btn ${currentROI === 'firstMetatarsal' ? 'active' : ''} ${selections.firstMetatarsal ? 'completed' : ''}`}
        >
          {selections.firstMetatarsal ? '✓' : ''} Primer Metatarsiano
        </button>
        <button 
          onClick={() => setCurrentROI('heel')}
          className={`roi-select-btn ${currentROI === 'heel' ? 'active' : ''} ${selections.heel ? 'completed' : ''}`}
        >
          {selections.heel ? '✓' : ''} Talón
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: currentROI ? 'crosshair' : 'default' }}
        className="calibration-canvas"
      />
      <div className="calibration-instructions">
        <p>
          {currentROI 
            ? `Selecciona la zona del ${currentROI === 'hallux' ? 'Hallux' : currentROI === 'firstMetatarsal' ? 'Primer Metatarsiano' : 'Talón'}. Haz clic y arrastra sobre el pie.`
            : 'Selecciona una zona para comenzar'}
        </p>
      </div>
      <div className="calibration-actions">
        <button 
          onClick={handleSaveCalibration}
          disabled={!selections.hallux || !selections.firstMetatarsal || !selections.heel}
          className="save-calibration-btn"
        >
          Guardar Calibración
        </button>
      </div>
    </div>
  );
}

// Componente para renderizar una captura
function CapturedCanvas({ 
  data, 
  tempRange, 
  footSide 
}: { 
  data: ThermalData; 
  tempRange: { min: number; max: number };
  footSide?: 'izquierdo' | 'derecho';
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rows, cols, data: frameData } = data;
    const frame = new Float32Array(frameData);

    // Segmentar el pie del fondo usando K-means
    const footMask = segmentFootKMeans(frameData, rows, cols);

    // Aplicar calibración de ROIs si está disponible y se proporciona el tipo de pie
    let rois = null;
    if (footSide) {
      rois = applyROICalibration(footMask, rows, cols, footSide);
    }

    const pixelSize = 16;
    const borderWidth = 1;
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
          // Pie: color normal
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        } else {
          // Fondo: semi-transparente para destacar el pie
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
        }

        ctx.fillRect(x, y, pixelSize - borderWidth, pixelSize - borderWidth);

        ctx.strokeStyle = `rgba(0, 0, 0, 0.1)`;
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(x, y, pixelSize - borderWidth, pixelSize - borderWidth);
      }
    }

    // Dibujar ROIs si están disponibles
    if (rois) {
      // Colores de borde contrastantes que funcionan sobre cualquier fondo
      const roiBorderColors = {
        hallux: '#FFFF00',      // Amarillo brillante - contrasta con rojo/azul
        firstMetatarsal: '#00FFFF', // Cyan brillante - contrasta con rojo/verde
        heel: '#FF00FF',        // Magenta brillante - contrasta con verde/azul
      };
      
      // Relleno muy sutil con patrón de rayas
      const roiFillColors = {
        hallux: 'rgba(255, 255, 0, 0.15)',      // Amarillo muy transparente
        firstMetatarsal: 'rgba(0, 255, 255, 0.15)', // Cyan muy transparente
        heel: 'rgba(255, 0, 255, 0.15)',        // Magenta muy transparente
      };

      // Dibujar cada ROI con borde y relleno
      Object.entries({
        hallux: rois.hallux,
        firstMetatarsal: rois.firstMetatarsal,
        heel: rois.heel,
      }).forEach(([roiName, roiMask]) => {
        const borderColor = roiBorderColors[roiName as keyof typeof roiBorderColors];
        const fillColor = roiFillColors[roiName as keyof typeof roiFillColors];
        
        // Primero dibujar el relleno sutil
        ctx.fillStyle = fillColor;
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
        
        // Luego dibujar los bordes contrastantes
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'miter';
        
        // Dibujar bordes de manera más eficiente: solo los bordes externos de la ROI
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const idx = row * cols + col;
            if (!roiMask[idx]) continue;
            
            const x = col * pixelSize;
            const y = row * pixelSize;
            ctx.beginPath();
            
            // Verificar cada lado y dibujar solo si es un borde
            const topEdge = row === 0 || !roiMask[(row - 1) * cols + col];
            const bottomEdge = row === rows - 1 || !roiMask[(row + 1) * cols + col];
            const leftEdge = col === 0 || !roiMask[row * cols + (col - 1)];
            const rightEdge = col === cols - 1 || !roiMask[row * cols + (col + 1)];
            
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
      });
    }
  }, [data, tempRange, footSide]);

  return <canvas ref={canvasRef} className="captured-canvas" />;
}

export default function ThermalViewer() {
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [stats, setStats] = useState<Stats>({ fps: 0, min: 0, max: 0, avg: 0 });
  const [serverUrl, setServerUrl] = useState('ws://10.0.6.189:8765');
  const [tempRange, setTempRange] = useState({ min: 28.0, max: 38.0 });
  const [simulationMode, setSimulationMode] = useState<'baja_diferencia' | 'alta_diferencia'>('baja_diferencia');
  const [foot, setFoot] = useState<'izquierdo' | 'derecho'>('izquierdo');
  const [capturedLeft, setCapturedLeft] = useState<ThermalData | null>(null);
  const [capturedRight, setCapturedRight] = useState<ThermalData | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationFoot, setCalibrationFoot] = useState<'izquierdo' | 'derecho' | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showPreparation, setShowPreparation] = useState(true);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  
  // Estado de grabación
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  
  // Refs para estadísticas que no necesitan re-render
  const frameCountRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const lastFrameRef = useRef<ThermalData | null>(null);
  const reconnectDelayRef = useRef(1000);
  const drawFrameRef = useRef<(data: ThermalData) => void>();
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasReceivedValidDataRef = useRef(false);
  const validMessageCountRef = useRef(0);
  const isConnectingRef = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const simulationModeRef = useRef<'baja_diferencia' | 'alta_diferencia'>('baja_diferencia');
  const footRef = useRef<'izquierdo' | 'derecho'>('izquierdo');

  // Funciones de grabación
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordingBlob(audioBlob);
        console.log('Grabación completada, tamaño:', audioBlob.size);
        // Detener todos los tracks del stream
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Timer para el tiempo de grabación
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error al iniciar la grabación:', error);
      alert('No se pudo acceder al micrófono. Por favor, verifica los permisos.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      
      // El blob se establecerá en el callback onstop del MediaRecorder
    }
  }, [isRecording]);

  // Cleanup de grabación al desmontar
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Función para dibujar un frame en el canvas
  const drawFrame = useCallback((data: ThermalData) => {
    // Actualizar ref del rango de temperatura
    const currentTempRange = tempRange;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rows, cols, data: frameData } = data;
    const frame = new Float32Array(frameData);

    // Validar dimensiones
    if (frame.length !== rows * cols) {
      console.error('Dimensiones incorrectas:', {
        expected: rows * cols,
        actual: frame.length,
      });
      return;
    }

    // Dimensiones del canvas - ajustado para que quepa completo
    const pixelSize = 18; // 18px por píxel del sensor (reducido para que quepa completo)
    const canvasWidth = cols * pixelSize;
    const canvasHeight = rows * pixelSize;
    const pixelWidth = pixelSize;
    const pixelHeight = pixelSize;
    const borderWidth = 1; // Borde entre píxeles

    // Configurar canvas
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Dibujar cada píxel con estética pixelada mejorada
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Leer temperatura (indexación row-major)
        const idx = row * cols + col;
        const temp = frame[idx];

        // Convertir a color RGB
        const [r, g, b] = temperatureToColor(temp, currentTempRange.min, currentTempRange.max);

        // Posición del píxel
        const x = col * pixelWidth;
        const y = row * pixelHeight;

        // Dibujar píxel principal (sin segmentación en tiempo real)
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, y, pixelWidth - borderWidth, pixelHeight - borderWidth);

        // Agregar borde sutil para efecto pixelado
        ctx.strokeStyle = `rgba(0, 0, 0, 0.1)`;
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(x, y, pixelWidth - borderWidth, pixelHeight - borderWidth);
      }
    }

    // Dibujar líneas guía (crosshair)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    
    // Línea vertical central
    ctx.beginPath();
    ctx.moveTo(canvasWidth / 2, 0);
    ctx.lineTo(canvasWidth / 2, canvasHeight);
    ctx.stroke();
    
    // Línea horizontal central
    ctx.beginPath();
    ctx.moveTo(0, canvasHeight / 2);
    ctx.lineTo(canvasWidth, canvasHeight / 2);
    ctx.stroke();
    
    ctx.setLineDash([]); // Reset line dash

    // Calcular estadísticas
    const frameStats = calculateStats(frameData);
    lastFrameRef.current = data;

    // Actualizar FPS
    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    frameCountRef.current += 1;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const fps = elapsed > 0 ? frameCountRef.current / elapsed : 0;

    // Actualizar estado de estadísticas (throttle: solo cada 5 frames)
    if (frameCountRef.current % 5 === 0) {
      setStats({
        fps: Math.round(fps * 10) / 10,
        min: Math.round(frameStats.min * 10) / 10,
        max: Math.round(frameStats.max * 10) / 10,
        avg: Math.round(frameStats.avg * 10) / 10,
      });
    }
  }, [tempRange]);

  // Mantener refs actualizados
  useEffect(() => {
    drawFrameRef.current = drawFrame;
  }, [drawFrame]);

  useEffect(() => {
    simulationModeRef.current = simulationMode;
    // Enviar cambio de modo al servidor si está conectado
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const configMessage = JSON.stringify({ 
          simulation_mode: simulationMode,
          foot: footRef.current
        });
        wsRef.current.send(configMessage);
        console.log('Modo de simulación cambiado a:', simulationMode);
      } catch (err) {
        console.error('Error enviando cambio de modo:', err);
      }
    }
  }, [simulationMode]);

  useEffect(() => {
    footRef.current = foot;
    // Enviar cambio de pie al servidor si está conectado
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const configMessage = JSON.stringify({ 
          simulation_mode: simulationModeRef.current,
          foot: foot
        });
        wsRef.current.send(configMessage);
        console.log('Pie cambiado a:', foot);
      } catch (err) {
        console.error('Error enviando cambio de pie:', err);
      }
    }
  }, [foot]);

  // Función de conexión WebSocket
  const connect = useCallback(() => {
    // Evitar múltiples intentos de conexión simultáneos
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    // Cerrar conexión existente si hay una
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Reconexión');
      } catch (e) {
        // Ignorar errores al cerrar
      }
      wsRef.current = null;
    }

    // Limpiar timeout de reconexión anterior
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Limpiar timeout de conexión anterior
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Validar URL antes de intentar conectar
    if (!serverUrl || !serverUrl.trim()) {
      setError('URL del servidor no válida');
      setConnected(false);
      setIsConnecting(false);
      isConnectingRef.current = false;
      return;
    }

    // Validar formato de URL WebSocket
    if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
      setError('URL debe comenzar con ws:// o wss://');
      setConnected(false);
      setIsConnecting(false);
      isConnectingRef.current = false;
      return;
    }

    isConnectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      // Timeout para detectar conexiones que no se establecen
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          setError('Tiempo de espera agotado. El servidor no responde.');
          setConnected(false);
          setIsConnecting(false);
          isConnectingRef.current = false;
        }
      }, 10000); // 10 segundos de timeout

      ws.onopen = () => {
        console.log('Conectado al servidor térmico');
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        // Limpiar timeout de error si existe
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = null;
        }
        isConnectingRef.current = false;
        setConnected(true);
        setIsConnecting(false);
        setError(null);
        hasReceivedValidDataRef.current = false;
        validMessageCountRef.current = 0;
        reconnectDelayRef.current = 1000; // Reset delay en conexión exitosa
        frameCountRef.current = 0;
        startTimeRef.current = Date.now();
        
        // Enviar configuración inicial al servidor
        try {
          const configMessage = JSON.stringify({ 
            simulation_mode: simulationModeRef.current,
            foot: footRef.current
          });
          ws.send(configMessage);
          console.log('Configuración enviada al servidor:', { 
            simulation_mode: simulationModeRef.current, 
            foot: footRef.current 
          });
        } catch (err) {
          console.error('Error enviando configuración al servidor:', err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: ThermalData = JSON.parse(event.data);

          // Validar estructura
          if (
            typeof data.rows !== 'number' ||
            typeof data.cols !== 'number' ||
            !Array.isArray(data.data)
          ) {
            console.error('Formato de datos inválido:', data);
            // Solo mostrar error si no hemos recibido datos válidos antes
            if (!hasReceivedValidDataRef.current) {
              setError('Formato de datos inválido recibido del servidor');
            }
            return;
          }

          // Marcar que hemos recibido datos válidos
          hasReceivedValidDataRef.current = true;
          validMessageCountRef.current += 1;
          
          // Limpiar error solo después de recibir varios mensajes válidos (evitar parpadeo)
          // Usar setError directamente sin depender del closure
          if (validMessageCountRef.current > 3) {
            // Usar timeout para evitar limpiar el error inmediatamente
            if (errorTimeoutRef.current) {
              clearTimeout(errorTimeoutRef.current);
            }
            errorTimeoutRef.current = setTimeout(() => {
              setError((prevError) => {
                if (prevError) {
                  return null;
                }
                return prevError;
              });
              errorTimeoutRef.current = null;
            }, 500); // Esperar 500ms antes de limpiar el error
          }

          // Procesar frame
          if (drawFrameRef.current) {
            drawFrameRef.current(data);
          }
        } catch (err) {
          console.error('Error procesando mensaje:', err);
          // Solo mostrar error si no hemos recibido datos válidos antes
          if (!hasReceivedValidDataRef.current) {
            setError('Error al procesar datos del servidor');
          }
        }
      };

      ws.onerror = (event) => {
        // WebSocket error events don't contain useful information in the event object
        // Log diagnostic information instead
        const errorInfo = {
          url: serverUrl,
          readyState: ws.readyState,
          readyStateText: ws.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                          ws.readyState === WebSocket.OPEN ? 'OPEN' :
                          ws.readyState === WebSocket.CLOSING ? 'CLOSING' :
                          ws.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN',
          timestamp: new Date().toISOString(),
        };
        console.error('Error WebSocket:', errorInfo);
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        // Limpiar timeout de error si existe
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = null;
        }
        isConnectingRef.current = false;
        setConnected(false);
        setIsConnecting(false);
        
        // Solo establecer error si no estamos conectados (evitar parpadeo durante conexión activa)
        if (ws.readyState === WebSocket.CLOSED) {
          setError('No se pudo conectar al servidor. Verifica que el servidor esté ejecutándose y la URL sea correcta.');
        } else {
          // Solo mostrar error si no estábamos conectados
          setError((prevError) => {
            // Solo actualizar si no hay un error más específico ya establecido
            if (!prevError || prevError.includes('Error de conexión WebSocket')) {
              return 'Error de conexión WebSocket';
            }
            return prevError;
          });
        }
      };

      ws.onclose = (event) => {
        console.log('Conexión cerrada', event.code, event.reason);
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        // Limpiar timeout de error si existe
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = null;
        }
        isConnectingRef.current = false;
        setConnected(false);
        setIsConnecting(false);
        hasReceivedValidDataRef.current = false;
        validMessageCountRef.current = 0;

        // Solo mostrar error si no fue un cierre intencional
        if (event.code !== 1000 && event.code !== 1001) {
          if (event.code === 1006) {
            setError('Conexión cerrada inesperadamente. El servidor puede no estar disponible.');
          } else if (event.code === 1002) {
            setError('Error de protocolo WebSocket');
          } else if (event.code === 1003) {
            setError('Tipo de dato no soportado');
          } else if (event.code === 1005) {
            setError('No se pudo establecer la conexión');
          } else {
            setError(`Conexión cerrada (código: ${event.code})`);
          }
        } else {
          // Si fue un cierre intencional, limpiar el error
          setError(null);
        }

        // Reconexión automática con backoff exponencial (solo si no fue cierre manual)
        if (event.code !== 1000) {
          // Solo reconectar si no hay una conexión activa o en proceso
          if (!isConnectingRef.current && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectDelayRef.current = Math.min(
                reconnectDelayRef.current * 2,
                30000
              ); // Max 30 segundos
              connect();
            }, reconnectDelayRef.current);
          }
        }
      };
    } catch (err) {
      console.error('Error creando WebSocket:', err);
      isConnectingRef.current = false;
      setConnected(false);
      setIsConnecting(false);
      setError(`Error al crear conexión WebSocket: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    }
  }, [serverUrl]);

  // Efecto para conectar al montar o cuando cambia serverUrl
  useEffect(() => {
    // Solo conectar si no hay una conexión activa
    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      connect();
    }

    // Cleanup
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Component unmounting');
        } catch (e) {
          // Ignorar errores al cerrar
        }
        wsRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, [connect]);

  const handleCapture = () => {
    if (!lastFrameRef.current) return;
    
    const currentData = { ...lastFrameRef.current };
    
    if (foot === 'izquierdo') {
      setCapturedLeft(currentData);
      // Cambiar automáticamente al pie derecho
      setFoot('derecho');
    } else {
      setCapturedRight(currentData);
      // Mostrar pantalla de confirmación
      setShowConfirmation(true);
    }
  };

  const handleRetake = (footToRetake: 'izquierdo' | 'derecho') => {
    setShowConfirmation(false);
    setFoot(footToRetake);
    if (footToRetake === 'izquierdo') {
      setCapturedLeft(null);
    } else {
      setCapturedRight(null);
    }
  };

  const handleConfirm = () => {
    // Verificar si las zonas de interés están definidas
    const savedCalibration = localStorage.getItem('roiCalibration');
    if (!savedCalibration) {
      alert('⚠️ Las zonas de interés no están definidas. Por favor, define las áreas de interés antes de confirmar.');
      return;
    }

    // Aquí puedes agregar lógica para procesar las capturas
    console.log('Capturas confirmadas:', { left: capturedLeft, right: capturedRight });
    setShowConfirmation(false);
    // Mostrar análisis screen
    setShowAnalysis(true);
  };

  const handleNewScreening = () => {
    setShowAnalysis(false);
    setCapturedLeft(null);
    setCapturedRight(null);
    setFoot('izquierdo');
  };

  const handleReconnect = () => {
    // Cerrar conexión existente
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Reconexión manual');
      } catch (e) {
        // Ignorar errores
      }
      wsRef.current = null;
    }
    // Limpiar todos los timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
    isConnectingRef.current = false;
    reconnectDelayRef.current = 1000;
    setError(null);
    // Actualizar los refs antes de conectar
    simulationModeRef.current = simulationMode;
    footRef.current = foot;
    connect();
  };

  // Mostrar pantalla de preparación si está activa
  if (showPreparation) {
    return (
      <>
        <PreparationScreen
          onContinue={() => {
            setShowPreparation(false);
          }}
          isRecording={isRecording}
          recordingTime={recordingTime}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
        />
        <RecordingIndicator isRecording={isRecording} recordingTime={recordingTime} />
      </>
    );
  }

  // Mostrar dashboard si está activo
  if (showDashboard) {
    return (
      <DashboardScreen
        capturedLeft={capturedLeft}
        capturedRight={capturedRight}
        tempRange={tempRange}
        onBack={() => {
          setShowDashboard(false);
          setCapturedLeft(null);
          setCapturedRight(null);
          setFoot('izquierdo');
        }}
      />
    );
  }

  return (
    <div className="thermal-viewer">
      <RecordingIndicator isRecording={isRecording} recordingTime={recordingTime} />
      {/* Controles superiores sutiles */}
      <div className="top-controls">
        <div className="connection-status">
          <div className={`status-indicator ${connected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`} />
          <span>
            {connected ? 'Conectado' : isConnecting ? 'Conectando...' : 'Desconectado'}
          </span>
          {!connected && (
            <button 
              onClick={handleReconnect} 
              className="reconnect-btn"
              disabled={isConnecting}
            >
              {isConnecting ? 'Conectando...' : 'Reconectar'}
            </button>
          )}
        </div>
        
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
          </div>
        )}

        {/* Botones de simulación sutiles */}
        <div className="simulation-controls-subtle">
          <button
            onClick={() => {
              const newMode = simulationMode === 'baja_diferencia' ? 'alta_diferencia' : 'baja_diferencia';
              setSimulationMode(newMode);
            }}
            className={`simulation-toggle ${simulationMode === 'alta_diferencia' ? 'active' : ''}`}
            disabled={!connected}
            title="Modo de simulación"
          >
            {simulationMode === 'baja_diferencia' ? 'Baja Dif.' : 'Alta Dif.'}
          </button>
        </div>
      </div>

      {/* Layout principal de captura */}
      <div className="capture-layout">
        {/* Sidebar izquierdo con métricas */}
        <div className="metrics-sidebar">
          <div className="metrics-card">
            <h3 className="metrics-title">Métricas</h3>
            <div className="metrics-content">
              {/* FPS */}
              <div className="metric-item">
                <span className="metric-label">FPS</span>
                <span className="metric-value">{Math.round(stats.fps)}</span>
              </div>

              {/* Temperaturas */}
              <div className="metric-item">
                <span className="metric-label">Temp. Mínima</span>
                <span className="metric-value">{stats.min.toFixed(1)}°C</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Temp. Máxima</span>
                <span className="metric-value">{stats.max.toFixed(1)}°C</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Temp. Promedio</span>
                <span className="metric-value">{stats.avg.toFixed(1)}°C</span>
              </div>

              {/* Resolución y Protocolo */}
              <div className="metric-item">
                <span className="metric-label">Resolución</span>
                <span className="metric-value">
                  {lastFrameRef.current ? `${lastFrameRef.current.rows}×${lastFrameRef.current.cols}` : 'N/A'}
                </span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Protocolo</span>
                <div className="protocol-value">
                  <span className="protocol-icon">📡</span>
                  <span>WebSocket</span>
                </div>
              </div>
            </div>
          </div>

          {/* Estado de alineación */}
          <div className={`alignment-status ${connected && lastFrameRef.current ? 'aligned' : ''}`}>
            <div className="alignment-icon">📐</div>
            <span className="alignment-text">{connected && lastFrameRef.current ? 'Alineado' : 'Alineando...'}</span>
          </div>

          {/* Botón siguiente */}
          <button
            onClick={() => {
              if (foot === 'izquierdo') {
                handleCapture();
              } else if (foot === 'derecho' && !capturedRight) {
                handleCapture();
              } else if (capturedLeft && capturedRight) {
                setShowConfirmation(true);
              }
            }}
            className="next-foot-btn"
            disabled={!connected || !lastFrameRef.current}
          >
            {foot === 'izquierdo' 
              ? (capturedLeft ? 'Siguiente: Pie Derecho' : 'Capturar Pie Izquierdo')
              : capturedRight 
                ? 'Ver Resultados'
                : 'Capturar Pie Derecho'
            }
          </button>
        </div>

        {/* Área principal con visualizador térmico */}
        <div className="thermal-main-area">
          <div className="thermal-header">
            <h2 className="foot-title">{foot === 'izquierdo' ? 'Izquierdo' : 'Derecho'}</h2>
          </div>
          
          <div className="thermal-viewer-container">
            <div className="thermal-canvas-wrapper">
              <canvas ref={canvasRef} className="thermal-canvas-capture" />
              {/* Overlay de estado */}
              <div className="thermal-overlay">
                <div className={`alignment-badge ${connected && lastFrameRef.current ? 'aligned' : ''}`}>
                  <span>{connected && lastFrameRef.current ? 'Alineado' : 'Alineando...'}</span>
                </div>
                <div className="fps-badge">
                  <span>{Math.round(stats.fps)} FPS</span>
                </div>
              </div>
            </div>
          </div>

          {/* Leyenda de temperatura */}
          <div className="temperature-legend-card">
            <h3 className="legend-title">Leyenda de Temperatura</h3>
            <div className="temperature-legend">
              <div className="legend-gradient">
                {Array.from({ length: 100 }, (_, i) => {
                  const temp = tempRange.min + (tempRange.max - tempRange.min) * (i / 99);
                  const [r, g, b] = temperatureToColor(temp, tempRange.min, tempRange.max);
                  return (
                    <div
                      key={i}
                      className="legend-color-segment"
                      style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                    />
                  );
                })}
              </div>
              <div className="legend-labels">
                <span className="legend-label-min">{tempRange.min.toFixed(1)}°C</span>
                <span className="legend-label-max">{tempRange.max.toFixed(1)}°C</span>
              </div>
            </div>
          </div>

          {/* Instrucciones en la parte inferior */}
          <div className="instructions-section">
            <div className="instruction-card">
              <div className="instruction-icon">👣</div>
              <p className="instruction-text">Mantenga el pie quieto</p>
            </div>
            <div className="instruction-card">
              <div className="instruction-icon">📏</div>
              <p className="instruction-text">Siga las líneas guía</p>
            </div>
            <div className="instruction-card">
              <div className="instruction-icon">⏱️</div>
              <p className="instruction-text">Espere la confirmación</p>
            </div>
          </div>
        </div>
      </div>

      {showConfirmation && (
        <>
          <RecordingIndicator isRecording={isRecording} recordingTime={recordingTime} />
          {(() => {
        // Calcular estadísticas para cada pie
        const getFootStats = (data: ThermalData | null) => {
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

        const leftStats = getFootStats(capturedLeft);
        const rightStats = getFootStats(capturedRight);
        const avgDiff = leftStats && rightStats ? rightStats.avg - leftStats.avg : null;
        const diffLevel = avgDiff !== null 
          ? Math.abs(avgDiff) < 1 ? 'normal' 
          : Math.abs(avgDiff) < 2 ? 'moderada' 
          : 'alta'
          : null;

        return (
          <div className="confirmation-overlay">
            <div className="confirmation-modal-new">
              {/* Header */}
              <div className="confirmation-header-new">
                <div className="confirmation-header-text">
                  <h2>Resumen</h2>
                  <p>Revise las imágenes térmicas antes de continuar con el análisis</p>
                </div>
              </div>

              {/* Main content - Two cards side by side */}
              <div className="confirmation-cards-container">
                {/* Right foot card (shown on left) */}
                <div className="confirmation-foot-card">
                  <div className="confirmation-foot-header">
                    <div>
                      <h3>Derecho</h3>
                      <p className="capture-status-text">Captura completada</p>
                    </div>
                    <div className="foot-icon">👣</div>
                  </div>
                  <div className="confirmation-thermal-image-container">
                    {capturedRight && (
                      <>
                        <CapturedCanvas data={capturedRight} tempRange={tempRange} footSide="derecho" />
                        {rightStats && (
                          <div className="thermal-avg-badge">
                            {rightStats.avg.toFixed(1)}°C avg
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {rightStats && (
                    <div className="confirmation-stats">
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Min</span>
                        <span className="stat-value">{rightStats.min.toFixed(1)}°C</span>
                      </div>
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Avg</span>
                        <span className="stat-value stat-avg">{rightStats.avg.toFixed(1)}°C</span>
                      </div>
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Max</span>
                        <span className="stat-value">{rightStats.max.toFixed(1)}°C</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Left foot card (shown on right) */}
                <div className="confirmation-foot-card">
                  <div className="confirmation-foot-header">
                    <div>
                      <h3>Izquierdo</h3>
                      <p className="capture-status-text">Captura completada</p>
                    </div>
                    <div className="foot-icon">👣</div>
                  </div>
                  <div className="confirmation-thermal-image-container">
                    {capturedLeft && (
                      <>
                        <CapturedCanvas data={capturedLeft} tempRange={tempRange} footSide="izquierdo" />
                        {leftStats && (
                          <div className="thermal-avg-badge">
                            {leftStats.avg.toFixed(1)}°C avg
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {leftStats && (
                    <div className="confirmation-stats">
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Min</span>
                        <span className="stat-value">{leftStats.min.toFixed(1)}°C</span>
                      </div>
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Avg</span>
                        <span className="stat-value stat-avg">{leftStats.avg.toFixed(1)}°C</span>
                      </div>
                      <div className="confirmation-stat-item">
                        <span className="stat-label">Max</span>
                        <span className="stat-value">{leftStats.max.toFixed(1)}°C</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Single settings button for ROI calibration */}
              <div className="confirmation-settings-container">
                <button 
                  onClick={() => {
                    setShowCalibration(true);
                    setCalibrationFoot('derecho');
                  }}
                  className="confirmation-settings-btn-single"
                  title="Definir áreas de interés"
                >
                  ⚙️ Áreas de Interés
                </button>
              </div>

              {/* Difference section */}
              {avgDiff !== null && (
                <div className="confirmation-difference-section">
                  <div className="difference-info">
                    <div className="difference-icon">→</div>
                    <div>
                      <p className="difference-label">Diferencia de temperatura promedio</p>
                      <p className={`difference-value ${diffLevel === 'alta' ? 'high' : diffLevel === 'moderada' ? 'moderate' : ''}`}>
                        {avgDiff > 0 ? '+' : ''}{avgDiff.toFixed(1)}°C
                      </p>
                    </div>
                  </div>
                  {diffLevel && (
                    <div className={`difference-badge ${diffLevel}`}>
                      {diffLevel === 'alta' ? 'Diferencia alta detectada' : 
                       diffLevel === 'moderada' ? 'Diferencia moderada detectada' : 
                       'Diferencia normal'}
                    </div>
                  )}
                </div>
              )}

              {/* Action button */}
              <div className="confirmation-actions-new">
                <button onClick={handleConfirm} className="confirmation-continue-btn">
                  <span>Analizar y Continuar</span>
                  <span className="arrow-icon">→</span>
                </button>
              </div>
            </div>
          </div>
        );
          })()}
        </>
      )}

      {showCalibration && calibrationFoot && (
        <div className="calibration-overlay">
          <div className="calibration-modal">
            {calibrationFoot === 'derecho' && capturedRight && (
              <ROICalibrationCanvas
                data={capturedRight}
                tempRange={tempRange}
                footSide="derecho"
                onCalibrationComplete={(calibration) => {
                  console.log('Calibración guardada:', calibration);
                  setShowCalibration(false);
                  setCalibrationFoot(null);
                  // Opcional: mostrar mensaje de éxito
                  alert('Calibración guardada exitosamente. Las áreas de interés se aplicarán automáticamente a futuras capturas.');
                }}
                onCancel={() => {
                  setShowCalibration(false);
                  setCalibrationFoot(null);
                }}
              />
            )}
            {calibrationFoot === 'izquierdo' && capturedLeft && (
              <ROICalibrationCanvas
                data={capturedLeft}
                tempRange={tempRange}
                footSide="izquierdo"
                onCalibrationComplete={(calibration) => {
                  console.log('Calibración guardada:', calibration);
                  setShowCalibration(false);
                  setCalibrationFoot(null);
                  alert('Calibración guardada exitosamente. Las áreas de interés se aplicarán automáticamente a futuras capturas.');
                }}
                onCancel={() => {
                  setShowCalibration(false);
                  setCalibrationFoot(null);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Overlay de conexión */}
      {!connected && !isConnecting && (
        <div className="canvas-overlay">
          {error ? (
            <div className="error-overlay">
              <p className="error-title">No hay conexión</p>
              <p className="error-detail">{error}</p>
              <button onClick={handleReconnect} className="retry-btn">
                Intentar de nuevo
              </button>
            </div>
          ) : (
            <p>Esperando conexión al servidor...</p>
          )}
        </div>
      )}
      {!connected && isConnecting && (
        <div className="canvas-overlay">
          <div className="connecting-message">
            <div className="spinner"></div>
            <p>Conectando al servidor...</p>
          </div>
        </div>
      )}

      {/* Analysis Screen */}
      {showAnalysis && (
        <AnalysisScreen
          capturedLeft={capturedLeft}
          capturedRight={capturedRight}
          tempRange={tempRange}
          onBack={() => setShowAnalysis(false)}
          onNewScreening={handleNewScreening}
          isRecording={isRecording}
          recordingTime={recordingTime}
          recordingBlob={recordingBlob}
          onStopRecording={stopRecording}
        />
      )}
    </div>
  );
}

