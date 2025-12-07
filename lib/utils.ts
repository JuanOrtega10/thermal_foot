/**
 * Tipo de datos térmicos
 */
export interface ThermalData {
  rows: number;
  cols: number;
  data: number[];
}

/**
 * Convierte un valor de temperatura a color RGB usando un colormap tipo "inferno"
 * (azul oscuro → púrpura → rojo → amarillo)
 */
export function temperatureToColor(
  temp: number,
  vmin: number = 28.0,
  vmax: number = 38.0
): [number, number, number] {
  // Normalizar temperatura al rango [0, 1]
  const normalized = Math.max(0, Math.min(1, (temp - vmin) / (vmax - vmin)));

  // Colormap "inferno" aproximado
  // Basado en matplotlib colormap inferno
  let r: number, g: number, b: number;

  if (normalized < 0.25) {
    // Azul oscuro → púrpura
    const t = normalized / 0.25;
    r = Math.floor(4 * t * 20);
    g = 0;
    b = Math.floor(140 + 115 * t);
  } else if (normalized < 0.5) {
    // Púrpura → rojo oscuro
    const t = (normalized - 0.25) / 0.25;
    r = Math.floor(20 + 235 * t);
    g = 0;
    b = Math.floor(255 - 255 * t);
  } else if (normalized < 0.75) {
    // Rojo → naranja
    const t = (normalized - 0.5) / 0.25;
    r = 255;
    g = Math.floor(50 * t * t);
    b = 0;
  } else {
    // Naranja → amarillo
    const t = (normalized - 0.75) / 0.25;
    r = 255;
    g = Math.floor(50 + 205 * t);
    b = Math.floor(50 * t);
  }

  return [r, g, b];
}

/**
 * Calcula estadísticas de un frame térmico
 */
export function calculateStats(data: number[]): {
  min: number;
  max: number;
  avg: number;
} {
  if (data.length === 0) {
    return { min: 0, max: 0, avg: 0 };
  }

  let min = data[0];
  let max = data[0];
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    if (val < min) min = val;
    if (val > max) max = val;
    sum += val;
  }

  return {
    min,
    max,
    avg: sum / data.length,
  };
}

/**
 * Limpia la máscara eliminando píxeles aislados (post-procesamiento)
 */
function cleanMaskKMeans(
  mask: boolean[],
  rows: number,
  cols: number,
  minNeighbors: number = 2
): boolean[] {
  const cleaned = [...mask];
  
  // Eliminar píxeles del pie que tienen muy pocos vecinos del pie
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const idx = row * cols + col;
      if (!mask[idx]) continue; // Solo procesar píxeles del pie
      
      // Contar vecinos del pie (8-vecindad)
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nIdx = (row + dr) * cols + (col + dc);
          if (mask[nIdx]) neighbors++;
        }
      }
      
      // Si tiene muy pocos vecinos, probablemente es ruido
      if (neighbors < minNeighbors) {
        cleaned[idx] = false;
      }
    }
  }
  
  return cleaned;
}

/**
 * Segmenta el pie del fondo usando K-means clustering mejorado (K=2)
 * Usa información espacial y umbrales de temperatura para evitar que segmentos del pie
 * sean clasificados como fondo.
 * @param data Array de temperaturas
 * @param rows Número de filas
 * @param cols Número de columnas
 * @param maxIterations Número máximo de iteraciones (default: 20)
 * @returns Máscara booleana donde true = pie (cluster más caliente), false = fondo
 */
