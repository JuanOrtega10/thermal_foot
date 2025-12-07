'use client';

import { useEffect, useRef } from 'react';
import { 
  temperatureToColor, 
  segmentFootKMeans,
  applyROICalibration,
  getROIStats,
  type ThermalData
} from '@/lib/utils';

interface DashboardScreenProps {
  capturedLeft: ThermalData | null;
  capturedRight: ThermalData | null;
  tempRange: { min: number; max: number };
  onBack: () => void;
}

function FootAnalysisCanvas({ 
  data, 
  tempRange, 
  footSide 
}: { 
  data: ThermalData; 
  tempRange: { min: number; max: number };
  footSide: 'izquierdo' | 'derecho';
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { rows, cols, data: frameData } = data;
    const frame = new Float32Array(frameData);
    const footMask = segmentFootKMeans(frameData, rows, cols);
    const rois = applyROICalibration(footMask, rows, cols, footSide);

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

        ctx.fillStyle = isFoot ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, 0.15)`;
        ctx.fillRect(x, y, pixelSize - borderWidth, pixelSize - borderWidth);
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

  return <canvas ref={canvasRef} className="dashboard-foot-canvas" />;
}

export default function DashboardScreen({ 
  capturedLeft, 
  capturedRight, 
  tempRange,
  onBack 
}: DashboardScreenProps) {
  // Calcular estadísticas para cada ROI
  const getFootStats = (data: ThermalData | null, footSide: 'izquierdo' | 'derecho') => {
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

  const calculateDifference = (left: number | null, right: number | null): number | null => {
    if (left === null || right === null) return null;
    return Math.round((right - left) * 10) / 10;
  };

  return (
    <div className="dashboard-screen">
      <div className="dashboard-header">
        <h1>Análisis Térmico de Pies</h1>
        <button onClick={onBack} className="dashboard-back-btn">
          ← Volver
        </button>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-feet-container">
          {/* Pie Derecho */}
          <div className="dashboard-foot-section">
            <h2>Pie Derecho</h2>
            {capturedRight ? (
              <>
                <FootAnalysisCanvas 
                  data={capturedRight} 
                  tempRange={tempRange} 
                  footSide="derecho" 
                />
                {rightStats && (
                  <div className="roi-stats">
                    <div className="roi-stat-item">
                      <span className="roi-label hallux">Hallux:</span>
                      <span className="roi-value">
                        {rightStats.hallux ? `${rightStats.hallux.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="roi-stat-item">
                      <span className="roi-label metatarsal">1er Metatarsiano:</span>
                      <span className="roi-value">
                        {rightStats.firstMetatarsal ? `${rightStats.firstMetatarsal.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="roi-stat-item">
                      <span className="roi-label heel">Talón:</span>
                      <span className="roi-value">
                        {rightStats.heel ? `${rightStats.heel.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p>No hay captura disponible</p>
            )}
          </div>

          {/* Pie Izquierdo */}
          <div className="dashboard-foot-section">
            <h2>Pie Izquierdo</h2>
            {capturedLeft ? (
              <>
                <FootAnalysisCanvas 
                  data={capturedLeft} 
                  tempRange={tempRange} 
                  footSide="izquierdo" 
                />
                {leftStats && (
                  <div className="roi-stats">
                    <div className="roi-stat-item">
                      <span className="roi-label hallux">Hallux:</span>
                      <span className="roi-value">
                        {leftStats.hallux ? `${leftStats.hallux.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="roi-stat-item">
                      <span className="roi-label metatarsal">1er Metatarsiano:</span>
                      <span className="roi-value">
                        {leftStats.firstMetatarsal ? `${leftStats.firstMetatarsal.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                    <div className="roi-stat-item">
                      <span className="roi-label heel">Talón:</span>
                      <span className="roi-value">
                        {leftStats.heel ? `${leftStats.heel.avg.toFixed(1)}°C` : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p>No hay captura disponible</p>
            )}
          </div>
        </div>

        {/* Tabla de Comparación */}
        <div className="comparison-table-container">
          <h2>Comparación Térmica</h2>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Zona</th>
                <th>Pie Izquierdo</th>
                <th>Pie Derecho</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="roi-name hallux">Hallux</td>
                <td>{leftStats?.hallux ? `${leftStats.hallux.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td>{rightStats?.hallux ? `${rightStats.hallux.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td className={calculateDifference(leftStats?.hallux?.avg || null, rightStats?.hallux?.avg || null) !== null ? (Math.abs(calculateDifference(leftStats?.hallux?.avg || null, rightStats?.hallux?.avg || null) || 0) > 2 ? 'diff-high' : 'diff-normal') : ''}>
                  {calculateDifference(leftStats?.hallux?.avg || null, rightStats?.hallux?.avg || null) !== null 
                    ? `${calculateDifference(leftStats?.hallux?.avg || null, rightStats?.hallux?.avg || null)?.toFixed(1)}°C`
                    : 'N/A'}
                </td>
              </tr>
              <tr>
                <td className="roi-name metatarsal">1er Metatarsiano</td>
                <td>{leftStats?.firstMetatarsal ? `${leftStats.firstMetatarsal.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td>{rightStats?.firstMetatarsal ? `${rightStats.firstMetatarsal.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td className={calculateDifference(leftStats?.firstMetatarsal?.avg || null, rightStats?.firstMetatarsal?.avg || null) !== null ? (Math.abs(calculateDifference(leftStats?.firstMetatarsal?.avg || null, rightStats?.firstMetatarsal?.avg || null) || 0) > 2 ? 'diff-high' : 'diff-normal') : ''}>
                  {calculateDifference(leftStats?.firstMetatarsal?.avg || null, rightStats?.firstMetatarsal?.avg || null) !== null 
                    ? `${calculateDifference(leftStats?.firstMetatarsal?.avg || null, rightStats?.firstMetatarsal?.avg || null)?.toFixed(1)}°C`
                    : 'N/A'}
                </td>
              </tr>
              <tr>
                <td className="roi-name heel">Talón</td>
                <td>{leftStats?.heel ? `${leftStats.heel.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td>{rightStats?.heel ? `${rightStats.heel.avg.toFixed(1)}°C` : 'N/A'}</td>
                <td className={calculateDifference(leftStats?.heel?.avg || null, rightStats?.heel?.avg || null) !== null ? (Math.abs(calculateDifference(leftStats?.heel?.avg || null, rightStats?.heel?.avg || null) || 0) > 2 ? 'diff-high' : 'diff-normal') : ''}>
                  {calculateDifference(leftStats?.heel?.avg || null, rightStats?.heel?.avg || null) !== null 
                    ? `${calculateDifference(leftStats?.heel?.avg || null, rightStats?.heel?.avg || null)?.toFixed(1)}°C`
                    : 'N/A'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

