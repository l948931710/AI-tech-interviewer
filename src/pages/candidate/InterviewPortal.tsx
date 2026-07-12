import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db, InterviewSession } from '../../lib/db';
import { InterviewScreen } from '../../components/InterviewScreen';
import { InterviewMemory, TurnType } from '../../agent';
import { setInterviewContext } from '../../agent/core';
import { useAudio, generateTTSStream } from '../../voice';
import {
  Loader2, Camera as CameraIcon, Mic, MicOff, Wifi, WifiOff, ArrowRight, Check,
  AlertTriangle, RefreshCw, Copy, MessageSquare, PhoneCall
} from 'lucide-react';


async function* parseNextStepStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ type: string, payload: any }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const line = event.trim();
      // Ignore SSE comment/heartbeat frames (': keepalive …') and ack frames without payloads.
      if (!line.startsWith('event: ')) continue;
      const lines = line.split('\n');
      const eventType = lines[0].replace('event: ', '').trim();
      const payloadLine = lines.find(l => l.startsWith('data: '));
      if (!payloadLine) continue;
      let payload: any = null;
      try {
        payload = JSON.parse(payloadLine.replace('data: ', '').trim());
      } catch {
        continue;
      }
      yield { type: eventType, payload };
    }
  }
}

async function* sequenceTTSStreams(sentenceStream: AsyncGenerator<{text: string, segmentIndex: number}, any, unknown>, generateTTSStreamFn: any) {
   let nextStreamPromise: Promise<AsyncGenerator<string> | null> | null = null;
   const getNext = async (iterator: AsyncIterator<{text: string, segmentIndex: number}>): Promise<AsyncGenerator<string> | null> => {
       const res = await iterator.next();
       if (res.done) return null;
       return generateTTSStreamFn(res.value.text, res.value.segmentIndex);
   };
   const iterator = sentenceStream[Symbol.asyncIterator]();
   let currentStreamPromise = getNext(iterator);
   while (currentStreamPromise) {
       nextStreamPromise = getNext(iterator); // eager fetch!
       try {
           const currentGen = await currentStreamPromise;
           if (!currentGen) break;
           for await (const audioChunk of currentGen) yield audioChunk;
       } catch (e) {
           console.error("pre-fetch error", e);
       }
       currentStreamPromise = nextStreamPromise;
   }
}

const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';
const LANG_STORAGE_KEY = 'aura_interview_lang';

type SystemCheckState = 'idle' | 'checking' | 'completed';
type VoiceState = 'idle' | 'evaluating' | 'preparing' | 'speaking' | 'reminder';
type AppState = 'LOADING' | 'READY' | 'RECONNECTING' | 'INTERVIEWING' | 'GENERATING_REPORT' | 'ERROR';

// Contract F — a branded, differentiated, in-app error object.
type PortalError = {
  kind: 'expired' | 'invalid' | 'used' | 'network' | 'server' | 'not-found' | 'unknown';
  title: string;
  message: string;
  canRetry: boolean;
};

// A pending turn we must be able to re-send verbatim (same answer + requestId)
// so the candidate never has to re-speak after a transient failure (5.5).
type TurnError = { kind: 'network' | 'truncated' };

function makePortalError(kind: PortalError['kind'], isZh: boolean): PortalError {
  const t = (zh: string, en: string) => (isZh ? zh : en);
  switch (kind) {
    case 'expired':
      return {
        kind, canRetry: false,
        title: t('此面试链接已失效', 'This interview link has expired'),
        message: t('此面试链接已失效，请联系 HR 获取新的邀请链接。', 'This interview link is no longer valid. Please contact your recruiter for a new invitation link.'),
      };
    case 'invalid':
      return {
        kind, canRetry: false,
        title: t('无效的面试链接', 'Invalid interview link'),
        message: t('无法验证此面试链接。请确认你使用的是 HR 提供的完整链接，或联系 HR 获取帮助。', 'We could not verify this interview link. Please make sure you used the complete link from your recruiter, or contact them for help.'),
      };
    case 'used':
      return {
        kind, canRetry: false,
        title: t('面试已完成', 'Interview already completed'),
        message: t('此链接对应的面试已完成并提交。如你认为这是误操作，请联系 HR。', 'The interview for this link has already been completed and submitted. Please contact your recruiter if you believe this is a mistake.'),
      };
    case 'not-found':
      return {
        kind, canRetry: false,
        title: t('未找到面试', 'Interview not found'),
        message: t('找不到对应的面试。请检查你的链接，或联系 HR。', 'We could not find this interview. Please double-check your link, or contact your recruiter.'),
      };
    case 'network':
      return {
        kind, canRetry: true,
        title: t('网络连接中断', 'Connection problem'),
        message: t('无法连接到服务器。请检查你的网络连接后重试。', 'We could not reach the server. Please check your internet connection and try again.'),
      };
    case 'server':
      return {
        kind, canRetry: true,
        title: t('服务器出现问题', 'Something went wrong on our end'),
        message: t('服务器暂时无法处理你的请求。请稍后重试。', 'The server ran into a problem handling your request. Please try again in a moment.'),
      };
    default:
      return {
        kind: 'unknown', canRetry: true,
        title: t('出现了一些问题', 'Something went wrong'),
        message: t('发生了未知错误。请重试；如果问题持续，请联系 HR。', 'An unexpected error occurred. Please try again, and contact your recruiter if it keeps happening.'),
      };
  }
}

// 2.5 / 5.11 — tailored, per-cause microphone guidance.
function micGuidance(name: string | null, isZh: boolean): { title: string; help: string } {
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: isZh ? '未检测到麦克风' : 'No microphone found',
      help: isZh
        ? '请连接一个麦克风或带麦克风的耳机，然后点击下方按钮重试。'
        : 'Please connect a microphone or a headset with a mic, then use the button below to retry.',
    };
  }
  // NotAllowedError / SecurityError / default -> permission denied
  return {
    title: isZh ? '麦克风访问被拒绝' : 'Microphone access denied',
    help: isZh
      ? '请点击浏览器地址栏左侧的锁形/摄像头图标，把「麦克风」权限设为“允许”，然后点击下方按钮重试。'
      : 'Click the lock or camera icon on the left of your browser\'s address bar, set Microphone to "Allow", then use the button below to retry.',
  };
}

