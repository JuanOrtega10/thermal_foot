# Thermal Foot Viewer

Visualizador de datos térmicos en tiempo real usando Next.js 16. Consume datos de un servidor WebSocket y los visualiza en un canvas HTML5.

## Características

- ✅ Conexión WebSocket en tiempo real
- ✅ Visualización térmica con colormap tipo "inferno"
- ✅ Estadísticas en vivo (FPS, temperatura min/max/promedio)
- ✅ Reconexión automática con backoff exponencial
- ✅ Configuración de rango de temperaturas
- ✅ UI moderna y responsive
- ✅ Sin rotación - mapeo directo según especificación

## Requisitos

- Node.js 18+ 
- npm o yarn

## Instalación

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Construir para producción
npm run build

# Ejecutar en producción
npm start
```

La aplicación estará disponible en `http://localhost:3000`

## Configuración

### URL del Servidor WebSocket

Por defecto, la aplicación se conecta a `ws://192.168.50.171:8765`. Puedes cambiar esta URL desde la interfaz de usuario o modificando el estado inicial en `components/ThermalViewer.tsx`:

```typescript
const [serverUrl, setServerUrl] = useState('ws://TU_IP:8765');
```

### Rango de Temperaturas

El rango por defecto es 28.0°C - 38.0°C. Puedes ajustarlo desde la interfaz o modificando el estado inicial:

```typescript
const [tempRange, setTempRange] = useState({ min: 28.0, max: 38.0 });
```

## Formato de Datos

El servidor WebSocket debe enviar mensajes JSON con el siguiente formato:

```json
{
  "rows": 24,
  "cols": 32,
  "data": [28.5, 29.1, 28.8, ...]
}
```

- `rows`: Número de filas (típicamente 24)
- `cols`: Número de columnas (típicamente 32)
- `data`: Array plano de valores de temperatura en grados Celsius (longitud = rows × cols)

## Visualización

La visualización sigue las especificaciones de `VISUALIZATION_FORMAT.md`:

- **Sin rotación**: Mapeo directo de la matriz al canvas
- **Dimensiones dinámicas**: Canvas se ajusta automáticamente (`cols × 20` × `rows × 20` píxeles)
- **Escala fija**: Cada píxel del sensor = 20×20 píxeles en el canvas
- **Indexación**: Row-major (`idx = row × cols + col`)

## Estructura del Proyecto

```
thermal_foot/
├── app/
│   ├── layout.tsx          # Layout principal
│   ├── page.tsx            # Página principal
│   └── globals.css         # Estilos globales
├── components/
│   └── ThermalViewer.tsx   # Componente principal del visualizador
├── lib/
│   └── utils.ts            # Utilidades (conversión temperatura→color, estadísticas)
├── package.json
├── tsconfig.json
└── next.config.js
```

## Tecnologías

- **Next.js 16**: Framework React
- **TypeScript**: Tipado estático
- **WebSocket API**: Conexión en tiempo real
- **Canvas API**: Renderizado de píxeles térmicos

## Desarrollo

### Modificar el Colormap

El colormap se define en `lib/utils.ts` en la función `temperatureToColor()`. Actualmente usa un colormap tipo "inferno" (azul → púrpura → rojo → amarillo).

### Ajustar Frecuencia de Actualización

Por defecto, las estadísticas se actualizan cada 5 frames para mejorar el rendimiento. Puedes modificar esto en `components/ThermalViewer.tsx`:

```typescript
if (frameCountRef.current % 5 === 0) {
  // Actualizar estadísticas
}
```

## Referencias

- `VISUALIZATION_FORMAT.md` - Especificación del formato de visualización
- `WEBSOCKET_API.md` - Documentación de la API WebSocket

## Licencia

MIT