export function segmentFootKMeans(
  data: number[],
  rows: number,
  cols: number,
  maxIterations: number = 20
): boolean[] {
  const frame = new Float32Array(data);
  const n = frame.length;
  
  if (n === 0) return [];
  
  // Paso 1: Identificar fondo usando SOLO píxeles del borde
  // El fondo en los bordes es consistente independientemente del modo de simulación
  const edgeThreshold = 2; // Píxeles desde el borde considerados "borde"
  const edgeTemps: number[] = [];
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isEdge = row < edgeThreshold || row >= rows - edgeThreshold ||
                     col < edgeThreshold || col >= cols - edgeThreshold;
      if (isEdge) {
        const idx = row * cols + col;
        edgeTemps.push(frame[idx]);
      }
    }
  }
  
  // Calcular estadísticas del fondo basadas SOLO en los bordes
  edgeTemps.sort((a, b) => a - b);
  const edgeMin = edgeTemps[0];
  const edgeMax = edgeTemps[edgeTemps.length - 1];
  const edgeMedian = edgeTemps[Math.floor(edgeTemps.length / 2)];
  const edgeP10 = edgeTemps[Math.floor(edgeTemps.length * 0.10)];
  
  // Umbral de fondo basado en los bordes (más robusto)
  const backgroundThreshold = edgeP10 + (edgeMedian - edgeP10) * 0.5;
  
  // Identificar píxeles que definitivamente son fondo
  const definitelyBackground = new Array<boolean>(n).fill(false);
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const temp = frame[idx];
      const isEdge = row < edgeThreshold || row >= rows - edgeThreshold ||
                     col < edgeThreshold || col >= cols - edgeThreshold;
      
      // Si está en el borde Y es frío según umbral de borde, es definitivamente fondo
      if (isEdge && temp <= backgroundThreshold) {
        definitelyBackground[idx] = true;
      }
    }
  }
  
  // Paso 2: Calcular centroides iniciales
  // Fondo: usar solo píxeles definitivamente fondo
  // Pie: usar píxeles que están claramente por encima del umbral de fondo
  let sumCold = 0, countCold = 0;
  let sumHot = 0, countHot = 0;
  
  // Umbral para pie: al menos 2°C más caliente que el umbral de fondo
  const footThreshold = backgroundThreshold + 2.0;
  
  for (let i = 0; i < n; i++) {
    if (definitelyBackground[i]) {
      sumCold += frame[i];
      countCold++;
    } else if (frame[i] >= footThreshold) {
      sumHot += frame[i];
      countHot++;
    }
  }
  
  // Centroides iniciales basados en bordes (más robustos)
  let centroidCold = countCold > 0 ? sumCold / countCold : edgeMedian;
  let centroidHot = countHot > 0 ? sumHot / countHot : footThreshold;
  
  // Si los centroides están muy cerca, ajustar para asegurar separación
  if (Math.abs(centroidHot - centroidCold) < 1.5) {
    centroidCold = edgeMedian;
    centroidHot = edgeMedian + 3.0; // Asegurar separación mínima de 3°C
  }
  
  // Paso 3: K-means iterativo con pesos espaciales
  let assignments = new Array<number>(n);
  
  // Inicializar: forzar píxeles definitivamente fondo al cluster frío
  for (let i = 0; i < n; i++) {
    if (definitelyBackground[i]) {
      assignments[i] = 0; // Cluster frío (fondo)
    } else {
      // Inicializar basado en temperatura
      assignments[i] = frame[i] >= (centroidCold + centroidHot) / 2 ? 1 : 0;
    }
  }
  
  let changed = true;
  let iterations = 0;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    
    // Asignar cada píxel al centroide más cercano
    // Pero con peso espacial: píxeles en bordes tienen más probabilidad de ser fondo
    for (let i = 0; i < n; i++) {
      // No cambiar píxeles definitivamente fondo
      if (definitelyBackground[i]) continue;
      
      const row = Math.floor(i / cols);
      const col = i % cols;
      const temp = frame[i];
      
      // Calcular distancia con peso espacial
      const isEdge = row < edgeThreshold || row >= rows - edgeThreshold ||
                        col < edgeThreshold || col >= cols - edgeThreshold;
      
      // Peso espacial: píxeles en bordes tienen sesgo hacia fondo
      const spatialBias = isEdge ? 0.5 : 0; // Sesgo de 0.5°C hacia fondo en bordes
      
      const distToCold = Math.abs(temp - centroidCold) - spatialBias;
      const distToHot = Math.abs(temp - centroidHot);
      
      const newAssignment = distToCold < distToHot ? 0 : 1;
      
      if (assignments[i] !== newAssignment) {
        changed = true;
        assignments[i] = newAssignment;
      }
    }
    
    // Recalcular centroides (promedio de temperaturas en cada cluster)
    sumCold = 0;
    countCold = 0;
    sumHot = 0;
    countHot = 0;
    
    for (let i = 0; i < n; i++) {
      if (assignments[i] === 0) {
        sumCold += frame[i];
        countCold++;
      } else {
        sumHot += frame[i];
        countHot++;
      }
    }
    
    // Actualizar centroides solo si hay píxeles en cada cluster
    if (countCold > 0) {
      centroidCold = sumCold / countCold;
    }
    if (countHot > 0) {
      centroidHot = sumHot / countHot;
    }
    
    iterations++;
  }
  
  // Paso 4: Determinar cuál cluster es el pie (el más caliente)
  const footCluster = centroidHot > centroidCold ? 1 : 0;
  
  // Crear máscara: true = pie, false = fondo
  const mask = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    mask[i] = assignments[i] === footCluster;
  }
  
  // Paso 5: Post-procesamiento mejorado
  // Identificar la región más grande conectada como el pie
  const cleaned = cleanMaskKMeans(mask, rows, cols);
  
  // Encontrar la componente conectada más grande (debería ser el pie)
  const visited = new Array<boolean>(n).fill(false);
  const components: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    if (cleaned[i] && !visited[i]) {
      const component: number[] = [];
      const stack = [i];
      
      while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx] || !cleaned[idx]) continue;
        
        visited[idx] = true;
        component.push(idx);
        
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        
        // Vecinos 4-conectados
        const neighbors = [
          [row - 1, col],
          [row + 1, col],
          [row, col - 1],
          [row, col + 1],
        ];
        
        for (const [nr, nc] of neighbors) {
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const nIdx = nr * cols + nc;
            if (cleaned[nIdx] && !visited[nIdx]) {
              stack.push(nIdx);
            }
          }
        }
      }
      
      if (component.length > 0) {
        components.push(component);
      }
    }
  }
  
  // Si hay múltiples componentes, mantener solo la más grande (el pie)
  if (components.length > 1) {
    components.sort((a, b) => b.length - a.length);
    const largestComponent = components[0];
    const largestComponentSet = new Set(largestComponent);
    
    // Crear máscara final solo con la componente más grande
    const finalMask = new Array<boolean>(n).fill(false);
    for (const idx of largestComponent) {
      finalMask[idx] = true;
    }
    
    return finalMask;
  }
  
  return cleaned;
}

