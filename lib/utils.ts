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
 * Segmenta el pie del fondo usando K-means clustering (K=2)
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
  
  // Inicialización inteligente: usar percentiles para los centroides iniciales
  const sorted = [...frame].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];
  
  // Centroides iniciales: uno para fondo (frío) y uno para pie (caliente)
  let centroidCold = p25;  // Percentil 25 (fondo esperado)
  let centroidHot = p75;   // Percentil 75 (pie esperado)
  
  // K-means iterativo
  let assignments = new Array<number>(n);
  let changed = true;
  let iterations = 0;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    
    // Asignar cada píxel al centroide más cercano
    for (let i = 0; i < n; i++) {
      const temp = frame[i];
      const distToCold = Math.abs(temp - centroidCold);
      const distToHot = Math.abs(temp - centroidHot);
      
      const newAssignment = distToCold < distToHot ? 0 : 1;
      
      if (assignments[i] !== newAssignment) {
        changed = true;
        assignments[i] = newAssignment;
      }
    }
    
    // Recalcular centroides (promedio de temperaturas en cada cluster)
    let sumCold = 0, countCold = 0;
    let sumHot = 0, countHot = 0;
    
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
  
  // Determinar cuál cluster es el pie (el más caliente)
  const footCluster = centroidHot > centroidCold ? 1 : 0;
  
  // Crear máscara: true = pie, false = fondo
  const mask = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    mask[i] = assignments[i] === footCluster;
  }
  
  // Limpieza opcional: eliminar píxeles aislados
  return cleanMaskKMeans(mask, rows, cols);
}

