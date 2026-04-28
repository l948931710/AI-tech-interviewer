import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db, InterviewSession } from '../../lib/db';
import { InterviewScreen } from '../../components/InterviewScreen';
import { 
  InterviewMemory, 
  generateFirstQuestion, 
  getNextInterviewStep,
  NextStep,
  StructuredInterviewTurn,
  TurnType
} from '../../agent';
import { setInterviewContext } from '../../agent/core';
import { useAudio, generateTTSStream, generateTTS } from '../../voice';
import { Loader2, Camera as CameraIcon, Mic, Wifi, ArrowRight, Check } from 'lucide-react';


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
      if (!line.startsWith('event: ')) continue;
      const lines = line.split('\n');
      const eventType = lines[0].replace('event: ', '').trim();
      const payloadLine = lines.find(l => l.startsWith('data: '));
      if (!payloadLine) continue;
      const payload = JSON.parse(payloadLine.replace('data: ', '').trim());
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

type SystemCheckState = 'idle' | 'checking' | 'completed';
type VoiceState = 'idle' | 'evaluating' | 'preparing' | 'speaking' | 'reminder';

export default function InterviewPortal() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const [appState, setAppState] = useState<'LOADING' | 'READY' | 'INTERVIEWING' | 'GENERATING_REPORT'>('LOADING');
  
  const [memory, setMemory] = useState<InterviewMemory | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentQuestionId, setCurrentQuestionId] = useState<string>(() => crypto.randomUUID());
  const [currentRequestId, setCurrentRequestId] = useState<string>(() => crypto.randomUUID());
  const [interviewPhase, setInterviewPhase] = useState<'INTRO' | 'TECHNICAL'>('INTRO');
  const [currentTurnType, setCurrentTurnType] = useState<TurnType>('intro');
  
  // System Check State
  const [systemCheck, setSystemCheck] = useState<SystemCheckState>('idle');
  const [cameraCheck, setCameraCheck] = useState<SystemCheckState>('idle');
  const [micCheck, setMicCheck] = useState<SystemCheckState>('idle');
  const [networkCheck, setNetworkCheck] = useState<SystemCheckState>('idle');
  const [systemCheckFailed, setSystemCheckFailed] = useState(false);
  
  // Timer State
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // Audio & UI State — single source of truth for voice pipeline coordination
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const { playTTSStream, fallbackTTS, playTTS, stopAudio, initAudioContext } = useAudio(language);

  // Derived booleans for child component props (computed each render, never stale)
  const isEvaluating = voiceState === 'evaluating';
  const isPreparingAudio = voiceState === 'preparing';
  const isAiSpeaking = voiceState === 'speaking' || voiceState === 'reminder';
  const isReminderSpeaking = voiceState === 'reminder';


  useEffect(() => {
    const loadSessionData = async () => {
      if (id) {
        const urlToken = searchParams.get('token') || '';

        // M4 fix: Load session via server-side endpoint (validates token first)
        // instead of reading directly via the Supabase anon key.
        let loadSession;
        if (USE_LOCAL) {
          // Local dev: direct DB access is fine (no Supabase, no RLS)
          loadSession = await db.getSession(id);
        } else {
          if (!urlToken) {
            alert('Missing interview token. Please use the complete link provided by HR.');
            navigate('/', { replace: true });
            return;
          }

          try {
            const res = await fetch('/api/agent/load-session', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': id,
                'X-Interview-Token': urlToken
              },
              body: JSON.stringify({ sessionId: id })
            });

            if (res.status === 401) {
              alert('This interview link is invalid or has expired.');
              navigate('/', { replace: true });
              return;
            }
            if (res.status === 404) {
              alert('Invalid Interview Link');
              return;
            }
            if (!res.ok) {
              alert('Failed to load interview session. Please try again.');
              return;
            }
            loadSession = await res.json();
          } catch (e) {
            console.error('Failed to load session:', e);
            alert('Network error. Please check your connection and try again.');
            return;
          }
        }

        if (!loadSession) {
          alert("Invalid Interview Link");
          return;
        }
        if (loadSession.status === 'COMPLETED') {
          navigate('/thank-you', { replace: true });
          return;
        }
        
        setSession(loadSession);

        // Set interview context for candidate API auth (invite token)
        if (urlToken && loadSession.id) {
          setInterviewContext(loadSession.id, urlToken);
        }

        const mem = new InterviewMemory(loadSession.claims, loadSession.jobRoleContext);
        
        // Restore from transcript if reconnecting
        if (loadSession.transcript && loadSession.transcript.length > 0) {
           mem.restoreFromTranscript(loadSession.transcript);
           setMemory(mem);
           setAppState('INTERVIEWING');
           
           setCurrentQuestion(language === 'zh-CN' ? "欢迎回来。刚才的连接断开了，让我们继续。" : "Welcome back. We got disconnected, let's continue.");
           setInterviewPhase('TECHNICAL');
        } else {
           setMemory(mem);
           setAppState('READY');
        }
      }
    };
    loadSessionData();
  }, [id, navigate]);



  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (appState === 'INTERVIEWING' && id) {
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
         }).catch(e => console.error(e));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [appState, id]);

  const speakQuestion = async (text: string, isReminder = false) => {
    const speakingState: VoiceState = isReminder ? 'reminder' : 'speaking';
    setVoiceState('preparing');
    try {
      // Safety timeout: abort if no audio chunk arrives within 12s.
      let cancelTimeout: () => void;
      const timeoutPromise = new Promise<void>((_, reject) => {
        const id = setTimeout(() => reject(new Error('TTS timeout')), 25000);
        cancelTimeout = () => clearTimeout(id);
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

  const handleBargeIn = useCallback(() => {
    stopAudio();
    setVoiceState('idle');
  }, [stopAudio]);

  const handleStartInterview = async () => {
    if (!session || !id) return;
    
    // Pre-initialize AudioContext on user gesture so it's warm
    // by the time the first TTS audio chunk arrives (~1-2s later).
    initAudioContext();
    
    setSystemCheck('checking'); // Use UI visually as loading state

    try {
      const token = searchParams.get('token') || '';
      const startRes = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-Id': id,
          'X-Interview-Token': token
        },
        body: JSON.stringify({ sessionId: id, language })
      });
      
      if (!startRes.ok) throw new Error("Failed to start session");
      const startData = await startRes.json();
      
      setSessionStartTime(Date.now());
      setCurrentQuestion(startData.nextQuestion);
      setAppState('INTERVIEWING');
      
      await speakQuestion(startData.spokenQuestion || startData.nextQuestion);
    } catch (error) {
       console.error("Failed to start interview:", error);
       alert("Failed to connect to the server. Please check your network and try again.");
       setSystemCheck('completed');
    }
  };

  const handleSystemCheck = async () => {
    setSystemCheck('checking');
    setSystemCheckFailed(false);
    
    // C3 fix: Real camera permission check (non-blocking — camera is optional)
    setCameraCheck('checking');
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      camStream.getTracks().forEach(t => t.stop());
      setCameraCheck('completed');
    } catch {
      setCameraCheck('completed'); // Camera is optional, mark as done regardless
    }
    
    // C3 fix: Real microphone permission check (BLOCKING — mic is required)
    setMicCheck('checking');
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.getTracks().forEach(t => t.stop());
      setMicCheck('completed');
    } catch {
      setMicCheck('completed');
      setSystemCheckFailed(true);
      setSystemCheck('completed');
      setNetworkCheck('completed');
      return; // Stop here — mic is required
    }
    
    // Network check
    setNetworkCheck('checking');
    try {
      if (!navigator.onLine) throw new Error('Offline');
      setNetworkCheck('completed');
    } catch {
      setNetworkCheck('completed');
      setSystemCheckFailed(true);
    }
    
    setSystemCheck('completed');
  };



  const handleAnswerSubmit = async (answer: string) => {
    if (voiceState !== 'idle') return; // Guard: only accept answers when idle
    setVoiceState('evaluating');
    
    try {
      const token = searchParams.get('token') || '';
      // 1. We just hit our unified pure-DB backend endpoint!
      const res = await fetch('/api/agent/next-step', {
        method: 'POST',
        headers: { 
           'Content-Type': 'application/json',
           'X-Session-Id': id || '',
           'X-Interview-Token': token
        },
        body: JSON.stringify({
           sessionId: id,
           requestId: currentRequestId,
           answer: answer,
           question: currentQuestion,
           questionId: currentQuestionId,
           language: language
        })
      });
      
      if (!res.ok) throw new Error("Next step generation failed");
      if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
        // --- OPPORTUNISTIC SSE PIPLELINE ---
        let isEndInterview = false;
        
        async function* sentenceGenerator() {
          for await (const event of parseNextStepStream(res.body!)) {
             if (event.type === 'sentence') {
               yield event.payload as { text: string; segmentIndex: number };
             } else if (event.type === 'complete') {
                const nextStep = event.payload;
                // Pure Server-Driven State!
                const updatedMemory = new InterviewMemory(session!.claims, session!.jobRoleContext);
                if (nextStep.transcript) {
                  updatedMemory.restoreFromTranscript(nextStep.transcript);
                }
                setMemory(updatedMemory);
                setInterviewPhase('TECHNICAL');
                setCurrentQuestionId(crypto.randomUUID());
                setCurrentRequestId(crypto.randomUUID());
                setCurrentQuestion(nextStep.nextQuestion);
                if (nextStep.decision === 'END_INTERVIEW') {
                    isEndInterview = true;
                }
             } else if (event.type === 'error') {
               throw new Error(event.payload.error);
             }
          }
        }
        
        const audioStream = sequenceTTSStreams(sentenceGenerator(), generateTTSStream);
        setVoiceState('preparing');
        try {
          await playTTSStream(audioStream, () => setVoiceState('speaking'));
        } catch (error) {
           console.error("Stream playback fault", error);
        }
        setVoiceState('idle');
        
        if (isEndInterview) {
           navigate('/thank-you', { replace: true });
        }
        
      } else {
          // --- FALLBACK SEQUENTIAL PIPELINE ---
          const nextStep = await res.json();
          
          const updatedMemory = new InterviewMemory(session!.claims, session!.jobRoleContext);
          if (nextStep.transcript) {
            updatedMemory.restoreFromTranscript(nextStep.transcript);
          }
          setMemory(updatedMemory);
          
          setInterviewPhase('TECHNICAL');
          setCurrentQuestionId(crypto.randomUUID());
          setCurrentRequestId(crypto.randomUUID());
          setCurrentQuestion(nextStep.nextQuestion);
          
          if (nextStep.decision === 'END_INTERVIEW') {
             await speakQuestion(nextStep.spokenQuestion || nextStep.nextQuestion);
             navigate('/thank-you', { replace: true });
             return;
          }
          
          const textToSpeak = nextStep.spokenQuestion || nextStep.nextQuestion;
          const audioStream = generateTTSStream(textToSpeak);
          setVoiceState('preparing');
          
          try {
            await playTTSStream(audioStream, () => {
              setVoiceState('speaking');
            });
          } catch (error) {
            setVoiceState('speaking');
            await fallbackTTS(textToSpeak);
          }
          setVoiceState('idle');
      }

    } catch (error) {
      console.error("Evaluation failed", error);
      await speakQuestion(language === 'zh-CN' ? "抱歉，我的网络好像有点问题，没能听清。你能再重复一下刚才的回答吗？" : "Sorry, my network seems to have an issue and I didn't hear clearly. Could you repeat your answer?");
      setVoiceState('idle');
    }
  };

  const handleSilenceTimeout = async (level: 'voice' | 'skip') => {
    if (voiceState !== 'idle') return;
    if (level === 'voice') {
      await speakQuestion(language === 'zh-CN' ? "你还在听吗？如果需要更多时间思考，请随时告诉我。" : "Are you still there? Please let me know if you need more time to think.", true);
    } else if (level === 'skip') {
      await handleAnswerSubmit(language === 'zh-CN' ? "（候选人长时间未作答，跳过此问题）" : "(Candidate did not answer for a long time, skipping question)");
    }
  };

  const finishInterview = async (finalMemory: InterviewMemory) => {
    if (!id || !session) return;
    navigate('/thank-you', { replace: true });
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
       navigate('/thank-you', { replace: true });
    }
  };

  if (appState === 'LOADING') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center font-display relative overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/20 rounded-full blur-[100px] animate-pulse"></div>
        </div>
        <Loader2 size={40} className="animate-spin text-primary relative z-10 mb-4" />
        <div className="text-white/70 tracking-[0.2em] text-sm uppercase relative z-10">Initializing Aura</div>
      </div>
    );
  }

  if (appState === 'READY' && session) {
    const estimatedMinutes = 30;
    
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
          <div className="text-xs uppercase tracking-[0.2em] text-white/50">Interview Platform</div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex justify-center items-center py-12 px-8 relative z-10">
          <div className="w-full max-w-[1000px] animate-[fadeIn_0.6s_ease-out]">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-24 items-center">
              
              {/* Left Column: Intro */}
              <div className="space-y-10">
                <div>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl tracking-tight font-bold font-display text-white mb-6 leading-[1.1]">
                    Welcome to your <br />
                    <span className="aura-gradient-text">Aura Session</span>
                  </h1>
                  <p className="text-lg text-white/70 leading-relaxed font-light">
                    You're interviewing for the <strong className="text-white font-medium">{session.jobRoleContext || 'Developer'}</strong> role. This AI-guided session is designed to explore your experience dynamically.
                  </p>
                </div>
                
                <ul className="space-y-6">
                  <li className="flex items-start gap-5 group">
                    <div className="w-8 h-8 rounded-full glass-panel flex items-center justify-center shrink-0 mt-0.5 group-hover:border-primary/50 transition-colors">
                      <Check size={14} className="text-primary" strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-white font-medium block text-lg mb-1">Pace yourself</strong>
                      <span className="text-sm text-white/60 leading-relaxed block">Take your time to understand each question before responding naturally.</span>
                    </div>
                  </li>
                  <li className="flex items-start gap-5 group">
                    <div className="w-8 h-8 rounded-full glass-panel flex items-center justify-center shrink-0 mt-0.5 group-hover:border-primary/50 transition-colors">
                      <Check size={14} className="text-primary" strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-white font-medium block text-lg mb-1">~{estimatedMinutes} Minutes</strong>
                      <span className="text-sm text-white/60 leading-relaxed block">We'll discuss your background and {session.claims.length} specific experiences.</span>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Right Column: System Check Card */}
              <div className="glass-panel p-8 md:p-10 rounded-3xl relative overflow-hidden group">
                {/* Subtle border top highlight */}
                <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>
                
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-medium font-display tracking-wide text-white">System Check</h3>
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
                  <div className="flex justify-between items-center py-4 border-b border-white/5 group-hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <CameraIcon size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">Camera</div>
                        <div className="text-xs text-white/50 mt-0.5">Detected</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      {cameraCheck === 'idle' && <span className="text-white/40 font-normal">Pending</span>}
                      {cameraCheck === 'checking' && <Loader2 size={16} className="animate-spin text-primary" />}
                      {cameraCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"></div> Ready</>}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center py-4 border-b border-white/5 group-hover:border-white/10 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <Mic size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">Microphone</div>
                        <div className="text-xs text-white/50 mt-0.5">Required</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      {micCheck === 'idle' && <span className="text-white/40 font-normal">Pending</span>}
                      {micCheck === 'checking' && <Loader2 size={16} className="animate-spin text-primary" />}
                      {micCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"></div> Ready</>}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/70">
                        <Wifi size={18} />
                      </div>
                      <div>
                        <div className="text-white font-medium">Network</div>
                        <div className="text-xs text-white/50 mt-0.5">Stable</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/90 text-sm font-medium">
                      {networkCheck === 'idle' && <span className="text-white/40 font-normal">Pending</span>}
                      {networkCheck === 'checking' && <Loader2 size={16} className="animate-spin text-primary" />}
                      {networkCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"></div> Ready</>}
                    </div>
                  </div>
                </div>
                
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
                        <>
                          Checking Systems
                          <Loader2 size={18} className="animate-spin" />
                        </>
                    ) : (
                        <>
                          Check System
                          <ArrowRight size={18} />
                        </>
                    )}
                  </button>
                ) : (
                  <>
                    {systemCheckFailed && (
                      <div className="w-full mt-6 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm font-medium text-center">
                        Microphone access is required.
                      </div>
                    )}
                    <button 
                      onClick={handleStartInterview}
                      disabled={systemCheckFailed}
                      className={`w-full mt-8 py-4 rounded-xl font-bold text-sm tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-500 relative overflow-hidden group ${
                        systemCheckFailed
                          ? 'bg-white/5 border border-white/10 text-white/50 cursor-not-allowed'
                          : 'bg-white text-background cursor-pointer hover:shadow-[0_0_30px_rgba(0,240,255,0.3)]'
                      }`}
                    >
                      {!systemCheckFailed && (
                        <div className="absolute inset-0 aura-gradient opacity-0 group-hover:opacity-10 transition-opacity duration-500"></div>
                      )}
                      <span className="relative z-10">Begin Session</span>
                      <ArrowRight size={18} className="relative z-10 group-hover:translate-x-1 transition-transform" />
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
    // Legacy state — shouldn't happen anymore, but handle gracefully
    navigate('/thank-you', { replace: true });
    return null;
  }

  if (session) {
    return (
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
        language={language}
      />
    );
  }

  return null;
}
