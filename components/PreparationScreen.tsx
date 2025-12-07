'use client';

interface PreparationScreenProps {
  onContinue: () => void;
  isRecording: boolean;
  recordingTime: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export default function PreparationScreen({ 
  onContinue, 
  isRecording, 
  recordingTime,
  onStartRecording,
  onStopRecording
}: PreparationScreenProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="preparation-screen">
      <div className="preparation-container">
        {/* Logo/Icon at top */}
        <div className="preparation-logo">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 45 48" fill="none">
            <g clipPath="url(#clip0_9_8287)">
              <path d="M22.1182 6.04873L44.5478 -1L38.0032 22.9928L44.5478 46.9177L22.1182 39.9368L-0.375 46.9177L6.23319 22.9928L-0.375 -1L22.1182 6.04873Z" fill="#1338BE"/>
            </g>
            <defs>
              <clipPath id="clip0_9_8287">
                <rect width="45" height="48" fill="white"/>
              </clipPath>
            </defs>
          </svg>
        </div>

        {/* Header */}
        <div className="preparation-header">
          <h1 className="preparation-title">Preparación</h1>
          <p className="preparation-subtitle">
            Siga estas recomendaciones para obtener resultados óptimos
          </p>
        </div>

        {/* Acclimatization Card */}
        <div className="preparation-acclimatization-card">
          <div className="acclimatization-icon-container">
            <div className="acclimatization-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="15" stroke="white" strokeWidth="2"/>
                <path d="M16 8V16L20 20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          <h3 className="acclimatization-title">Tiempo de aclimatación</h3>
          <p className="acclimatization-description">
            Apoye ambos pies en el suelo durante 3 minutos antes de iniciar la captura.
          </p>
        </div>

        {/* Progress Indicators */}
        <div className="preparation-progress">
          <div className="progress-dot active"></div>
          <div className="progress-dot"></div>
          <div className="progress-dot"></div>
        </div>

        {/* IR Camera Status */}
        <div className="preparation-camera-status">
          <div className="camera-status-content">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 2L2 7L10 12L18 7L10 2Z" stroke="#6c63ff" strokeWidth="1.5" fill="none"/>
              <path d="M2 13L10 18L18 13" stroke="#6c63ff" strokeWidth="1.5" fill="none"/>
            </svg>
            <span className="camera-status-text">Cámara IR conectada</span>
          </div>
        </div>

        {/* Optional Recording Button */}
        <div className="preparation-recording-section">
          <button
            className={`recording-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? onStopRecording : onStartRecording}
            type="button"
          >
            {isRecording ? (
              <>
                <div className="recording-indicator"></div>
                <span>Grabando... {formatTime(recordingTime)}</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  <circle cx="8" cy="8" r="2" fill="currentColor"/>
                </svg>
                <span>Grabar notas clínicas</span>
              </>
            )}
          </button>
        </div>

        {/* Continue Button */}
        <button className="preparation-continue-btn" onClick={onContinue}>
          Continuar con captura
        </button>
      </div>
    </div>
  );
}

