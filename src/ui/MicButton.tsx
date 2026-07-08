import React from 'react';

interface MicButtonProps {
  isListening: boolean;
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function MicButton({ isListening, isEvaluating, isAiSpeaking, startListening, stopListening }: MicButtonProps) {
  const disabled = isEvaluating || isAiSpeaking;

  const label = disabled
    ? (isEvaluating ? '麦克风已禁用 — AI 正在思考' : '麦克风已禁用 — AI 正在说话')
    : (isListening ? '正在收音，点击停止' : '点击开始回答');

  return (
    <button
      type="button"
      onClick={isListening ? stopListening : startListening}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isListening}
      aria-disabled={disabled}
      title={label}
      className={`relative size-14 rounded-full flex items-center justify-center transition-all ${
        isListening
          // Non-color signals for the "on" state: an outer ring + scale bump,
          // so the active state is legible without relying on the accent alone.
          // Near-black text on lime keeps AA contrast (white-on-lime would fail).
          ? 'bg-primary text-background hover:bg-[#b6e63a] shadow-[0_0_20px_rgba(198,242,78,0.35)] scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white ring-1 ring-white/10'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {/* Icon itself is a non-color state signal: mic (on) vs mic_off (off). */}
      <span className="material-symbols-outlined" style={{ fontSize: '24px' }} aria-hidden="true">
        {isListening ? 'mic' : 'mic_off'}
      </span>
      {/* Redundant, non-color "live" indicator dot while recording. */}
      {isListening && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-white border-2 border-primary animate-pulse"
        />
      )}
    </button>
  );
}
