import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2, AlertTriangle, RotateCw, VolumeX, Volume2 } from 'lucide-react';
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
  /** Countdown (ms) until the silent question is auto-skipped; 0 when not armed. */
  skipRemainingMs?: number;
  /** True while a failed turn awaits its Retry banner — suppresses the
   *  "tap the mic to answer" idle line, which would contradict the locked mic. */
  turnErrorActive?: boolean;
  /** Re-speaks the current question. Shown as a small replay affordance. */
  onReplayQuestion?: () => void;
  language?: 'zh-CN' | 'en-US';
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
function resolveStatus(p: AudioPlaybackStateProps, isZh: boolean): Status | null {
  if (p.isEvaluating) return { text: isZh ? 'AI 正在思考…' : 'AI is thinking…', tone: 'ai', assertive: true, spinner: true };
  if (p.isPreparingAudio) return { text: isZh ? '准备回复…' : 'Preparing reply…', tone: 'ai', assertive: false, spinner: true };
  if (p.isAiSpeaking) return { text: isZh ? 'AI 正在说话…' : 'AI is speaking…', tone: 'ai', assertive: true, spinner: false };
  // Once the candidate has said anything, stay in "listening" through natural
  // pauses — flapping back to "start answering" mid-answer reads as data loss.
  if (p.isListening && (p.isSpeechDetected || p.transcript.trim() || p.interimTranscript.trim())) {
    return { text: isZh ? '我在听你说…' : 'Listening…', tone: 'user', assertive: false, spinner: false };
  }
  if (p.isListening) return { text: isZh ? '请开始回答' : 'Start answering when ready', tone: 'user', assertive: false, spinner: false };
  // Mic manually turned off between turns: without this line the screen goes
  // fully silent with no cue about how to continue — a quiet dead-end.
  if (!p.asrError && !p.turnErrorActive && p.currentQuestion) {
    return { text: isZh ? '麦克风已暂停 — 点击麦克风按钮继续作答' : 'Mic paused — tap the mic button to answer', tone: 'user', assertive: false, spinner: false };
  }
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
    playbackError,
    skipRemainingMs = 0,
    onReplayQuestion,
    turnErrorActive = false,
    language = 'zh-CN'
  } = props;

  const isZh = language === 'zh-CN';
  const reduceMotion = useReducedMotion();
  const status = resolveStatus(props, isZh);
  // Two-role signal: the AI speaks in warm-white light, the candidate answers in
  // lime — so the wave color alone tells you whose turn it is.
  const aiActive = isEvaluating || isPreparingAudio || isAiSpeaking;
  // Avoid triple-announcing the same state: while the eval banner (thinking) or
  // the top "Aura is Speaking" pill is on screen, the status line still feeds
  // the aria-live region but is visually hidden so only ONE indicator shows.
  const statusVisuallyHidden = isEvaluating || isAiSpeaking;

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

  // Output-audio failure only. An ASR (input) error must not claim "audio
  // unavailable" — the question audio may be playing perfectly fine.
  const playbackUnavailable = !!playbackError;

  const canReplay = !!onReplayQuestion && !!currentQuestion && !aiActive && !turnErrorActive;
  const skipSeconds = Math.ceil(skipRemainingMs / 1000);

  return (
    <div className="w-full max-w-2xl flex flex-col items-center justify-center relative min-h-[160px]">

      {/* Persistent AI caption — the question stays visible as readable text.
          Dimmed while the AI is evaluating/preparing, signaling that this text
          belongs to the outgoing turn and new content is on its way. */}
      {currentQuestion && (
        <div className="w-full mb-4 px-2">
          <div className="mx-auto max-w-xl text-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e8e6e1]/60">AI</span>
            <p className={`text-base md:text-lg font-medium leading-relaxed text-white/90 mt-1 transition-opacity duration-300 ${
              isEvaluating || isPreparingAudio ? 'opacity-50' : 'opacity-100'
            }`}>
              {currentQuestion}
            </p>
            {canReplay && (
              <button
                type="button"
                onClick={onReplayQuestion}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/45 hover:text-primary transition-colors"
              >
                <Volume2 size={13} />
                {isZh ? '重听问题' : 'Replay question'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Playback-unavailable hint: question is shown as text above, so guide the user to read it. */}
      {playbackUnavailable && currentQuestion && (
        <div className="w-full mb-3 flex justify-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
            <VolumeX className="w-3.5 h-3.5" />
            {isZh ? '音频不可用 — 请阅读上方问题' : 'Audio unavailable — please read the question above'}
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
                aria-label={isZh ? '重试麦克风' : 'Retry microphone'}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500 hover:text-white text-red-200 text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                {isZh ? '重试' : 'Retry'}
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
            className={`absolute -top-12 px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 z-50 whitespace-nowrap tracking-wide ${
              silenceLevel >= 2 && skipSeconds > 0
                ? 'bg-amber-400 text-background'
                : 'bg-primary text-background'
            }`}
            aria-live="polite"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {silenceLevel >= 2 && skipSeconds > 0
              ? (isZh ? `${skipSeconds} 秒后将跳过此题 — 开口即可继续` : `Skipping in ${skipSeconds}s — just start speaking`)
              : (isZh ? '等待你的回答…' : 'Waiting for your response…')}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full aspect-[21/9] flex items-center justify-center gap-1.5 overflow-hidden py-4">
        {waveHeights.map((h, i) => {
           let animateConfig: any = { scaleY: 0.1 };
           let transitionConfig: any = { duration: 0.5 };

           if (reduceMotion) {
              // Static, state-keyed amplitudes: no looping motion, but the
              // bars still communicate whose turn it is and that we're live.
              animateConfig = { scaleY: aiActive ? 0.45 : isListening ? 0.3 : 0.12 };
              transitionConfig = { duration: 0 };
           } else if (isEvaluating) {
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

      {/* Single status line, driven by state priority, in an aria-live region.
          Visually hidden when a richer indicator (eval banner / speaking pill)
          already covers the same state, so exactly one indicator shows. */}
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
              className={`${statusVisuallyHidden ? 'sr-only' : ''} text-sm font-bold uppercase tracking-widest flex items-center gap-2 ${
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