export default function InterviewPortal() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<InterviewSession | null>(null);
  // 2.9 — hydrate the chosen language from URL/localStorage instead of forcing zh-CN.
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>(() => {
    const fromUrl = searchParams.get('lang');
    if (fromUrl === 'zh-CN' || fromUrl === 'en-US') return fromUrl;
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored === 'zh-CN' || stored === 'en-US') return stored;
    } catch {}
    return 'zh-CN';
  });
  const [appState, setAppState] = useState<AppState>('LOADING');
  const [portalError, setPortalError] = useState<PortalError | null>(null);
  const [errorRetry, setErrorRetry] = useState<(() => void) | null>(null);

  const [memory, setMemory] = useState<InterviewMemory | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentQuestionId, setCurrentQuestionId] = useState<string>(() => crypto.randomUUID());
  const [currentRequestId, setCurrentRequestId] = useState<string>(() => crypto.randomUUID());
  const [interviewPhase, setInterviewPhase] = useState<'INTRO' | 'TECHNICAL'>('INTRO');
  const [currentTurnType, setCurrentTurnType] = useState<TurnType>('intro');

  // Reconnection resume payload (2.3 / 5.8 / 5.9)
  const [resumePhase, setResumePhase] = useState<'INTRO' | 'TECHNICAL'>('TECHNICAL');
  const [resumeQuestion, setResumeQuestion] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<{ title: string; help: string } | null>(null);

  // System Check State (per-row real state — 2.7)
  const [systemCheck, setSystemCheck] = useState<SystemCheckState>('idle');
  const [cameraCheck, setCameraCheck] = useState<SystemCheckState>('idle');
  const [micCheck, setMicCheck] = useState<SystemCheckState>('idle');
  const [asrCheck, setAsrCheck] = useState<SystemCheckState>('idle');
  const [networkCheck, setNetworkCheck] = useState<SystemCheckState>('idle');
  const [cameraAvailable, setCameraAvailable] = useState(false); // 5.10 — track camera honestly
  const [micOk, setMicOk] = useState(false);
  const [micErrorName, setMicErrorName] = useState<string | null>(null);
  const [networkOk, setNetworkOk] = useState(false);
  const [systemCheckFailed, setSystemCheckFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Begin-session button owns its own loading/error (2.10) — no spinner hijack.
  const [beginLoading, setBeginLoading] = useState(false);
  const [beginError, setBeginError] = useState<string | null>(null);

  // Timer State
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Connectivity (5.14)
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  // Turn-level failure that the candidate can retry without re-speaking (5.5 / 5.13)
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  const pendingTurnRef = useRef<{ answer: string; requestId: string } | null>(null);
  // Abort handle for the in-flight next-step request, so a candidate stuck on
  // "still thinking…" can force a fresh attempt (same answer + requestId).
  const turnAbortRef = useRef<AbortController | null>(null);
  const manualEvalRetryRef = useRef(false);

  // Audio & UI State — single source of truth for voice pipeline coordination
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const {
    playTTSStream,
    fallbackTTS,
    stopAudio,
    unlockAudio,
    playbackError,
    isSupported,
  } = useAudio(language);

  const isZh = language === 'zh-CN';

  // Derived booleans for child component props (computed each render, never stale)
  const isEvaluating = voiceState === 'evaluating';
  const isPreparingAudio = voiceState === 'preparing';
  const isAiSpeaking = voiceState === 'speaking' || voiceState === 'reminder';
  const isReminderSpeaking = voiceState === 'reminder';

  // Persist the chosen language so a reconnect (or refresh) keeps it (2.9).
  useEffect(() => {
    try { localStorage.setItem(LANG_STORAGE_KEY, language); } catch {}
  }, [language]);

  // ---- Helpers ---------------------------------------------------------------

  const showPortalError = useCallback((kind: PortalError['kind'], retry?: () => void) => {
    stopAudio();
    setVoiceState('idle');
    const err = makePortalError(kind, language === 'zh-CN');
    setPortalError(err);
    setErrorRetry(() => (err.canRetry && retry ? retry : null));
    setAppState('ERROR');
  }, [language, stopAudio]);

  const goThankYou = useCallback((outcome: 'submitted' | 'ended') => {
    const params = new URLSearchParams();
    params.set('outcome', outcome);
    params.set('lang', language);
    if (outcome === 'ended') {
      // Session stays resumable (NOT_FINISHED) — let the candidate return via the same link.
      params.set('resume', window.location.href);
    }
    navigate(`/thank-you?${params.toString()}`, { replace: true });
  }, [language, navigate]);

  // 4.9 — warm the TTS cold container so the first real audio isn't the cold one.
  const warmupTTS = useCallback(() => {
    if (USE_LOCAL || !id) return;
    const token = searchParams.get('token') || '';
    fetch('/api/tts-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': id, 'X-Interview-Token': token },
      body: JSON.stringify({ warmup: true }),
    }).catch(() => { /* best-effort */ });
  }, [id, searchParams]);

  // 5.12 — real connectivity probe (authenticated, short timeout) rather than
  // navigator.onLine alone. Any HTTP response means "reachable"; only a
  // network error / timeout counts as a network failure.
  const pingNetwork = useCallback(async (): Promise<boolean> => {
    if (USE_LOCAL) return typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!id) return false;
    const token = searchParams.get('token') || '';
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 6000);
    try {
      await fetch('/api/agent/load-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': id, 'X-Interview-Token': token },
        body: JSON.stringify({ sessionId: id }),
        signal: controller.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(to);
    }
  }, [id, searchParams]);

  const speakQuestion = async (text: string, isReminder = false) => {
    const speakingState: VoiceState = isReminder ? 'reminder' : 'speaking';
    setVoiceState('preparing');
    try {
      let cancelTimeout: () => void;
      const timeoutPromise = new Promise<void>((_, reject) => {
        const tid = setTimeout(() => reject(new Error('TTS timeout')), 25000);
        cancelTimeout = () => clearTimeout(tid);
      });

      await Promise.race([
        (async () => {
          const audioStream = generateTTSStream(text);
          await playTTSStream(audioStream, () => {
            cancelTimeout!();
            setVoiceState(speakingState);
          });
        })(),
        timeoutPromise
      ]);
    } catch (error) {
      console.warn("TTS streaming failed or timed out, using browser fallback:", error);
      stopAudio();
      setVoiceState(speakingState);
      await fallbackTTS(text);
    }
    setVoiceState('idle');
  };

  // True once the candidate deliberately interrupted the current AI playback;
  // suppresses the silent-turn TTS fallback (they chose not to listen).
  const bargedInRef = useRef(false);

  const handleBargeIn = useCallback(() => {
    bargedInRef.current = true;
    stopAudio();
    setVoiceState('idle');
  }, [stopAudio]);

  // Re-speak the current question on request (idle turns only).
  const handleReplayQuestion = useCallback(() => {
    if (voiceState !== 'idle' || !currentQuestion) return;
    speakQuestion(currentQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, currentQuestion]);

  const applyNextStep = (nextStep: any) => {
    const updatedMemory = new InterviewMemory(session!.claims, session!.jobRoleContext);
    if (nextStep.transcript) {
      updatedMemory.restoreFromTranscript(nextStep.transcript);
    }
    setMemory(updatedMemory);
    setInterviewPhase('TECHNICAL');
    setCurrentTurnType(nextStep.decision === 'REPEAT_QUESTION' ? 'repeat' : 'follow_up');
    // Keep the SAME questionId when the server repeats the question verbatim:
    // the server's repeat-once guard counts turns per questionId, so rotating
    // it here would let "could you repeat that?" loop forever.
    if (nextStep.decision !== 'REPEAT_QUESTION') {
      setCurrentQuestionId(crypto.randomUUID());
    }
    setCurrentRequestId(crypto.randomUUID());
    setCurrentQuestion(nextStep.nextQuestion);
  };

  // ---- Session load (with 15s timeout — 2.11) --------------------------------

  const loadSessionData = useCallback(async () => {
    if (!id) return;
    setPortalError(null);
    setAppState('LOADING');
    const urlToken = searchParams.get('token') || '';

    let loadSession: any;
    if (USE_LOCAL) {
      loadSession = await db.getSession(id);
    } else {
      if (!urlToken) {
        // 2.2 / 5.15 — never bounce the candidate to the HR landing page.
        showPortalError('invalid');
        return;
      }

      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch('/api/agent/load-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': id,
            'X-Interview-Token': urlToken,
          },
          body: JSON.stringify({ sessionId: id }),
          signal: controller.signal,
        });
      } catch (e) {
        // AbortError (timeout) or a genuine network failure — both retryable.
        console.error('Failed to load session:', e);
        showPortalError('network', loadSessionData);
        return;
      } finally {
        clearTimeout(to);
      }

      if (res.status === 401 || res.status === 403) {
        showPortalError('expired');
        return;
      }
      if (res.status === 404) {
        showPortalError('not-found');
        return;
      }
      if (!res.ok) {
        showPortalError('server', loadSessionData);
        return;
      }
      try {
        loadSession = await res.json();
      } catch (e) {
        showPortalError('server', loadSessionData);
        return;
      }
    }

    if (!loadSession) {
      showPortalError('not-found');
      return;
    }
    if (loadSession.status === 'COMPLETED') {
      goThankYou('submitted');
      return;
    }

    setSession(loadSession);

    if (urlToken && loadSession.id) {
      setInterviewContext(loadSession.id, urlToken);
    }

    const mem = new InterviewMemory(loadSession.claims, loadSession.jobRoleContext);

    // Reconnecting: route through a Resume screen instead of hard-jumping into
    // INTERVIEWING with a canned welcome (2.3 / 5.8 / 5.9).
    if (loadSession.transcript && loadSession.transcript.length > 0) {
      mem.restoreFromTranscript(loadSession.transcript);
      setMemory(mem);

      const turns = loadSession.transcript as any[];
      const hasTechnical = turns.some((t) => t.turnType && t.turnType !== 'intro');
      setResumePhase(hasTechnical ? 'TECHNICAL' : 'INTRO');
      // Restore & re-speak the most recent question we have a record of.
      const lastQ = turns[turns.length - 1]?.question || '';
      setResumeQuestion(lastQ);
      setAppState('RECONNECTING');
    } else {
      setMemory(mem);
      setAppState('READY');
    }
  }, [id, searchParams, showPortalError, goThankYou]);

  useEffect(() => {
    // Load once per session id. Deliberately NOT keyed on loadSessionData's
    // identity: it depends on `language`, and a mid-session language toggle
    // must not re-fetch and reset the candidate back to LOADING.
    loadSessionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- beforeunload (2.12) ---------------------------------------------------

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (appState === 'INTERVIEWING' && id) {
        // Trigger the native "leave site?" confirmation.
        e.preventDefault();
        e.returnValue = '';
        const token = searchParams.get('token') || '';
        fetch('/api/agent/update-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': id,
            'X-Interview-Token': token,
          },
          body: JSON.stringify({ sessionId: id, status: 'NOT_FINISHED' }),
          keepalive: true
        }).catch(e => console.error(e));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [appState, id, searchParams]);

  // ---- Elapsed timer ---------------------------------------------------------

  useEffect(() => {
    if (appState !== 'INTERVIEWING' || !sessionStartTime) return;
    setElapsedMs(Date.now() - sessionStartTime);
    const tid = setInterval(() => setElapsedMs(Date.now() - sessionStartTime), 1000);
    return () => clearInterval(tid);
  }, [appState, sessionStartTime]);

  // ---- Turn execution & retry (5.5 / 5.6 / 5.13) -----------------------------

  // Runs a single next-step attempt. Throws:
  //  - err.auth      -> 401/403 token expiry (terminal, 5.6)
  //  - err.incomplete-> SSE ended before a 'complete' event (5.13)
  //  - Error         -> network / 5xx (retryable)
  const runTurn = async (answer: string, requestId: string): Promise<'end' | 'done'> => {
    const token = searchParams.get('token') || '';
    const controller = new AbortController();
    turnAbortRef.current = controller;
    const res = await fetch('/api/agent/next-step', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': id || '',
        'X-Interview-Token': token,
      },
      body: JSON.stringify({
        sessionId: id,
        requestId,
        answer,
        question: currentQuestion,
        questionId: currentQuestionId,
        language,
      }),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      const e: any = new Error('auth'); e.auth = true; throw e;
    }
    if (!res.ok) {
      throw new Error(`Next step generation failed: ${res.status}`);
    }

    const isStream = !!(res.headers.get('content-type')?.includes('text/event-stream') && res.body);

    if (isStream) {
      // --- OPPORTUNISTIC SSE PIPELINE (early TTS as sentences stream in) ---
      // The SSE reader is decoupled from audio playback: a barge-in (or any
      // playback fault) only stops the AUDIO, while the reader keeps consuming
      // events until 'complete'. Otherwise interrupting the AI mid-stream would
      // strand the turn without its atomic advance signal and surface a bogus
      // "response was cut off" error that then blocks the candidate's answer.
      let completeStep: any = null;
      let streamError: any = null;

      const sentenceQueue: { text: string; segmentIndex: number }[] = [];
      let queueDone = false;
      let notifyQueue: (() => void) | null = null;
      const wakeQueue = () => { notifyQueue?.(); notifyQueue = null; };

      // First-event idle watchdog: if the SSE produces NOTHING for 25s after
      // headers, abort into the retry path instead of freezing on "thinking".
      let sawFirstEvent = false;
      const firstEventTimer = setTimeout(() => {
        if (!sawFirstEvent) controller.abort();
      }, 25000);

      const readerDone = (async () => {
        try {
          for await (const event of parseNextStepStream(res.body!)) {
            if (!sawFirstEvent) {
              sawFirstEvent = true;
              clearTimeout(firstEventTimer);
            }
            if (event.type === 'sentence') {
              sentenceQueue.push(event.payload as { text: string; segmentIndex: number });
              wakeQueue();
            } else if (event.type === 'complete') {
              // 'complete' is the atomic advance signal: only here do we commit
              // new question/memory. If it never arrives we never advance (5.13).
              completeStep = event.payload;
              applyNextStep(completeStep);
            } else if (event.type === 'error') {
              streamError = new Error(event.payload?.error || 'stream error');
            }
          }
        } catch (e) {
          streamError = e;
        }
        clearTimeout(firstEventTimer);
        queueDone = true;
        wakeQueue();
      })();

      async function* sentenceGenerator() {
        let next = 0;
        while (true) {
          if (next < sentenceQueue.length) {
            yield sentenceQueue[next++];
            continue;
          }
          if (queueDone) return;
          await new Promise<void>((resolve) => { notifyQueue = resolve; });
        }
      }

      const audioStream = sequenceTTSStreams(sentenceGenerator(), generateTTSStream);
      setVoiceState('preparing');
      // Tracks whether streamed TTS ever actually produced audio — if not, the
      // turn would otherwise complete in dead silence.
      let spoke = false;
      try {
        await playTTSStream(audioStream, () => {
          spoke = true;
          setVoiceState('speaking');
        });
      } catch (error) {
        console.error("Stream playback fault", error);
      }

      // Playback ended (naturally or via barge-in). Give the reader a bounded
      // window to finish; in the common case it's already done since text
      // events arrive much faster than audio plays.
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        readerDone,
        new Promise<void>((resolve) => { drainTimer = setTimeout(resolve, 15000); }),
      ]);
      clearTimeout(drainTimer);

      // Silent-turn rescue: the turn committed but no audio ever played (TTS
      // outage). Read the question aloud via the browser fallback so the
      // candidate isn't left staring at a silent screen. Skipped after a
      // deliberate barge-in — they chose to stop listening.
      if (!spoke && completeStep && !bargedInRef.current) {
        const textToSpeak = completeStep.spokenQuestion || completeStep.nextQuestion;
        if (textToSpeak) {
          setVoiceState('speaking');
          await fallbackTTS(textToSpeak);
        }
      }

      // Only step DOWN from AI-turn states. A barge-in may already have moved
      // us to 'idle' — and the candidate may even be mid-submit ('evaluating'),
      // which must not be clobbered back to idle.
      setVoiceState((v) => (v === 'preparing' || v === 'speaking' || v === 'reminder' ? 'idle' : v));

      if (streamError && !completeStep) {
        throw streamError;
      }
      if (!completeStep) {
        const e: any = new Error('interview stream ended before completion'); e.incomplete = true; throw e;
      }
      return completeStep.decision === 'END_INTERVIEW' ? 'end' : 'done';
    }

    // --- FALLBACK JSON PIPELINE ---
    const nextStep = await res.json();
    applyNextStep(nextStep);

    const textToSpeak = nextStep.spokenQuestion || nextStep.nextQuestion;
    setVoiceState('preparing');
    try {
      await playTTSStream(generateTTSStream(textToSpeak), () => setVoiceState('speaking'));
    } catch (error) {
      setVoiceState('speaking');
      await fallbackTTS(textToSpeak);
    }
    setVoiceState('idle');
    return nextStep.decision === 'END_INTERVIEW' ? 'end' : 'done';
  };

  const attemptTurnWithRetry = async (answer: string, requestId: string, attempt: number): Promise<void> => {
    manualEvalRetryRef.current = false;
    bargedInRef.current = false;
    setVoiceState('evaluating');
    try {
      const result = await runTurn(answer, requestId);
      // A barge-in lets the candidate submit the NEXT turn while this one is
      // still draining — only clear the pending ref if it's still ours.
      if (pendingTurnRef.current?.requestId === requestId) {
        pendingTurnRef.current = null;
      }
      setTurnError(null);
      if (result === 'end') {
        goThankYou('submitted');
      }
    } catch (e: any) {
      // 5.6 — token expiry mid-interview: stop and show a terminal error.
      if (e?.auth) {
        showPortalError('expired');
        return;
      }
      // 4.4 — the candidate hit "retry" on a stuck evaluation: the abort landed
      // here. Re-send immediately with the same answer + requestId (idempotent
      // server-side), resetting the attempt budget since this was user-driven.
      const wasManualRetry = manualEvalRetryRef.current;
      // 5.13 — truncated stream: offer a retry WITHOUT advancing the turn.
      if (e?.incomplete && !wasManualRetry) {
        setVoiceState('idle');
        setTurnError({ kind: 'truncated' });
        return;
      }
      // 5.5 — genuine network/5xx: keep the answer, auto-retry (1x, 2x) with the
      // SAME answer + requestId. Only surface a manual retry once exhausted.
      console.error("Evaluation failed", e);
      if ((wasManualRetry || attempt < 2) && (typeof navigator === 'undefined' || navigator.onLine)) {
        await new Promise(r => setTimeout(r, wasManualRetry ? 300 : 1200 * (attempt + 1)));
        return attemptTurnWithRetry(answer, requestId, wasManualRetry ? 0 : attempt + 1);
      }
      setVoiceState('idle');
      setTurnError({ kind: 'network' });
    }
  };

  const handleAnswerSubmit = async (answer: string) => {
    if (voiceState !== 'idle') return; // Guard: only accept answers when idle
    if (turnError) return; // Don't submit a new answer against a stale/unresolved turn (5.13)
    pendingTurnRef.current = { answer, requestId: currentRequestId };
    await attemptTurnWithRetry(answer, currentRequestId, 0);
  };

  const retryPendingTurn = useCallback(() => {
    const pending = pendingTurnRef.current;
    if (!pending || voiceState !== 'idle') return;
    setTurnError(null);
    attemptTurnWithRetry(pending.answer, pending.requestId, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // 4.4 — soft retry surfaced by the stuck-turn watchdog (~15s stuck on
  // evaluating OR preparing). Aborting the in-flight request routes control
  // into attemptTurnWithRetry's catch, which re-sends the same answer +
  // requestId right away. (Aborting also unblocks a stalled TTS pipeline: the
  // body read rejects, the sentence queue closes, playback ends.)
  const handleEvaluatingRetry = useCallback(() => {
    if (voiceState !== 'evaluating' && voiceState !== 'preparing') return;
    manualEvalRetryRef.current = true;
    turnAbortRef.current?.abort();
  }, [voiceState]);

  // ---- Connectivity listeners + reconnect auto-retry (5.14) ------------------

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    // On reconnect, auto-retry a pending network-failed turn.
    if (isOnline && turnError?.kind === 'network' && pendingTurnRef.current && voiceState === 'idle') {
      retryPendingTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // ---- Silence handling (5.2 / 5.14) -----------------------------------------

  const handleSilenceTimeout = async (level: 'voice' | 'skip') => {
    if (voiceState !== 'idle') return;
    if (turnError) return;
    if (level === 'voice') {
      await speakQuestion(isZh ? "你还在听吗？如果需要更多时间思考，请随时告诉我。" : "Are you still there? Please let me know if you need more time to think.", true);
      return;
    }
    // level === 'skip' — guard the auto-skip path. Don't silently submit a skip
    // if we're offline or ASR isn't even supported here; nudge the mic instead.
    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine) || !isSupported) {
      await speakQuestion(
        isZh
          ? "我这边似乎没有听到你的声音，请检查一下麦克风，准备好后直接回答即可。"
          : "I don't seem to be hearing you. Please check your microphone, then just answer when you're ready.",
        true
      );
      return;
    }
    await handleAnswerSubmit(isZh ? "（候选人长时间未作答，跳过此问题）" : "(Candidate did not answer for a long time, skipping question)");
  };

  // ---- Start / system check / resume / end -----------------------------------

  const handleStartInterview = async () => {
    if (!session || !id || systemCheckFailed) return;

    setBeginLoading(true);
    setBeginError(null);

    // Unlock audio from this user gesture so the first TTS chunk plays (contract B).
    await unlockAudio();
    warmupTTS();

    try {
      const token = searchParams.get('token') || '';
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 15000);
      let startRes: Response;
      try {
        startRes = await fetch('/api/agent/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': id,
            'X-Interview-Token': token,
          },
          body: JSON.stringify({ sessionId: id, language }),
          // Without the signal the 15s timeout above is dead code and a hung
          // request spins "Connecting" forever.
          signal: controller.signal,
        });
      } finally {
        clearTimeout(to);
      }

      if (startRes.status === 401 || startRes.status === 403) {
        setBeginLoading(false);
        showPortalError('expired');
        return;
      }
      if (!startRes.ok) throw new Error("Failed to start session");

      const startData = await startRes.json();

      setSessionStartTime(Date.now());
      setCurrentQuestion(startData.nextQuestion);
      setCurrentTurnType('intro');
      setInterviewPhase('INTRO');
      setAppState('INTERVIEWING');
      setBeginLoading(false);

      await speakQuestion(startData.spokenQuestion || startData.nextQuestion);
    } catch (error) {
      console.error("Failed to start interview:", error);
      // 2.10 — inline, retryable error bound to the button; no alert, no re-check.
      setBeginLoading(false);
      setBeginError(isZh
        ? '无法连接到服务器，请检查网络后重试。'
        : 'Could not connect to the server. Please check your network and try again.');
    }
  };

  const handleSystemCheck = async () => {
    setSystemCheck('checking');
    setSystemCheckFailed(false);
    setBeginError(null);
    setMicErrorName(null);

    // Camera (optional — tracked honestly, 5.10)
    setCameraCheck('checking');
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      camStream.getTracks().forEach(t => t.stop());
      setCameraAvailable(true);
    } catch {
      setCameraAvailable(false);
    }
    setCameraCheck('completed');

    // Microphone (required — tailored failure copy, 2.5 / 5.11)
    setMicCheck('checking');
    let localMicOk = false;
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.getTracks().forEach(t => t.stop());
      localMicOk = true;
    } catch (e: any) {
      setMicErrorName(e?.name || 'NotAllowedError');
    }
    setMicOk(localMicOk);
    setMicCheck('completed');

    // ASR support (5.1) — capability check, no async.
    setAsrCheck('checking');
    const asrOk = isSupported;
    setAsrCheck('completed');

    // Network probe (5.12)
    setNetworkCheck('checking');
    const netOk = await pingNetwork();
    setNetworkOk(netOk);
    setNetworkCheck('completed');

    setSystemCheckFailed(!localMicOk || !asrOk || !netOk);
    setSystemCheck('completed');
  };

  const handleResume = async () => {
    if (!session) return;
    setResumeError(null);
    setResumeLoading(true);

    // Re-run the mic check as part of resume (2.3).
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.getTracks().forEach(t => t.stop());
    } catch (e: any) {
      setResumeLoading(false);
      setResumeError(micGuidance(e?.name || 'NotAllowedError', isZh));
      return;
    }

    // Warm the AudioContext from this user gesture, then warm TTS.
    await unlockAudio();
    warmupTTS();

    // Without a recorded question, resuming used to land on a dead screen: no
    // caption, no audio, and (since the mic only auto-starts after AI speech)
    // no way forward. Fall back to a spoken re-engagement prompt.
    const resumeSpeech = resumeQuestion || (isZh
      ? '欢迎回来，我们接着继续。请就上一个话题继续作答，或者告诉我你准备好了。'
      : "Welcome back — let's continue. Pick up where you left off, or just tell me you're ready.");

    // Restore the elapsed timer from transcript timestamps instead of
    // restarting at 0:00 (elapsed ≈ span of the recorded conversation).
    const turns = (session.transcript || []) as any[];
    const ts = turns
      .map((t) => Number(t?.timestamp))
      .filter((n) => Number.isFinite(n) && n > 0);
    const elapsedBase = ts.length >= 2 ? Math.max(0, Math.max(...ts) - Math.min(...ts)) : 0;

    setInterviewPhase(resumePhase);
    setCurrentTurnType(resumePhase === 'INTRO' ? 'intro' : 'main');
    setCurrentQuestionId(crypto.randomUUID());
    setCurrentRequestId(crypto.randomUUID());
    setCurrentQuestion(resumeSpeech);
    setSessionStartTime(Date.now() - elapsedBase);
    setAppState('INTERVIEWING');
    setResumeLoading(false);

    await speakQuestion(resumeSpeech);
  };

  const handleEndSession = async () => {
    stopAudio();
    setVoiceState('idle');
    if (id) {
      const token = searchParams.get('token') || '';
      fetch('/api/agent/update-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': id,
          'X-Interview-Token': token
        },
        body: JSON.stringify({ sessionId: id, status: 'NOT_FINISHED' }),
        keepalive: true
      }).catch(e => console.error('[EndSession] Status update failed:', e));
      // 2.8 — ending early is NOT a completion; the thank-you copy differs.
      goThankYou('ended');
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be unavailable */ }
  };

  // ---- Small render helpers --------------------------------------------------

  const StatusPill = ({ state, ok }: { state: SystemCheckState; ok: boolean }) => {
    if (state === 'idle') return <span className="text-white/40 font-normal">{isZh ? '尚未检查' : 'Not checked'}</span>;
    if (state === 'checking') return <Loader2 size={16} className="animate-spin text-primary" />;
    return ok
      ? <><div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"></div> {isZh ? '就绪' : 'Ready'}</>
      : <span className="text-red-400 font-medium">{isZh ? '不可用' : 'Blocked'}</span>;
  };

  // ---- Renders ---------------------------------------------------------------

  // ERROR — branded, differentiated, never leaves the candidate on LOADING (2.1 / 2.2 / 5.3 / 5.15).
  if (appState === 'ERROR' && portalError) {
    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] max-w-3xl h-[70%] rounded-full aura-gradient opacity-[0.08] blur-[150px]"></div>
        </div>
        <div className="glass-panel p-10 md:p-14 rounded-3xl max-w-lg w-full flex flex-col items-center relative z-10 animate-[fadeIn_0.6s_ease-out]">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent"></div>
          <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-8">
            <AlertTriangle size={40} className="text-red-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold font-display text-white mb-4 tracking-tight">
            {portalError.title}
          </h1>
          <p className="text-base text-white/70 leading-relaxed mb-8 font-light">
            {portalError.message}
          </p>

          {portalError.canRetry && errorRetry ? (
            <button
              onClick={() => errorRetry()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm tracking-wide bg-white text-background hover:shadow-[0_0_30px_rgba(198,242,78,0.3)] transition-all"
            >
              <RefreshCw size={16} />
              {isZh ? '重试' : 'Retry'}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <PhoneCall size={15} className="text-primary/70" />
                {isZh ? '请联系你的招聘负责人 (HR)。' : 'Please contact your recruiter.'}
              </div>
              {id && (
                <div className="mt-1 text-[11px] text-white/40 tracking-wide">
                  {isZh ? '会话编号' : 'Session ID'}:{' '}
                  <span className="font-mono text-white/60 break-all">{id}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (appState === 'LOADING') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center font-display relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/20 rounded-full blur-[100px] animate-pulse"></div>
        </div>
        <Loader2 size={40} className="animate-spin text-primary relative z-10 mb-4" />
        <div className="text-white/70 tracking-[0.2em] text-sm uppercase relative z-10">
          {isZh ? '正在初始化 AURA' : 'Initializing Aura'}
        </div>
      </div>
    );
  }

  // RECONNECTING — explicit Resume (user gesture) rather than a canned welcome (2.3 / 5.8 / 5.9).
  if (appState === 'RECONNECTING' && session) {
    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] max-w-3xl h-[70%] rounded-full aura-gradient opacity-10 blur-[150px]"></div>
        </div>
        <div className="glass-panel p-10 md:p-14 rounded-3xl max-w-lg w-full flex flex-col items-center relative z-10 animate-[fadeIn_0.6s_ease-out]">
          <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>
          <div className="w-20 h-20 rounded-full bg-white/5 border border-primary/20 flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(198,242,78,0.15)]">
            <RefreshCw size={36} className="text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold font-display mb-4 tracking-tight">
            {isZh ? '欢迎回来' : 'Welcome back'}
          </h1>
          <p className="text-base text-white/70 leading-relaxed mb-2 font-light">
            {isZh
              ? '我们保存了你之前的进度。准备好后，我们从上一个问题继续。'
              : 'We saved your earlier progress. When you\'re ready, we\'ll pick up from your last question.'}
          </p>

          {resumeQuestion && (
            <div className="w-full mt-4 mb-6 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-left">
              <div className="text-[10px] font-bold uppercase tracking-widest text-primary/70 mb-1">
                {isZh ? '上一个问题' : 'Last question'}
              </div>
              <p className="text-sm text-white/85 leading-relaxed">{resumeQuestion}</p>
            </div>
          )}

          {resumeError && (
            <div className="w-full mb-5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
              <div className="flex items-center gap-2 text-red-400 font-medium text-sm mb-1">
                <MicOff size={15} /> {resumeError.title}
              </div>
              <p className="text-xs text-white/60 leading-relaxed">{resumeError.help}</p>
            </div>
          )}

          <button
            onClick={handleResume}
            disabled={resumeLoading}
            className={`w-full py-4 rounded-xl font-bold text-sm tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-300 ${
              resumeLoading
                ? 'bg-white/5 border border-white/10 text-white/50 cursor-not-allowed'
                : 'bg-white text-background cursor-pointer hover:shadow-[0_0_30px_rgba(198,242,78,0.3)]'
            }`}
          >
            {resumeLoading ? (
              <>{isZh ? '正在恢复' : 'Resuming'}<Loader2 size={18} className="animate-spin" /></>
            ) : (
              <>{resumeError ? (isZh ? '重试麦克风访问' : 'Retry microphone access') : (isZh ? '恢复面试' : 'Resume interview')}<ArrowRight size={18} /></>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (appState === 'READY' && session) {
    const estimatedMinutes = 30;
    const guidance = micGuidance(micErrorName, isZh);

    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col relative overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full aura-gradient opacity-10 blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full aura-gradient opacity-10 blur-[120px]"></div>
        </div>

        {/* Header */}
        <header className="px-8 py-6 flex justify-between items-center relative z-10">
          <div className="text-2xl font-bold font-display tracking-tight aura-gradient-text">AURA</div>
          <div className="text-xs uppercase tracking-[0.2em] text-white/50">{isZh ? '智能面试平台' : 'Interview Platform'}</div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex justify-center items-center py-12 px-8 relative z-10">
          <div className="w-full max-w-[1000px] animate-[fadeIn_0.6s_ease-out]">

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-24 items-center">

              {/* Left Column: Intro */}
              <div className="space-y-10">
                <div>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl tracking-tight font-bold font-display text-white mb-6 leading-[1.1]">
                    {isZh ? <>欢迎来到你的 <br /><span className="aura-gradient-text">AURA 面试</span></> : <>Welcome to your <br /><span className="aura-gradient-text">Aura Session</span></>}
                  </h1>
                  <p className="text-lg text-white/70 leading-relaxed font-light">
                    {isZh ? (
                      <>你正在参加 <strong className="text-white font-medium">{session.jobRoleContext || '开发工程师'}</strong> 岗位的面试。这是一场由 AI 引导的对话，会围绕你的真实经历动态展开。</>
                    ) : (
                      <>You're interviewing for the <strong className="text-white font-medium">{session.jobRoleContext || 'Developer'}</strong> role. This AI-guided session is designed to explore your experience dynamically.</>
                    )}
                  </p>
                </div>

                <ul className="space-y-6">
                  <li className="flex items-start gap-5 group">
                    <div className="w-8 h-8 rounded-full glass-panel flex items-center justify-center shrink-0 mt-0.5 group-hover:border-primary/50 transition-colors">
                      <Check size={14} className="text-primary" strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-white font-medium block text-lg mb-1">{isZh ? '从容作答' : 'Pace yourself'}</strong>
                      <span className="text-sm text-white/60 leading-relaxed block">
                        {isZh ? '不用着急，先听清每个问题，再像日常交流一样自然地回答。' : 'Take your time to understand each question before responding naturally.'}
                      </span>
                    </div>
                  </li>
                  <li className="flex items-start gap-5 group">
                    <div className="w-8 h-8 rounded-full glass-panel flex items-center justify-center shrink-0 mt-0.5 group-hover:border-primary/50 transition-colors">
                      <Check size={14} className="text-primary" strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-white font-medium block text-lg mb-1">{isZh ? `约 ${estimatedMinutes} 分钟` : `~${estimatedMinutes} Minutes`}</strong>
                      <span className="text-sm text-white/60 leading-relaxed block">
                        {isZh ? `我们会聊到你的背景和 ${session.claims.length} 段具体经历。` : `We'll discuss your background and ${session.claims.length} specific experiences.`}
                      </span>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Right Column: System Check Card */}
              <div className="glass-panel p-8 md:p-10 rounded-3xl relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>

                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-medium font-display tracking-wide text-white">{isZh ? '系统检查' : 'System Check'}</h3>
                  <div className="flex items-center gap-3">
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as any)}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                    >
                      <option value="zh-CN" className="bg-background">🇨🇳 中文</option>
                      <option value="en-US" className="bg-background">🇺🇸 English</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  {/* Camera (optional) */}
                  <div className="flex justify-between items-center py-4 border-b border-white/5 group-hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${cameraCheck === 'completed' && !cameraAvailable ? 'bg-white/[0.03] text-white/40' : 'bg-white/5 text-white/70'}`}>
                        <CameraIcon size={18} />
                      </div>
                      <div>
                        <div className={`font-medium ${cameraCheck === 'completed' && !cameraAvailable ? 'text-white/50' : 'text-white'}`}>{isZh ? '摄像头' : 'Camera'}</div>
                        <div className="text-xs text-white/50 mt-0.5">
                          {cameraCheck !== 'completed'
                            ? (isZh ? '可选' : 'Optional')
                            : cameraAvailable
                              ? (isZh ? '已检测到' : 'Detected')
                              : (isZh ? '摄像头可选 — 未检测到' : 'Optional — not detected')}
                        </div>
                      </div>
                    </div>
                    <div className={`flex items-center gap-2 text-sm font-medium ${cameraCheck === 'completed' && !cameraAvailable ? 'text-white/40' : 'text-white/90'}`}>
                      {cameraCheck === 'idle' && <span className="text-white/40 font-normal">{isZh ? '尚未检查' : 'Not checked'}</span>}
                      {cameraCheck === 'checking' && <Loader2 size={16} className="animate-spin text-primary" />}
                      {cameraCheck === 'completed' && (cameraAvailable
                        ? <><div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"></div> {isZh ? '就绪' : 'Ready'}</>
                        : <span className="text-white/40 font-normal">{isZh ? '可选' : 'Optional'}</span>)}
                    </div>
                  </div>

                  {/* Microphone (required) */}
                  <div className="flex justify-between items-center py-4 border-b border-white/5 group-hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <Mic size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">{isZh ? '麦克风' : 'Microphone'}</div>
                        <div className="text-xs text-white/50 mt-0.5">{isZh ? '必需' : 'Required'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      <StatusPill state={micCheck} ok={micOk} />
                    </div>
                  </div>

                  {/* Voice recognition / ASR (5.1) */}
                  <div className="flex justify-between items-center py-4 border-b border-white/5 group-hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <MessageSquare size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">{isZh ? '语音识别' : 'Voice Recognition'}</div>
                        <div className="text-xs text-white/50 mt-0.5">
                          {asrCheck === 'completed' && !isSupported
                            ? (isZh ? '此浏览器不支持' : 'Not supported here')
                            : (isZh ? '必需' : 'Required')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      <StatusPill state={asrCheck} ok={isSupported} />
                    </div>
                  </div>

                  {/* Network */}
                  <div className="flex justify-between items-center py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <Wifi size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">{isZh ? '网络' : 'Network'}</div>
                        <div className="text-xs text-white/50 mt-0.5">
                          {networkCheck === 'completed' && !networkOk
                            ? (isZh ? '连接失败' : 'Connection failed')
                            : (isZh ? '稳定连接' : 'Connection')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      <StatusPill state={networkCheck} ok={networkOk} />
                    </div>
                  </div>
                </div>

                {/* Mic-specific guidance + retry when the mic check failed (2.5 / 5.11) */}
                {systemCheck === 'completed' && !micOk && (
                  <div className="w-full mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                    <div className="flex items-center gap-2 text-red-400 font-medium text-sm mb-1">
                      <MicOff size={15} /> {guidance.title}
                    </div>
                    <p className="text-xs text-white/60 leading-relaxed mb-3">{guidance.help}</p>
                    <button
                      onClick={handleSystemCheck}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      <RefreshCw size={12} /> {isZh ? '重试麦克风访问' : 'Retry microphone access'}
                    </button>
                  </div>
                )}

                {/* Unsupported-browser guidance + copy-link (5.1) */}
                {systemCheck === 'completed' && micOk && !isSupported && (
                  <div className="w-full mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left">
                    <div className="flex items-center gap-2 text-amber-400 font-medium text-sm mb-1">
                      <AlertTriangle size={15} /> {isZh ? '不支持语音输入' : 'Voice input not supported'}
                    </div>
                    <p className="text-xs text-white/60 leading-relaxed mb-3">
                      {isZh ? '此浏览器不支持语音输入，请用 Chrome 或 Edge 打开此链接。' : 'This browser does not support voice input. Please open this link in Chrome or Edge.'}
                    </p>
                    <button
                      onClick={copyInviteLink}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      <Copy size={12} /> {copied ? (isZh ? '已复制链接' : 'Link copied') : (isZh ? '复制面试链接' : 'Copy interview link')}
                    </button>
                  </div>
                )}

                {/* Network failure guidance + retry (5.12) */}
                {systemCheck === 'completed' && micOk && isSupported && !networkOk && (
                  <div className="w-full mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                    <div className="flex items-center gap-2 text-red-400 font-medium text-sm mb-1">
                      <WifiOff size={15} /> {isZh ? '网络连接失败' : 'Network check failed'}
                    </div>
                    <p className="text-xs text-white/60 leading-relaxed mb-3">
                      {isZh ? '无法连接到服务器。请检查网络后重试。' : 'We could not reach the server. Please check your connection and retry.'}
                    </p>
                    <button
                      onClick={handleSystemCheck}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      <RefreshCw size={12} /> {isZh ? '重新检查' : 'Re-run check'}
                    </button>
                  </div>
                )}

                {systemCheck !== 'completed' ? (
                  <button
                    onClick={handleSystemCheck}
                    disabled={systemCheck === 'checking'}
                    className={`w-full mt-8 py-4 rounded-xl font-medium text-sm tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-300 border ${
                        systemCheck === 'checking'
                          ? 'bg-white/5 border-white/10 text-white/50 cursor-not-allowed'
                          : 'bg-white/10 hover:bg-white/15 border-white/20 text-white cursor-pointer hover:border-primary/50'
                    }`}
                  >
                    {systemCheck === 'checking' ? (
                        <>{isZh ? '正在检查系统' : 'Checking Systems'}<Loader2 size={18} className="animate-spin" /></>
                    ) : (
                        <>{isZh ? '检查系统' : 'Check System'}<ArrowRight size={18} /></>
                    )}
                  </button>
                ) : (
                  <>
                    {systemCheckFailed && (
                      <div className="w-full mt-6 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm font-medium text-center">
                        {isZh ? '请先解决上面标记的问题后再开始。' : 'Please resolve the issues flagged above before starting.'}
                      </div>
                    )}
                    {beginError && (
                      <div className="w-full mt-6 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm font-medium flex items-center justify-center gap-2">
                        <AlertTriangle size={15} /> {beginError}
                      </div>
                    )}
                    <button
                      onClick={handleStartInterview}
                      disabled={systemCheckFailed || beginLoading}
                      className={`w-full mt-8 py-4 rounded-xl font-bold text-sm tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-500 relative overflow-hidden group ${
                        systemCheckFailed || beginLoading
                          ? 'bg-white/5 border border-white/10 text-white/50 cursor-not-allowed'
                          : 'bg-white text-background cursor-pointer hover:shadow-[0_0_30px_rgba(198,242,78,0.3)]'
                      }`}
                    >
                      {!systemCheckFailed && !beginLoading && (
                        <div className="absolute inset-0 aura-gradient opacity-0 group-hover:opacity-10 transition-opacity duration-500"></div>
                      )}
                      {beginLoading ? (
                        <>
                          <span className="relative z-10">{isZh ? '正在连接' : 'Connecting'}</span>
                          <Loader2 size={18} className="relative z-10 animate-spin" />
                        </>
                      ) : (
                        <>
                          <span className="relative z-10">{beginError ? (isZh ? '重试开始' : 'Retry start') : (isZh ? '开始面试' : 'Begin Session')}</span>
                          <ArrowRight size={18} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>

            </div>
          </div>
        </main>
      </div>
    );
  }

  if (appState === 'GENERATING_REPORT') {
    // Legacy state — shouldn't happen anymore, but handle gracefully.
    goThankYou('submitted');
    return null;
  }

  if (appState === 'INTERVIEWING' && session) {
    return (
      <>
        <InterviewScreen
          candidateInfo={session.candidateInfo}
          claims={session.claims}
          memory={memory}
          currentQuestion={currentQuestion}
          isAiSpeaking={isAiSpeaking}
          isEvaluating={isEvaluating}
          isPreparingAudio={isPreparingAudio}
          isReminderSpeaking={isReminderSpeaking}
          onAnswerSubmit={handleAnswerSubmit}
          onSilenceTimeout={handleSilenceTimeout}
          onBargeIn={handleBargeIn}
          onEndSession={handleEndSession}
          onEvaluatingRetry={handleEvaluatingRetry}
          onReplayQuestion={handleReplayQuestion}
          turnErrorActive={!!turnError}
          language={language}
          elapsedMs={elapsedMs}
          claimIndex={memory ? memory.getCurrentClaimIndex() : 0}
          claimTotal={session.claims.length}
        />

        {/* 2.9 — language fallback control so a reconnected candidate isn't forced to zh-CN. */}
        <div className="fixed bottom-4 left-4 z-40">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as any)}
            aria-label={isZh ? '语言' : 'Language'}
            className="bg-black/40 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
          >
            <option value="zh-CN" className="bg-background">🇨🇳 中文</option>
            <option value="en-US" className="bg-background">🇺🇸 English</option>
          </select>
        </div>

        {/* 5.14 — persistent offline banner. */}
        {!isOnline && (
          <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
            <div className="mt-3 flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm font-medium backdrop-blur-md shadow-lg">
              <WifiOff size={15} className="animate-pulse" />
              {isZh ? '连接已断开 — 重连中…' : 'Connection lost — reconnecting…'}
            </div>
          </div>
        )}

        {/* 5.5 / 5.13 — turn failed; retry with the SAME answer, no re-speaking. */}
        {turnError && voiceState === 'idle' && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex justify-center px-4 w-full max-w-md">
            <div className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-200 text-sm backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span className="flex-1">
                {turnError.kind === 'truncated'
                  ? (isZh ? '回复被截断 — 你的回答已保留' : 'Response was cut off — your answer is saved')
                  : (isZh ? '连接中断 — 你的回答已保留' : 'Connection interrupted — your answer is saved')}
              </span>
              <button
                onClick={retryPendingTurn}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/25 hover:bg-red-500 hover:text-white text-red-100 text-xs font-bold uppercase tracking-wider transition-colors flex-shrink-0"
              >
                <RefreshCw size={13} /> {isZh ? '重试' : 'Retry'}
              </button>
            </div>
          </div>
        )}

        {/* Playback failure hint — the question stays visible as text in the caption. */}
        {playbackError && !turnError && isOnline && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex justify-center px-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium backdrop-blur-md">
              <AlertTriangle size={13} />
              {isZh ? '音频不可用 — 请阅读上方问题' : 'Audio unavailable — please read the question above'}
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
