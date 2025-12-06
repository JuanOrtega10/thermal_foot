import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Thermal Foot Viewer',
  description: 'Visualizador de datos térmicos en tiempo real',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

