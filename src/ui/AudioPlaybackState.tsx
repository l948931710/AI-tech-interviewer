import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, AlertTriangle, RotateCw, VolumeX } from 'lucide-react';
import type { AsrError } from '../voice/useASR';

interface AudioPlaybackStateProps {
  isEvaluating: boolean;
  isAiSpeaking: boolean;
  isPreparingAudio: boolean;
  isListening: boolean;
  currentQuestion: string | null;
  silenceLevel: number;
  isSpeechDetected: boolean;
  transcript: string;
  interimTranscript: string;
  /** Typed ASR error, null when healthy. When set, an inline retry banner shows. */
  asrError?: AsrError | null;
  /** Clears asrError and restarts recognition. */
  onRetryAsr?: () => void;
  /** Playback/TTS failure. When set (with no audio), the read-the-question hint shows. */
  playbackError?: string | null;
}

type StatusTone = 'ai' | 'user';
interface Status {
  text: string;
  tone: StatusTone;
  /** Turn handoffs (AI starts thinking/speaking) are announced assertively. */
  assertive: boolean;
  spinner: boolean;
}

// Single status line resolved by strict state priority so AI-turn and
// user-turn states can never render simultaneously or be confused.
function resolveStatus(p: AudioPlaybackStateProps): Status | null {
  if (p.isEvaluating) return { text: 'AI 正在思考…', tone: 'ai', assertive: true, spinner: true };
  if (p.isPreparingAudio) return { text: '准备回复…', tone: 'ai', assertive: false, spinner: true };
  if (p.isAiSpeaking) return { text: 'AI 正在说话…', tone: 'ai', assertive: true, spinner: false };
  if (p.isSpeechDetected) return { text: '我在听你说…', tone: 'user', assertive: false, spinner: false };
  if (p.isListening) return { text: '请开始回答', tone: 'user', assertive: false, spinner: false };
  return null;
}

