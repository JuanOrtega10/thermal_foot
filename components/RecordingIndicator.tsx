'use client';

interface RecordingIndicatorProps {
  isRecording: boolean;
  recordingTime: number;
}

export default function RecordingIndicator({ isRecording, recordingTime }: RecordingIndicatorProps) {
  if (!isRecording) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="recording-indicator-overlay">
      <div className="recording-indicator-dot"></div>
      <span className="recording-indicator-text">Grabando {formatTime(recordingTime)}</span>
    </div>
  );
}



