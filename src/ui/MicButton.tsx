import React from 'react';

interface MicButtonProps {
  isListening: boolean;
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  isPreparingAudio?: boolean;
  startListening: () => void;
  stopListening: () => void;
  /** When provided, the button becomes an enabled "tap to interrupt" control
   *  while the AI speaks — a keyboard-accessible path to barge in. */
  onBargeIn?: () => void;
  /** Blocks answering while an unresolved turn error awaits its Retry banner. */
  turnErrorActive?: boolean;
  language?: 'zh-CN' | 'en-US';
}

export function MicButton({
  isListening,
  isEvaluating,
  isAiSpeaking,
  isPreparingAudio = false,
  startListening,
  stopListening,
  onBargeIn,
  turnErrorActive = false,
  language = 'zh-CN'
}: MicButtonProps) {
  const isZh = language === 'zh-CN';
  // While the AI speaks and barge-in is available, the button stays ENABLED as
  // an interrupt control. Otherwise AI-turn states disable it.
  const interruptMode = isAiSpeaking && !!onBargeIn;
  const disabled = turnErrorActive || isEvaluating || isPreparingAudio || (isAiSpeaking && !onBargeIn);
  // The mic may be secretly running for barge-in detection during AI speech —
  // never leak that into the visual "recording" state.
  const showsListening = isListening && !isAiSpeaking && !isEvaluating && !isPreparingAudio;

  const label = turnErrorActive
    ? (isZh ? '请先点击重试，恢复上一轮回答' : 'Use the Retry banner to resume first')
    : interruptMode
      ? (isZh ? '打断 AURA，开始回答' : 'Interrupt Aura and start answering')
      : disabled
        ? (isEvaluating
            ? (isZh ? '麦克风已禁用 — AI 正在思考' : 'Microphone disabled — AI is thinking')
            : (isZh ? '麦克风已禁用 — AI 正在准备' : 'Microphone disabled — AI is preparing'))
        : (showsListening
            ? (isZh ? '正在收音 — 点击停止并提交回答' : 'Recording — click to stop and submit your answer')
            : (isZh ? '点击开始回答' : 'Click to start answering'));

  const handleClick = () => {
    if (interruptMode) {
      onBargeIn!();
      return;
    }
    if (isListening) stopListening();
    else startListening();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={showsListening}
      aria-disabled={disabled}
      title={label}
      className={`relative size-14 rounded-full flex items-center justify-center transition-all ${
        showsListening
          // Non-color signals for the "on" state: an outer ring + scale bump,
          // so the active state is legible without relying on the accent alone.
          // Near-black text on lime keeps AA contrast (white-on-lime would fail).
          ? 'bg-primary text-background hover:bg-[#b6e63a] shadow-[0_0_20px_rgba(198,242,78,0.35)] scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background'
          : interruptMode
            ? 'bg-white/[0.06] text-white/80 hover:bg-white/[0.14] hover:text-white ring-1 ring-primary/40'
            : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white ring-1 ring-white/10'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {/* Icon itself is a non-color state signal: mic (on) vs mic_off (off). */}
      <span className="material-symbols-outlined" style={{ fontSize: '24px' }} aria-hidden="true">
        {showsListening ? 'mic' : 'mic_off'}
      </span>
      {/* Redundant, non-color "live" indicator dot while recording. */}
      {showsListening && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-white border-2 border-primary animate-pulse"
        />
      )}
    </button>
  );
}