export function AudioPlaybackState(props: AudioPlaybackStateProps) {
  const {
    isEvaluating,
    isAiSpeaking,
    isPreparingAudio,
    isListening,
    currentQuestion,
    silenceLevel,
    isSpeechDetected,
    transcript,
    interimTranscript,
    asrError,
    onRetryAsr,
    playbackError
  } = props;

  const status = resolveStatus(props);
  // Two-role signal: the AI speaks in warm-white light, the candidate answers in
  // lime — so the wave color alone tells you whose turn it is.
  const aiActive = isEvaluating || isPreparingAudio || isAiSpeaking;

  const waveHeights = [
    'h-4', 'h-8', 'h-16', 'h-24', 'h-40', 'h-56', 'h-64', 'h-48',
    'h-64', 'h-56', 'h-40', 'h-24', 'h-16', 'h-8', 'h-4'
  ];

  // Two distinct color ramps: warm-white (AI) vs lime (user).
  const userOpacities = [
    'bg-primary/20', 'bg-primary/30', 'bg-primary/40', 'bg-primary/60',
    'bg-primary', 'bg-primary shadow-[0_0_20px_rgba(198,242,78,0.4)]', 'bg-primary shadow-[0_0_25px_rgba(198,242,78,0.5)]',
    'bg-primary', 'bg-primary shadow-[0_0_25px_rgba(198,242,78,0.5)]', 'bg-primary shadow-[0_0_20px_rgba(198,242,78,0.4)]',
    'bg-primary', 'bg-primary/60', 'bg-primary/40', 'bg-primary/30', 'bg-primary/20'
  ];
  const aiOpacities = [
    'bg-[#e8e6e1]/20', 'bg-[#e8e6e1]/30', 'bg-[#e8e6e1]/40', 'bg-[#e8e6e1]/60',
    'bg-[#e8e6e1]', 'bg-[#e8e6e1] shadow-[0_0_20px_rgba(232,230,225,0.4)]', 'bg-[#e8e6e1] shadow-[0_0_25px_rgba(232,230,225,0.5)]',
    'bg-[#e8e6e1]', 'bg-[#e8e6e1] shadow-[0_0_25px_rgba(232,230,225,0.5)]', 'bg-[#e8e6e1] shadow-[0_0_20px_rgba(232,230,225,0.4)]',
    'bg-[#e8e6e1]', 'bg-[#e8e6e1]/60', 'bg-[#e8e6e1]/40', 'bg-[#e8e6e1]/30', 'bg-[#e8e6e1]/20'
  ];
  const barColors = aiActive ? aiOpacities : userOpacities;

  // Audio is unavailable if either the mic/ASR or the TTS playback failed.
  const audioUnavailable = !!asrError || !!playbackError;

  return (
    <div className="w-full max-w-2xl flex flex-col items-center justify-center relative min-h-[160px]">

      {/* Persistent AI caption — the question stays visible as readable text. */}
      {currentQuestion && (
        <div className="w-full mb-4 px-2">
          <div className="mx-auto max-w-xl text-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e8e6e1]/60">AI</span>
            <p className="text-base md:text-lg font-medium leading-relaxed text-white/90 mt-1">
              {currentQuestion}
            </p>
          </div>
        </div>
      )}

      {/* Audio-unavailable hint: question is shown as text above, so guide the user to read it. */}
      {audioUnavailable && currentQuestion && (
        <div className="w-full mb-3 flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <VolumeX className="w-3.5 h-3.5" />
            音频不可用 — 请阅读上方问题
          </div>
        </div>
      )}

      {/* Inline ASR error banner with retry. */}
      {asrError && (
        <div className="w-full mb-3 flex justify-center">
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm max-w-xl">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{asrError.message}</span>
            {onRetryAsr && (
              <button
                type="button"
                onClick={onRetryAsr}
                aria-label="重试麦克风"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500 hover:text-white text-red-200 text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                重试
              </button>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {isListening && silenceLevel >= 1 && !isSpeechDetected && !transcript.trim() && !interimTranscript.trim() && !isEvaluating && !isPreparingAudio && !isAiSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute -top-12 bg-primary text-background px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 z-50 whitespace-nowrap tracking-wide"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for your response...
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full aspect-[21/9] flex items-center justify-center gap-1.5 overflow-hidden py-4">
        {waveHeights.map((h, i) => {
           let animateConfig: any = { scaleY: 0.1 };
           let transitionConfig: any = { duration: 0.5 };

           if (isEvaluating) {
              animateConfig = { scaleY: [0.2, 0.5, 0.2] };
              transitionConfig = { duration: 1.5, repeat: Infinity, delay: i * 0.1 };
           } else if (isPreparingAudio) {
              animateConfig = { scaleY: [0.1, 0.3, 0.1] };
              transitionConfig = { duration: 1, repeat: Infinity, delay: i * 0.05 };
           } else if (isAiSpeaking || isSpeechDetected) {
              const peak = [0.4, 0.6, 0.8, 1.2, 0.9, 1.1, 0.5, 1.0, 1.2, 0.8, 1.1, 0.7, 0.9, 0.5, 0.4][i];
              animateConfig = { scaleY: [0.3, peak, 0.3] };
              transitionConfig = { duration: 0.6, repeat: Infinity, ease: "easeInOut", delay: (i % 3) * 0.15 };
           } else if (isListening) {
              animateConfig = { scaleY: 0.3 };
           }

           return (
             <motion.div
               key={i}
               initial={{ scaleY: 0.1 }}
               animate={animateConfig}
               transition={transitionConfig}
               className={`${h} w-1.5 ${barColors[i]} rounded-full origin-center`}
             />
           );
        })}
      </div>

      {/* Single status line, driven by state priority, in an aria-live region. */}
      <div
        className="absolute bottom-0 min-h-[1.5rem] flex items-center justify-center"
        aria-live={status?.assertive ? 'assertive' : 'polite'}
        aria-atomic="true"
        role="status"
      >
        <AnimatePresence mode="wait">
          {status && (
            <motion.div
              key={status.text}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${
                status.tone === 'ai' ? 'text-[#e8e6e1]' : 'text-primary'
              }`}
            >
              {status.spinner && <Loader2 className="animate-spin w-4 h-4" />}
              {status.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
