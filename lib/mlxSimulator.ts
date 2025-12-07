export interface ThermalData {
  rows: number;
  cols: number;
  data: number[];
  simulation_mode?: string;
  foot?: string;
  timestamp?: number;
}

type SimulationMode = 'baja_diferencia' | 'alta_diferencia';
type Foot = 'izquierdo' | 'derecho';

class SimulatedSensor {
  private rows: number = 32;
  private cols: number = 24;
  private tempMin: number = 28.0;
  private tempMax: number = 38.0;
  private noiseStd: number = 0.15;
  private t: number = 0.0;
  private base: Float32Array;
  private simulationMode: SimulationMode = 'baja_diferencia';
  private foot: Foot = 'izquierdo';
  private imagePath: string = 'pie_izquierdo.png';
  private baseLoaded: boolean = false;

  constructor(rows: number = 32, cols: number = 24) {
    this.rows = rows;
    this.cols = cols;
    // Inicializar con array temporal, se cargará la imagen asíncronamente
    this.base = new Float32Array(this.rows * this.cols);
    this.base.fill((this.tempMin + this.tempMax) / 2);
    // La imagen se cargará cuando se llame a setConfig por primera vez
  }

  private async _loadImage(imagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          // Crear canvas temporal para procesar la imagen
          const canvas = document.createElement('canvas');
          canvas.width = this.cols;
          canvas.height = this.rows;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            console.error('No se pudo obtener contexto del canvas');
            reject(new Error('No se pudo obtener contexto del canvas'));
            return;
          }
          
          // Dibujar imagen redimensionada en el canvas
          ctx.drawImage(img, 0, 0, this.cols, this.rows);
          
          // Obtener datos de píxeles
          const imageData = ctx.getImageData(0, 0, this.cols, this.rows);
          const data = imageData.data;
          
          // Convertir a escala de grises y normalizar
          const grayscale = new Float32Array(this.rows * this.cols);
          let min = Infinity;
          let max = -Infinity;
          
          for (let i = 0; i < data.length; i += 4) {
            // Convertir RGB a escala de grises (luminosidad)
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const idx = Math.floor(i / 4);
            grayscale[idx] = gray;
            min = Math.min(min, gray);
            max = Math.max(max, gray);
          }
          
          // Normalizar a [0, 1]
          const range = max - min;
          if (range === 0) {
            // Si todos los píxeles son iguales, usar valor medio
            this.base.fill((this.tempMin + this.tempMax) / 2);
          } else {
            // Normalizar y mapear a rango térmico
            for (let i = 0; i < grayscale.length; i++) {
              const normalized = (grayscale[i] - min) / range;
              this.base[i] = this.tempMin + (this.tempMax - this.tempMin) * normalized;
            }
          }
          
