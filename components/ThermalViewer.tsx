'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { temperatureToColor, calculateStats, segmentFootKMeans } from '@/lib/utils';

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

// Componente para renderizar una captura
function CapturedCanvas({ data, tempRange }: { data: ThermalData; tempRange: { min: number; max: number } }) {
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

    const pixelSize = 16;
    const borderWidth = 1;
    canvas.width = cols * pixelSize;
    canvas.height = rows * pixelSize;

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
  }, [data, tempRange]);

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

    // Dimensiones del canvas - píxeles más grandes para mejor estética
    const pixelSize = 16; // 16px por píxel del sensor
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
    // Aquí puedes agregar lógica para procesar las capturas
    console.log('Capturas confirmadas:', { left: capturedLeft, right: capturedRight });
    setShowConfirmation(false);
    // Resetear capturas
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

  return (
    <div className="thermal-viewer">
      <div className="controls">
        <div className="connection-status">
          <div className={`status-indicator ${connected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`} />
          <span>
            {connected ? 'Conectado' : isConnecting ? 'Conectando...' : 'Desconectado'}
          </span>
          <button 
            onClick={handleReconnect} 
            className="reconnect-btn"
            disabled={isConnecting}
          >
            {isConnecting ? 'Conectando...' : 'Reconectar'}
          </button>
        </div>
        
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
          </div>
        )}

        <div className="server-config">
          <label>
            URL del servidor:
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={connected}
              className="server-input"
            />
          </label>
        </div>

        <div className="simulation-controls">
          <div className="simulation-mode">
            <label>
              Modo de simulación:
              <select
                value={simulationMode}
                onChange={(e) => {
                  const newMode = e.target.value as 'baja_diferencia' | 'alta_diferencia';
                  setSimulationMode(newMode);
                }}
                className="mode-select"
                disabled={!connected}
              >
                <option value="baja_diferencia">Baja Diferencia de Temperatura</option>
                <option value="alta_diferencia">Alta Diferencia de Temperatura</option>
              </select>
            </label>
          </div>

          <div className="foot-selector">
            <label>
              Pie a visualizar:
              <select
                value={foot}
                onChange={(e) => {
                  const newFoot = e.target.value as 'izquierdo' | 'derecho';
                  setFoot(newFoot);
                }}
                className="foot-select"
                disabled={!connected}
              >
                <option value="izquierdo">Pie Izquierdo</option>
                <option value="derecho">Pie Derecho</option>
              </select>
            </label>
          </div>
        </div>

        <div className="temp-range">
          <label>
            Temp. mínima:
            <input
              type="number"
              step="0.1"
              value={tempRange.min}
              onChange={(e) =>
                setTempRange({ ...tempRange, min: parseFloat(e.target.value) })
              }
              className="temp-input"
            />
            °C
          </label>
          <label>
            Temp. máxima:
            <input
              type="number"
              step="0.1"
              value={tempRange.max}
              onChange={(e) =>
                setTempRange({ ...tempRange, max: parseFloat(e.target.value) })
              }
              className="temp-input"
            />
            °C
          </label>
        </div>

        <div className="capture-controls">
          <button
            onClick={handleCapture}
            className="capture-btn"
            disabled={!connected || !lastFrameRef.current}
          >
            {foot === 'izquierdo' 
              ? (capturedLeft ? '📸 Recapturar Pie Izquierdo' : '📸 Capturar Pie Izquierdo')
              : (capturedRight ? '📸 Recapturar Pie Derecho' : '📸 Capturar Pie Derecho')
            }
          </button>
          {capturedLeft && (
            <span className="capture-status">✓ Pie Izquierdo capturado</span>
          )}
          {capturedRight && (
            <span className="capture-status">✓ Pie Derecho capturado</span>
          )}
        </div>
      </div>

      {showConfirmation && (
        <div className="confirmation-overlay">
          <div className="confirmation-modal">
            <h2>Confirmar Capturas</h2>
            <p>Revisa las capturas y elige una opción:</p>
            <div className="capture-preview-container">
              <div className="capture-preview">
                <h3>Pie Derecho</h3>
                {capturedRight && <CapturedCanvas data={capturedRight} tempRange={tempRange} />}
                <button 
                  onClick={() => handleRetake('derecho')}
                  className="retake-btn"
                >
                  Retomar Derecho
                </button>
              </div>
              <div className="capture-preview">
                <h3>Pie Izquierdo</h3>
                {capturedLeft && <CapturedCanvas data={capturedLeft} tempRange={tempRange} />}
                <button 
                  onClick={() => handleRetake('izquierdo')}
                  className="retake-btn"
                >
                  Retomar Izquierdo
                </button>
              </div>
            </div>
            <div className="confirmation-actions">
              <button onClick={handleConfirm} className="confirm-btn">
                Confirmar
              </button>
              <button 
                onClick={() => {
                  setShowConfirmation(false);
                  setCapturedLeft(null);
                  setCapturedRight(null);
                  setFoot('izquierdo');
                }} 
                className="cancel-btn"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="canvas-container">
        <canvas ref={canvasRef} className="thermal-canvas" />
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
      </div>

      <div className="stats">
        <div className="stat-item">
          <span className="stat-label">FPS:</span>
          <span className="stat-value">{stats.fps}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Temp. mín:</span>
          <span className="stat-value">{stats.min}°C</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Temp. máx:</span>
          <span className="stat-value">{stats.max}°C</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Temp. promedio:</span>
          <span className="stat-value">{stats.avg}°C</span>
        </div>
        {lastFrameRef.current && (
          <div className="stat-item">
            <span className="stat-label">Dimensiones:</span>
            <span className="stat-value">
              {lastFrameRef.current.rows} × {lastFrameRef.current.cols}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

