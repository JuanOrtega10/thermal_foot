import asyncio
import json
import time

import numpy as np
from PIL import Image      # pip install pillow
import websockets          # ya lo tienes en tu venv


class SimulatedSensor:
    """
    Sensor simulado basado en una imagen térmica (pie_solo.jpg).
    Cada frame = imagen base + pequeño ruido + deriva lenta.
    Soporta diferentes modos de simulación con variaciones de temperatura.
    """
    def __init__(
        self,
        image_path: str = "pie_solo.jpg",
        rows: int = 32,
        cols: int = 24,
        temp_min: float = 28.0,   # ºC mínimo
        temp_max: float = 38.0,   # ºC máximo
        noise_std: float = 0.15   # ruido gaussiano (ºC)
    ):
        self.rows = rows
        self.cols = cols
        self.temp_min = float(temp_min)
        self.temp_max = float(temp_max)
        self.noise_std = float(noise_std)
        self.t = 0.0
        self.image_path = image_path
        self.simulation_mode = "baja_diferencia"  # baja_diferencia o alta_diferencia
        self.foot = "izquierdo"  # izquierdo o derecho
        self._load_image(image_path)

    def _load_image(self, image_path: str):
        """Carga y prepara la imagen base."""
        try:
            img = Image.open(image_path).convert("L")          # escala de grises
            img_resized = img.resize((self.cols, self.rows), Image.BILINEAR)

            arr = np.asarray(img_resized, dtype=np.float32)
            amin = float(arr.min())
            amax = float(arr.max())

            if amax == amin:
                norm = np.zeros_like(arr, dtype=np.float32)
            else:
                norm = (arr - amin) / (amax - amin)            # [0,1]

            # Mapear a rango térmico
            self.base = self.temp_min + (self.temp_max - self.temp_min) * norm
            # base tiene shape (rows, cols)
        except FileNotFoundError:
            print(f"Advertencia: No se encontró {image_path}, usando imagen por defecto")
            # Crear una imagen base sintética si no existe el archivo
            self.base = np.full((self.rows, self.cols), (self.temp_min + self.temp_max) / 2, dtype=np.float32)

    def set_config(self, simulation_mode: str = None, foot: str = None):
        """
        Configura el modo de simulación y el pie a mostrar.
        
        Args:
            simulation_mode: "baja_diferencia" o "alta_diferencia"
            foot: "izquierdo" o "derecho"
        """
        changed = False
        
        if simulation_mode and simulation_mode in ["baja_diferencia", "alta_diferencia"]:
            if self.simulation_mode != simulation_mode:
                self.simulation_mode = simulation_mode
                changed = True
                print(f"Modo de simulación cambiado a: {simulation_mode}")
        
        if foot and foot in ["izquierdo", "derecho"]:
            if self.foot != foot:
                self.foot = foot
                changed = True
                # Cambiar la imagen según el pie
                image_map = {
                    "izquierdo": "pie_izquierdo.png",
                    "derecho": "pie_derecho.png",
                }
                image_path = image_map.get(foot, "pie_izquierdo.png")
                if image_path != self.image_path:
                    self.image_path = image_path
                    self._load_image(image_path)
                    print(f"Pie cambiado a: {foot} (imagen: {image_path})")
        
        return changed

    def get_frame(self) -> np.ndarray:
        """
        Devuelve un frame (rows x cols) con ruido + deriva suave.
        Aplica offset de temperatura según el modo de simulación y el pie.
        """
        self.t += 0.05  # "tiempo" para la deriva
        drift = 0.3 * np.sin(self.t)  # ±0.3 ºC

        noise = np.random.normal(0.0, self.noise_std, self.base.shape).astype(np.float32)

        # Aplicar offset según el modo de simulación y el pie
        temp_offset = self._calculate_temperature_offset()
        
        frame = self.base + drift + noise + temp_offset
        return frame
    
    def _calculate_temperature_offset(self) -> np.ndarray:
        """
        Calcula el offset de temperatura según el modo de simulación y el pie.
        Para alta diferencia, aplica offset solo en las zonas más calientes de la imagen base.
        
        Returns:
            Matriz de offsets en grados Celsius (misma forma que self.base)
        """
        rows, cols = self.base.shape
        offset_map = np.zeros((rows, cols), dtype=np.float32)
        
        # Definir offsets según el modo de simulación
        if self.simulation_mode == "baja_diferencia":
            # Diferencia pequeña: pie izquierdo ligeramente más frío, derecho ligeramente más caliente
            uniform_offset = -0.3 if self.foot == "izquierdo" else 0.3
            offset_map.fill(uniform_offset)
        else:  # alta_diferencia
            # Diferencia alta: solo bajar temperatura del pie izquierdo
            # Pie izquierdo: -1.5°C (más frío)
            # Pie derecho: sin cambios (0°C)
            # Esto crea una diferencia de 1.5°C entre ambos pies
            if self.foot == "izquierdo":
                offset_map.fill(-1.5)
            # Si es pie derecho, offset_map permanece en 0 (sin cambios)
        
        return offset_map