          this.baseLoaded = true;
          console.log(`Imagen cargada: ${imagePath}`);
          resolve();
        } catch (error) {
          console.error(`Error procesando imagen ${imagePath}:`, error);
          // Usar imagen por defecto si hay error
          this.base.fill((this.tempMin + this.tempMax) / 2);
          resolve();
        }
      };
      
      img.onerror = () => {
        console.warn(`No se encontró ${imagePath}, usando imagen por defecto`);
        // Usar imagen por defecto si no se encuentra
        this.base.fill((this.tempMin + this.tempMax) / 2);
        resolve();
      };
      
      // Cargar imagen (usar ruta relativa desde la raíz del proyecto)
      img.src = `/${imagePath}`;
    });
  }

  async setConfig(simulationMode?: SimulationMode, foot?: Foot): Promise<boolean> {
    let changed = false;
    let imageChanged = false;
    
    if (simulationMode && ['baja_diferencia', 'alta_diferencia'].includes(simulationMode)) {
      if (this.simulationMode !== simulationMode) {
        this.simulationMode = simulationMode;
        changed = true;
      }
    }
    
    if (foot && ['izquierdo', 'derecho'].includes(foot)) {
      if (this.foot !== foot) {
        this.foot = foot;
        changed = true;
      }
    }
    
    // Determinar qué imagen usar según el pie actual
    const imageMap: Record<Foot, string> = {
      izquierdo: 'pie_izquierdo.png',
      derecho: 'pie_derecho.png',
    };
    const newImagePath = imageMap[this.foot];
    
    // Cargar imagen si es la primera vez o si cambió el pie
    if (!this.baseLoaded || newImagePath !== this.imagePath) {
      this.imagePath = newImagePath;
      this.baseLoaded = false;
      imageChanged = true;
      await this._loadImage(newImagePath);
      if (this.foot !== foot) {
        console.log(`Pie cambiado a: ${this.foot} (imagen: ${newImagePath})`);
      }
    }
    
    if (changed && !imageChanged) {
      console.log(`Modo de simulación cambiado a: ${this.simulationMode}`);
    }
    
    return changed;
  }

  getFrame(): Float32Array {
    this.t += 0.05; // Incremento de tiempo
    const drift = 0.3 * Math.sin(this.t); // Deriva suave ±0.3°C
    
    // Generar ruido gaussiano
    const noise = new Float32Array(this.rows * this.cols);
    for (let i = 0; i < noise.length; i++) {
      // Generar número aleatorio gaussiano usando Box-Muller
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      noise[i] = z0 * this.noiseStd;
    }
    
    // Calcular offset de temperatura
    const tempOffset = this._calculateTemperatureOffset();
    
    // Combinar todo
    const frame = new Float32Array(this.rows * this.cols);
    for (let i = 0; i < frame.length; i++) {
      frame[i] = this.base[i] + drift + noise[i] + tempOffset[i];
    }
    
    return frame;
  }

  private _calculateTemperatureOffset(): Float32Array {
    const offsetMap = new Float32Array(this.rows * this.cols);
    
    if (this.simulationMode === 'baja_diferencia') {
      // Diferencia pequeña: pie izquierdo ligeramente más frío, derecho ligeramente más caliente
      const uniformOffset = this.foot === 'izquierdo' ? -0.3 : 0.3;
      offsetMap.fill(uniformOffset);
    } else {
      // alta_diferencia: offset de 1.5°C solo en zonas calientes del pie derecho
      // El pie izquierdo se mantiene normal (sin offset)
      // Reducido de 4°C a 1.5°C para permitir mejor diferenciación entre pie y fondo
      if (this.foot === 'derecho') {
        // Calcular umbral basado en el percentil 70 para identificar zonas más calientes
        const sorted = Array.from(this.base).sort((a, b) => a - b);
        const percentile70Index = Math.floor(sorted.length * 0.7);
        const tempThreshold = sorted[percentile70Index];
        
        // Aplicar offset de 1.5°C solo en las zonas que están por encima del umbral
        for (let i = 0; i < offsetMap.length; i++) {
          if (this.base[i] >= tempThreshold) {
            offsetMap[i] = 1.5;
          }
        }
      }
      // Si es pie izquierdo, offsetMap permanece en 0 (sin cambios)
    }
    
    return offsetMap;
  }

  getRows(): number {
    return this.rows;
  }

  getCols(): number {
    return this.cols;
  }
}

export class MLXSimulator {
  private sensor: SimulatedSensor;
  private fps: number = 4.0;
  private interval: number;
  private frameInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private onFrameCallback: ((data: ThermalData) => void) | null = null;
  private simulationMode: SimulationMode = 'baja_diferencia';
  private foot: Foot = 'izquierdo';
  private initializationPromise: Promise<void> | null = null;

  constructor(rows: number = 32, cols: number = 24) {
    this.sensor = new SimulatedSensor(rows, cols);
    this.interval = 1000 / this.fps;
    // Inicializar la carga de la imagen base
    this.initializationPromise = this.sensor.setConfig(this.simulationMode, this.foot);
  }

  async start(onFrame: (data: ThermalData) => void): Promise<void> {
    if (this.isRunning) {
      this.stop();
    }
    
    // Esperar a que la imagen inicial se cargue
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
    
    this.onFrameCallback = onFrame;
    this.isRunning = true;
    this._sendFrame();
  }

  private _sendFrame(): void {
    if (!this.isRunning) return;
    
    const frame = this.sensor.getFrame();
    const data: ThermalData = {
      rows: this.sensor.getRows(),
      cols: this.sensor.getCols(),
      data: Array.from(frame),
      simulation_mode: this.simulationMode,
      foot: this.foot,
      timestamp: Date.now() / 1000,
    };
    
    if (this.onFrameCallback) {
      this.onFrameCallback(data);
    }
    
    this.frameInterval = setTimeout(() => {
      this._sendFrame();
    }, this.interval);
  }

  stop(): void {
    this.isRunning = false;
    if (this.frameInterval) {
      clearTimeout(this.frameInterval);
      this.frameInterval = null;
    }
  }

  async updateConfig(simulationMode?: SimulationMode, foot?: Foot): Promise<void> {
    if (simulationMode) {
      this.simulationMode = simulationMode;
    }
    if (foot) {
      this.foot = foot;
    }
    await this.sensor.setConfig(this.simulationMode, this.foot);
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

