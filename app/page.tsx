import ThermalViewer from '@/components/ThermalViewer';

export default function Home() {
  return (
    <main className="main-container">
      <header className="header">
        <h1>Thermal Foot Viewer</h1>
        <p>Visualizador de datos térmicos en tiempo real</p>
      </header>
      <ThermalViewer />
    </main>
  );
}