// ==================== ROI Calibration System ====================

export interface NormalizedROI {
  // Coordenadas normalizadas relativas al bounding box (0-1)
  minRowNorm: number;  // 0 = top del bounding box, 1 = bottom
  maxRowNorm: number;
  minColNorm: number;  // 0 = left del bounding box, 1 = right
  maxColNorm: number;
}

export interface ROICalibration {
  hallux: NormalizedROI;
  firstMetatarsal: NormalizedROI;
  heel: NormalizedROI;
  // Metadata de la calibración
  calibratedOn: {
    footSide: 'izquierdo' | 'derecho';
    footHeight: number;
    footWidth: number;
  };
}

export interface ROISelection {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export interface FootROIs {
  hallux: boolean[];           // Máscara para hallux
  firstMetatarsal: boolean[]; // Máscara para primer metatarsiano
  heel: boolean[];            // Máscara para talón
  boundingBox: {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  };
}

/**
 * Encuentra píxeles conectados (con al menos un vecino)
 */
function getConnectedPixels(
  footMask: boolean[],
  rows: number,
  cols: number
): boolean[] {
  const connected = new Array<boolean>(rows * cols).fill(false);

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const idx = row * cols + col;
      if (!footMask[idx]) continue;

      // Verificar si tiene al menos un vecino (4-vecindad)
      let hasNeighbor = false;
      for (let dr = -1; dr <= 1; dr += 2) {
        const nIdx = (row + dr) * cols + col;
        if (footMask[nIdx]) {
          hasNeighbor = true;
          break;
        }
      }
      if (!hasNeighbor) {
        for (let dc = -1; dc <= 1; dc += 2) {
          const nIdx = row * cols + (col + dc);
          if (footMask[nIdx]) {
            hasNeighbor = true;
            break;
          }
        }
      }

      if (hasNeighbor) {
        connected[idx] = true;
      }
    }
  }

  // También incluir píxeles del borde si están conectados
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (footMask[idx] && !connected[idx]) {
        // Verificar si tiene vecino en el borde
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nRow = row + dr;
            const nCol = col + dc;
            if (nRow >= 0 && nRow < rows && nCol >= 0 && nCol < cols) {
              const nIdx = nRow * cols + nCol;
              if (footMask[nIdx] && (connected[nIdx] || (nRow > 0 && nRow < rows - 1 && nCol > 0 && nCol < cols - 1))) {
                connected[idx] = true;
                break;
              }
            }
          }
          if (connected[idx]) break;
        }
      }
    }
  }

  return connected;
}