FPS = 4.0
INTERVAL = 1.0 / FPS

# Modos de simulación válidos
VALID_SIMULATION_MODES = ["baja_diferencia", "alta_diferencia"]
VALID_FEET = ["izquierdo", "derecho"]


async def frame_producer(websocket):
    """
    Handler de websockets.serve: SOLO recibe 'websocket' en tu versión de la librería.
    Envía frames continuamente al cliente conectado.
    Cada cliente tiene su propio sensor con su configuración (modo de simulación + pie).
    """
    print(f"Cliente conectado desde {websocket.remote_address}, fps={FPS}")
    
    # Crear un sensor por cliente con configuración por defecto
    current_simulation_mode = "baja_diferencia"
    current_foot = "izquierdo"
    sensor = SimulatedSensor("pie_izquierdo.png")
    sensor.set_config(current_simulation_mode, current_foot)
    
    # Flag para controlar el loop
    running = True
    
    async def send_frames():
        """Envía frames continuamente al cliente."""
        nonlocal running
        while running:
            try:
                t0 = time.time()
                frame = sensor.get_frame()  # (rows, cols)
                
                payload = {
                    "simulation_mode": current_simulation_mode,
                    "foot": current_foot,
                    "timestamp": time.time(),
                    "rows": sensor.rows,
                    "cols": sensor.cols,
                    "data": frame.astype(float).ravel().tolist(),
                }
                
                await websocket.send(json.dumps(payload))
                
                elapsed = time.time() - t0
                await asyncio.sleep(max(0.0, INTERVAL - elapsed))
            except websockets.ConnectionClosed:
                running = False
                break
            except Exception as e:
                print(f"Error enviando frame: {e}")
                running = False
                break
    
    async def receive_messages():
        """Recibe mensajes del cliente (cambios de configuración)."""
        nonlocal current_simulation_mode, current_foot, running
        while running:
            try:
                # Esperar mensaje del cliente con timeout
                message = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                try:
                    msg_data = json.loads(message)
                    if isinstance(msg_data, dict):
                        changed = False
                        
                        # Procesar cambio de modo de simulación
                        if "simulation_mode" in msg_data:
                            sim_mode = msg_data["simulation_mode"]
                            if sim_mode in VALID_SIMULATION_MODES:
                                current_simulation_mode = sim_mode
                                sensor.set_config(simulation_mode=sim_mode)
                                changed = True
                            else:
                                print(f"Modo de simulación inválido recibido: {sim_mode}")
                        
                        # Procesar cambio de pie
                        if "foot" in msg_data:
                            foot = msg_data["foot"]
                            if foot in VALID_FEET:
                                current_foot = foot
                                sensor.set_config(foot=foot)
                                changed = True
                            else:
                                print(f"Pie inválido recibido: {foot}")
                        
                        if changed:
                            print(f"Cliente {websocket.remote_address} configurado: sim_mode={current_simulation_mode}, foot={current_foot}")
                except json.JSONDecodeError:
                    print(f"Mensaje no válido recibido: {message}")
            except asyncio.TimeoutError:
                # Timeout es normal, continuar
                continue
            except websockets.ConnectionClosed:
                running = False
                break
            except Exception as e:
                print(f"Error recibiendo mensaje: {e}")
                running = False
                break
    
    try:
        # Esperar mensaje inicial del cliente con la configuración (opcional, timeout de 1 segundo)
        try:
            initial_message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
            try:
                msg_data = json.loads(initial_message)
                if isinstance(msg_data, dict):
                    # Procesar configuración inicial
                    if "simulation_mode" in msg_data:
                        sim_mode = msg_data["simulation_mode"]
                        if sim_mode in VALID_SIMULATION_MODES:
                            current_simulation_mode = sim_mode
                            sensor.set_config(simulation_mode=sim_mode)
                    
                    if "foot" in msg_data:
                        foot = msg_data["foot"]
                        if foot in VALID_FEET:
                            current_foot = foot
                            sensor.set_config(foot=foot)
                    
                    print(f"Cliente {websocket.remote_address} configurado inicialmente: sim_mode={current_simulation_mode}, foot={current_foot}")
            except json.JSONDecodeError:
                # Si no es JSON válido, ignorar y continuar con configuración por defecto
                pass
        except asyncio.TimeoutError:
            # Si no hay mensaje inicial, continuar con configuración por defecto
            pass
        
        # Ejecutar ambas tareas en paralelo
        await asyncio.gather(
            send_frames(),
            receive_messages(),
            return_exceptions=True
        )
        
    except websockets.ConnectionClosed:
        print(f"Cliente desconectado: {websocket.remote_address}")
    except Exception as e:
        print(f"Error en cliente {websocket.remote_address}: {e}")
    finally:
        running = False


async def main():
    async with websockets.serve(frame_producer, "0.0.0.0", 8765):
        print("Servidor WebSocket de simulación listo en ws://0.0.0.0:8765")
        await asyncio.Future()  # Mantener el servidor vivo


if __name__ == "__main__":
    asyncio.run(main())