/**
 * Calcula el bounding box del pie segmentado mejorado
 * Identifica los puntos extremos reales del pie (dedos y talón)
 */
export function getFootBoundingBox(
  footMask: boolean[],
  rows: number,
  cols: number
): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  // Primero, obtener solo píxeles conectados (eliminar ruido aislado)
  const connectedMask = getConnectedPixels(footMask, rows, cols);

  // Encontrar el punto más alto (dedos/hallux) - minRow
  // Buscar desde arriba hacia abajo, encontrar la primera fila con píxeles significativos
  let minRow = rows;
  for (let row = 0; row < rows; row++) {
    let pixelCount = 0;
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (connectedMask[idx]) {
        pixelCount++;
      }
    }
    // Si hay al menos 2 píxeles conectados en esta fila, es parte del pie
    if (pixelCount >= 2) {
      minRow = row;
      break;
    }
  }

  // Encontrar el punto más bajo (talón) - maxRow
  // Buscar desde abajo hacia arriba
  let maxRow = -1;
  for (let row = rows - 1; row >= 0; row--) {
    let pixelCount = 0;
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (connectedMask[idx]) {
        pixelCount++;
      }
    }
    // Si hay al menos 2 píxeles conectados en esta fila, es parte del pie
    if (pixelCount >= 2) {
      maxRow = row;
      break;
    }
  }

  // Encontrar los puntos más a la izquierda y derecha
  // Usar solo las filas que están en el rango del pie
  let minCol = cols;
  let maxCol = -1;

  if (minRow <= maxRow) {
    // Para cada columna, verificar si tiene píxeles en el rango del pie
    for (let col = 0; col < cols; col++) {
      let hasPixel = false;
      for (let row = minRow; row <= maxRow; row++) {
        const idx = row * cols + col;
        if (connectedMask[idx]) {
          hasPixel = true;
          break;
        }
      }
      if (hasPixel) {
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }
    }
  }

  // Fallback: si no encontramos nada con el método mejorado, usar el método simple
  if (minRow >= rows || maxRow < 0 || minCol >= cols || maxCol < 0) {
    // Método simple como fallback
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (footMask[idx]) {
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
          if (col < minCol) minCol = col;
          if (col > maxCol) maxCol = col;
        }
      }
    }
  }

  if (minRow >= rows || maxRow < 0 || minCol >= cols || maxCol < 0) {
    return null;
  }

  return { minRow, maxRow, minCol, maxCol };
}

/**
 * Calcula el centro de masa del pie
 */
export function getFootCenterOfMass(
  footMask: boolean[],
  rows: number,
  cols: number
): { row: number; col: number } | null {
  let sumRow = 0, sumCol = 0, count = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (footMask[idx]) {
        sumRow += row;
        sumCol += col;
        count++;
      }
    }
  }

  if (count === 0) return null;
  return { row: sumRow / count, col: sumCol / count };
}

/**
 * Normaliza coordenadas de píxeles a coordenadas relativas (0-1)
 */
export function normalizeCoordinates(
  pixelCoords: ROISelection,
  bbox: { minRow: number; maxRow: number; minCol: number; maxCol: number }
): NormalizedROI {
  const footHeight = bbox.maxRow - bbox.minRow + 1;
  const footWidth = bbox.maxCol - bbox.minCol + 1;

  return {
    // Normalizar al bounding box (0-1)
    minRowNorm: (pixelCoords.minRow - bbox.minRow) / footHeight,
    maxRowNorm: (pixelCoords.maxRow - bbox.minRow) / footHeight,
    minColNorm: (pixelCoords.minCol - bbox.minCol) / footWidth,
    maxColNorm: (pixelCoords.maxCol - bbox.minCol) / footWidth,
  };
}

/**
 * Desnormaliza coordenadas relativas a píxeles absolutos
 * @param invertHorizontal Si es true, invierte las coordenadas horizontalmente (eje X)
 */
export function denormalizeCoordinates(
  normalizedROI: NormalizedROI,
  bbox: { minRow: number; maxRow: number; minCol: number; maxCol: number },
  invertHorizontal: boolean = false
): ROISelection {
  const footHeight = bbox.maxRow - bbox.minRow + 1;
  const footWidth = bbox.maxCol - bbox.minCol + 1;

  let minColNorm = normalizedROI.minColNorm;
  let maxColNorm = normalizedROI.maxColNorm;

  // Si hay que invertir horizontalmente, reflejar las coordenadas X
  if (invertHorizontal) {
    // Invertir: 1 - valor para reflejar horizontalmente
    const tempMinCol = minColNorm;
    minColNorm = 1 - maxColNorm;
    maxColNorm = 1 - tempMinCol;
  }

  // Calcular límites absolutos usando porcentajes normalizados
  const minRow = bbox.minRow + Math.floor(normalizedROI.minRowNorm * footHeight);
  const maxRow = bbox.minRow + Math.floor(normalizedROI.maxRowNorm * footHeight);
  const minCol = bbox.minCol + Math.floor(minColNorm * footWidth);
  const maxCol = bbox.minCol + Math.floor(maxColNorm * footWidth);

  // Asegurarse de que no se salgan del bounding box
  return {
    minRow: Math.max(bbox.minRow, minRow),
    maxRow: Math.min(bbox.maxRow, maxRow),
    minCol: Math.max(bbox.minCol, minCol),
    maxCol: Math.min(bbox.maxCol, maxCol),
  };
}

/**
 * Aplica la calibración guardada a un nuevo pie
 */
export function applyROICalibration(
  footMask: boolean[],
  rows: number,
  cols: number,
  footSide: 'izquierdo' | 'derecho',
  calibration?: ROICalibration
): FootROIs | null {
  // Cargar calibración si no se proporciona
  if (!calibration) {
    const saved = localStorage.getItem('roiCalibration');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      calibration = parsed as ROICalibration;
    } catch (e) {
      console.error('Error parsing ROI calibration:', e);
      return null;
    }
  }

  if (!calibration) return null;

  const bbox = getFootBoundingBox(footMask, rows, cols);
  
  if (!bbox) return null;

  // Desnormalizar cada ROI primero sin invertir
  const halluxCoords = denormalizeCoordinates(calibration.hallux, bbox, false);
  const metatarsalCoords = denormalizeCoordinates(calibration.firstMetatarsal, bbox, false);
  const heelCoords = denormalizeCoordinates(calibration.heel, bbox, false);

  // Determinar si necesitamos invertir basándonos en la posición del hallux
  // El hallux debe estar siempre en el lado correcto según el pie:
  // - Pie izquierdo: hallux en el lado izquierdo del pie (col < bboxCenterCol)
  // - Pie derecho: hallux en el lado derecho del pie (col >= bboxCenterCol)
  const halluxCenterCol = (halluxCoords.minCol + halluxCoords.maxCol) / 2;
  const bboxCenterCol = (bbox.minCol + bbox.maxCol) / 2;
  const halluxIsOnLeft = halluxCenterCol < bboxCenterCol;
  
  // Determinar dónde debería estar el hallux según el pie actual
  const shouldHalluxBeOnLeft = footSide === 'izquierdo';
  
  // Invertir si el hallux no está en el lado correcto
  // Usar un margen pequeño para evitar inversiones innecesarias cuando está muy cerca del centro
  const shouldInvert = halluxIsOnLeft !== shouldHalluxBeOnLeft;

  // Si hay que invertir, invertir literalmente el eje X de toda la imagen
  if (shouldInvert) {
    // Invertir las coordenadas X reflejándolas a través del centro de la imagen completa
    const invertX = (col: number) => cols - 1 - col;
    
    const invertCoords = (coords: ROISelection): ROISelection => {
      const newMinCol = invertX(coords.maxCol);
      const newMaxCol = invertX(coords.minCol);
      return {
        minRow: coords.minRow,
        maxRow: coords.maxRow,
        minCol: Math.min(newMinCol, newMaxCol),
        maxCol: Math.max(newMinCol, newMaxCol),
      };
    };

    // Aplicar inversión a cada ROI
    const tempHallux = invertCoords(halluxCoords);
    const tempMetatarsal = invertCoords(metatarsalCoords);
    const tempHeel = invertCoords(heelCoords);
    
    // Actualizar coordenadas
    halluxCoords.minCol = tempHallux.minCol;
    halluxCoords.maxCol = tempHallux.maxCol;
    metatarsalCoords.minCol = tempMetatarsal.minCol;
    metatarsalCoords.maxCol = tempMetatarsal.maxCol;
    heelCoords.minCol = tempHeel.minCol;
    heelCoords.maxCol = tempHeel.maxCol;
  }

  // Verificación final: asegurar que el hallux esté en el lado correcto
  // Recalcular el centro del bounding box después de la inversión
  const finalBboxCenterCol = (bbox.minCol + bbox.maxCol) / 2;
  const finalHalluxCenterCol = (halluxCoords.minCol + halluxCoords.maxCol) / 2;
  const finalHalluxIsOnLeft = finalHalluxCenterCol < finalBboxCenterCol;
  const finalShouldHalluxBeOnLeft = footSide === 'izquierdo';
  
  // Si después de la inversión el hallux aún no está en el lado correcto, forzar la inversión
  if (finalHalluxIsOnLeft !== finalShouldHalluxBeOnLeft) {
    const invertX = (col: number) => cols - 1 - col;
    
    const invertCoords = (coords: ROISelection): ROISelection => {
      const newMinCol = invertX(coords.maxCol);
      const newMaxCol = invertX(coords.minCol);
      return {
        minRow: coords.minRow,
        maxRow: coords.maxRow,
        minCol: Math.min(newMinCol, newMaxCol),
        maxCol: Math.max(newMinCol, newMaxCol),
      };
    };

    // Aplicar inversión forzada
    const tempHallux = invertCoords(halluxCoords);
    const tempMetatarsal = invertCoords(metatarsalCoords);
    const tempHeel = invertCoords(heelCoords);
    
    halluxCoords.minCol = tempHallux.minCol;
    halluxCoords.maxCol = tempHallux.maxCol;
    metatarsalCoords.minCol = tempMetatarsal.minCol;
    metatarsalCoords.maxCol = tempMetatarsal.maxCol;
    heelCoords.minCol = tempHeel.minCol;
    heelCoords.maxCol = tempHeel.maxCol;
  }

  // Crear máscaras
  const halluxMask = new Array<boolean>(rows * cols).fill(false);
  const firstMetatarsalMask = new Array<boolean>(rows * cols).fill(false);
  const heelMask = new Array<boolean>(rows * cols).fill(false);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (!footMask[idx]) continue;

      if (row >= halluxCoords.minRow && row <= halluxCoords.maxRow &&
          col >= halluxCoords.minCol && col <= halluxCoords.maxCol) {
        halluxMask[idx] = true;
      }

      if (row >= metatarsalCoords.minRow && row <= metatarsalCoords.maxRow &&
          col >= metatarsalCoords.minCol && col <= metatarsalCoords.maxCol) {
        firstMetatarsalMask[idx] = true;
      }

      if (row >= heelCoords.minRow && row <= heelCoords.maxRow &&
          col >= heelCoords.minCol && col <= heelCoords.maxCol) {
        heelMask[idx] = true;
      }
    }
  }

  return {
    hallux: halluxMask,
    firstMetatarsal: firstMetatarsalMask,
    heel: heelMask,
    boundingBox: bbox,
  };
}

/**
 * Calcula estadísticas de temperatura para una ROI específica
 * Solo considera píxeles que están tanto en la ROI como en el pie (no el fondo)
 */
export function getROIStats(
  data: number[],
  roiMask: boolean[],
  footMask: boolean[],
  rows: number,
  cols: number
): { min: number; max: number; avg: number; count: number } | null {
  const temps: number[] = [];
  
  // Solo considerar píxeles que están en la ROI Y en el pie (no en el fondo)
  for (let i = 0; i < data.length; i++) {
    if (roiMask[i] && footMask[i]) {
      temps.push(data[i]);
    }
  }

  if (temps.length === 0) return null;

  let min = temps[0], max = temps[0], sum = 0;
  for (const temp of temps) {
    if (temp < min) min = temp;
    if (temp > max) max = temp;
    sum += temp;
  }

  return {
    min,
    max,
    avg: sum / temps.length,
    count: temps.length
  };
}

