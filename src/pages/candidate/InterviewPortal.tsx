import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { db, InterviewSession } from '../../lib/db';
import { InterviewScreen } from '../../components/InterviewScreen';
import { 
  InterviewMemory, 
  generateFirstQuestion, 
  getNextInterviewStep,
  generateReport,
  NextStep,
  StructuredInterviewTurn,
  TurnType
} from '../../agent';
import { getAuthHeaders, setInterviewContext } from '../../agent/core';
import { useAudio, generateTTSStream, generateTTS } from '../../voice';
import { Loader2, Camera as CameraIcon, Mic, Wifi, ArrowRight, Check } from 'lucide-react';

const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';

type SystemCheckState = 'idle' | 'checking' | 'completed';
type VoiceState = 'idle' | 'evaluating' | 'preparing' | 'speaking' | 'reminder';

export default function InterviewPortal() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [appState, setAppState] = useState<'LOADING' | 'READY' | 'INTERVIEWING' | 'GENERATING_REPORT'>('LOADING');
  
  const [memory, setMemory] = useState<InterviewMemory | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentQuestionId, setCurrentQuestionId] = useState<string>(() => crypto.randomUUID());
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
  const { playTTSStream, fallbackTTS, playTTS, stopAudio } = useAudio();

  // Derived booleans for child component props (computed each render, never stale)
  const isEvaluating = voiceState === 'evaluating';
  const isPreparingAudio = voiceState === 'preparing';
  const isAiSpeaking = voiceState === 'speaking' || voiceState === 'reminder';
  const isReminderSpeaking = voiceState === 'reminder';
  
  // Pre-fetching caches
  const [firstQuestionCache, setFirstQuestionCache] = useState<string | null>(null);
  const [firstSpokenQuestionCache, setFirstSpokenQuestionCache] = useState<string | null>(null);
  const firstQuestionPromiseRef = useRef<Promise<{question: string, spokenQuestion: string, rationale: string}> | null>(null);
  const firstQuestionAudioPromiseRef = useRef<Promise<string | null> | null>(null);
  const introAudioPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    const loadSessionData = async () => {
      if (id) {
        const loadSession = await db.getSession(id);
        if (!loadSession) {
          alert("Invalid Interview Link");
          return;
        }
        if (loadSession.status === 'COMPLETED') {
          navigate('/thank-you', { replace: true });
          return;
        }

        // C1 fix: Block access if session is already being used by another candidate
        if (loadSession.status === 'IN_PROGRESS') {
          alert('This interview session is already in progress.');
          navigate('/', { replace: true });
          return;
        }

        // C3 fix: Verify invite token before granting access
        const urlToken = searchParams.get('token');
        if (loadSession.inviteToken && urlToken !== loadSession.inviteToken) {
          alert('Invalid or missing interview token. Please use the link provided by HR.');
          navigate('/', { replace: true });
          return;
        }

        // Check for 24-hour expiration on PENDING sessions
        if (loadSession.status === 'PENDING') {
          const _24HOURS = 24 * 60 * 60 * 1000;
          if (Date.now() - loadSession.createdAt > _24HOURS) {
            alert('This interview link has expired (valid for 24 hours only).');
            navigate('/', { replace: true });
            return;
          }
        }
        
        setSession(loadSession);

        // Set interview context for candidate API auth (invite token)
        if (urlToken && loadSession.id) {
          setInterviewContext(loadSession.id, urlToken);
        }

        const mem = new InterviewMemory(loadSession.claims, loadSession.jobRoleContext);
        setMemory(mem);
        
        // Pre-fetch first question silently
        const firstClaim = loadSession.claims[0];
        if (firstClaim) {
          firstQuestionPromiseRef.current = generateFirstQuestion(loadSession.candidateInfo, firstClaim, loadSession.jdText);
          firstQuestionPromiseRef.current
            .then(res => {
              setFirstQuestionCache(res.question);
              setFirstSpokenQuestionCache(res.spokenQuestion);
              firstQuestionAudioPromiseRef.current = generateTTS(res.spokenQuestion || res.question);
            })
            .catch(e => console.error("Failed to pre-fetch first question", e));
        }

        // Pre-fetch intro question TTS (text is known ahead of time)
        const firstName = loadSession.candidateInfo.name.split(' ')[0];
        const introText = `你好 ${firstName}，我是你的AI面试官。感谢你今天抽出时间。在我们开始讨论你的技术经历之前，你能先简单做个自我介绍吗？`;
        introAudioPromiseRef.current = generateTTS(introText);

        setAppState('READY');
      }
    };
    loadSessionData();
  }, [id, navigate]);

  // Handle page closure / refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (appState === 'INTERVIEWING' && id) {
        db.markNotFinished(id);
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
    
    // Trigger live HR dashboard notification
    await db.startSession(id);
    setSessionStartTime(Date.now());

    const firstName = session.candidateInfo.name.split(' ')[0];
    const introQuestion = `你好 ${firstName}，我是你的AI面试官。感谢你今天抽出时间。在我们开始讨论你的技术经历之前，你能先简单做个自我介绍吗？`;
    
    setCurrentQuestion(introQuestion);
    setAppState('INTERVIEWING');

    // Use pre-fetched intro audio for instant playback
    let introAudio: string | null = null;
    if (introAudioPromiseRef.current) {
      try {
        introAudio = await introAudioPromiseRef.current;
      } catch (e) {
        console.warn("Intro TTS pre-fetch failed, will use streaming:", e);
      }
    }
    if (introAudio) {
      setVoiceState('speaking');
      await playTTS(introAudio);
      setVoiceState('idle');
    } else {
      await speakQuestion(introQuestion);
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

  const syncTranscript = (updatedMemory: InterviewMemory) => {
    if (!id) return;
    const structuredTranscript: StructuredInterviewTurn[] = [];
    
    updatedMemory.getIntroTurns().forEach((turn) => {
      structuredTranscript.push({
        questionId: turn.questionId,
        timestamp: turn.timestamp,
        question: turn.q,
        answer: turn.a,
        turnType: turn.turnType as any,
        answerStatus: turn.evaluation?.answerStatus
      });
    });
    
    updatedMemory.getClaimStates().forEach((claimState) => {
      claimState.turns.forEach((turn, turnIndex) => {
        structuredTranscript.push({
          questionId: turn.questionId,
          timestamp: turn.timestamp,
          question: turn.q,
          answer: turn.a,
          claimId: claimState.claim.id,
          claimText: claimState.claim.claim,
          experienceName: claimState.claim.experienceName,
          turnType: turn.turnType as any,
          answerStatus: turn.evaluation?.answerStatus
        });
      });
    });
    
    db.updateTranscript(id, structuredTranscript);
    return structuredTranscript;
  };

  const handleAnswerSubmit = async (answer: string) => {
    if (voiceState !== 'idle') return; // Guard: only accept answers when idle
    setVoiceState('evaluating');
    
    if (interviewPhase === 'INTRO') {
      try {
         // Initialize Intro Phase locally, then create a new memory object to trigger React re-render
         const updatedMemory = Object.assign(Object.create(Object.getPrototypeOf(memory)), memory);
         updatedMemory.initializeIntroPhase(currentQuestion, answer, currentQuestionId);
         
         let nextQ = firstQuestionCache;
         let nextSpokenQ = firstSpokenQuestionCache;
         let prefetchAudio: string | null = null;
         
         if (!nextQ && firstQuestionPromiseRef.current) {
           const res = await firstQuestionPromiseRef.current;
           nextQ = res.question;
           nextSpokenQ = res.spokenQuestion;
         } else if (!nextQ) {
           const firstClaim = memory!.getClaims()[0];
           const res = await generateFirstQuestion(session!.candidateInfo, firstClaim, session!.jdText);
           nextQ = res.question;
           nextSpokenQ = res.spokenQuestion;
         }
         
         if (firstQuestionAudioPromiseRef.current) {
           prefetchAudio = await firstQuestionAudioPromiseRef.current;
         }
         
         setMemory(updatedMemory);
         setInterviewPhase('TECHNICAL');
         setCurrentTurnType('main');
         setCurrentQuestionId(crypto.randomUUID());
         setCurrentQuestion(nextQ!);
         syncTranscript(updatedMemory);

         
         if (prefetchAudio) {
           setVoiceState('speaking');
           await playTTS(prefetchAudio);
           setVoiceState('idle');
         } else {
           await speakQuestion(nextSpokenQ || nextQ!);
         }
      } catch (e) {

        await speakQuestion("抱歉，网络出了点问题，能再重复一下吗？");
      }
      return;
    }

    try {
      const updatedMemory = Object.assign(Object.create(Object.getPrototypeOf(memory)), memory) as InterviewMemory;
      updatedMemory.addTurnToCurrentClaim(currentQuestion, answer, currentTurnType, currentQuestionId);
      
      const nextClaim = updatedMemory.getNextClaim();

      const followUpCountForCurrentClaim = updatedMemory.getFollowUpCountForCurrentClaim();
      const maxFollowUpsPerClaim = 2;
      const hardLimitFollowUps = 3;
      const isLastClaim = updatedMemory.isLastClaim();
      const isLastQuestionForClaim = followUpCountForCurrentClaim >= hardLimitFollowUps;
      const isLastQuestionOverall = isLastClaim && followUpCountForCurrentClaim === maxFollowUpsPerClaim - 1;

      // Time Limit Check (30 mins = 1800000 ms). 
      // If elapsed time >= 30 mins, we only have 5 mins left of the 35 min max, so force END_INTERVIEW.
      const elapsedMs = sessionStartTime ? Date.now() - sessionStartTime : 0;
      const maxElapsedMs = 30 * 60 * 1000;
      const isTimeNearlyUp = elapsedMs >= maxElapsedMs;

      let nextStep: NextStep;
      
      if (isTimeNearlyUp) {
         nextStep = {
            decision: 'END_INTERVIEW',
            answerStatus: 'answered',
            nextQuestion: "非常感谢你的回答。我们的面试时间差不多到了，今天就先交流到这里。感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            spokenQuestion: "非常感谢你的回答。我们的面试时间差不多到了，今天就先交流到这里。感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            decisionRationale: "Reached max time limit",
            missingPoints: [], coveredPoints: [], lightweightScores: { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0 }
         };
      } else if (isLastQuestionForClaim) {
        if (isLastClaim) {
          nextStep = {
            decision: 'END_INTERVIEW',
            answerStatus: 'answered',
            nextQuestion: "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            spokenQuestion: "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            decisionRationale: "Reached limit",
            missingPoints: [], coveredPoints: [], lightweightScores: { relevance: 0, specificity: 0, technicalDepth: 0, ownership: 0, evidence: 0 }
          };
        } else {
          nextStep = await getNextInterviewStep(currentQuestion, currentQuestionId, answer, updatedMemory, false, true, maxFollowUpsPerClaim);
        }
      } else {
        nextStep = await getNextInterviewStep(currentQuestion, currentQuestionId, answer, updatedMemory, isLastQuestionOverall, false, maxFollowUpsPerClaim);
      }
      
      updatedMemory.updateLatestTurnEvaluation(nextStep);
      
      let nextTurnType: TurnType = 'main';
      if (nextStep.decision === 'FOLLOW_UP') nextTurnType = 'follow_up';
      else if (nextStep.decision === 'REPEAT_QUESTION') {
        nextTurnType = nextStep.answerStatus === 'clarification_request' ? 'clarify' : 'repeat';
      }
      else if (nextStep.decision === 'NEXT_CLAIM') nextTurnType = 'main';
      else if (nextStep.decision === 'END_INTERVIEW') nextTurnType = 'transition';
      
      if (nextStep.decision === 'END_INTERVIEW' || (nextStep.decision === 'NEXT_CLAIM' && !nextClaim)) {
        let closingStatement = nextStep.nextQuestion;
        let spokenClosingStatement = nextStep.spokenQuestion || nextStep.nextQuestion;
        if (nextStep.decision === 'NEXT_CLAIM' && !nextClaim) {
            closingStatement = "非常感谢你的回答。我们今天的面试就到此结束了。祝你生活愉快，再见！";
            spokenClosingStatement = closingStatement;
        }

        if (closingStatement) {
          setCurrentTurnType('transition');
          setCurrentQuestionId(crypto.randomUUID());
          setCurrentQuestion(closingStatement);
          syncTranscript(updatedMemory);
          await speakQuestion(spokenClosingStatement);
        }
        
        setMemory(updatedMemory);
        await finishInterview(updatedMemory);
        return;
      }

      updatedMemory.determineStatusAndAdvance(nextStep.decision);
      
      // PIPELINE OVERLAP: Fire TTS generation BEFORE state updates.
      // generateTTSStream opens the SSE connection immediately, so the server
      // starts generating audio while we're doing the fast in-memory state updates below.
      const textToSpeak = nextStep.spokenQuestion || nextStep.nextQuestion;
      const audioStream = generateTTSStream(textToSpeak);
      
      // State updates (fast, ~1ms) — happen while TTS is already generating on the server
      setMemory(updatedMemory);
      setCurrentTurnType(nextTurnType);
      setCurrentQuestionId(crypto.randomUUID());
      setCurrentQuestion(nextStep.nextQuestion);
      syncTranscript(updatedMemory);
      
      // Now play the audio stream (first chunks may already be available)
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

    } catch (error) {
      console.error("Evaluation failed", error);
      await speakQuestion("抱歉，我的网络好像有点问题，没能听清。你能再重复一下刚才的回答吗？");
    }
  };

  const handleSilenceTimeout = async (level: 'voice' | 'skip') => {
    if (voiceState !== 'idle') return;
    if (level === 'voice') {
      await speakQuestion("你还在听吗？如果需要更多时间思考，请随时告诉我。", true);
    } else if (level === 'skip') {
      await handleAnswerSubmit("（候选人长时间未作答，跳过此问题）");
    }
  };

  const finishInterview = async (finalMemory: InterviewMemory) => {
    if (!id || !session) return;
    setAppState('GENERATING_REPORT');
    
    try {
      // Sync the final transcript
      const finalTranscript = syncTranscript(finalMemory);

      if (USE_LOCAL) {
        // Local dev: generate report client-side since server can't access localStorage
        const report = await generateReport(
          finalTranscript || [],
          session.claims
        );
        await db.completeSession(id, report);
      } else {
        // Production: generate report server-side — the endpoint pulls session data from
        // Supabase directly (not from the client), preventing tampering.
        const baseUrl = `${window.location.origin}/api`;
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`${baseUrl}/generate-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ sessionId: id })
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Report generation failed: ${response.status} - ${errorBody}`);
        }
      }

      // Navigate to candidate end screen
      navigate('/thank-you', { replace: true });
    } catch (e) {
      console.error("Failed to generate report", e);
      alert("Error finalizing interview.");
    }
  };

  const handleEndSession = async () => {
    stopAudio();
    setVoiceState('idle');
    if (memory && id) {
      const isActuallyFinished = memory.getIsInterviewEnded();
      if (isActuallyFinished) {
        await finishInterview(memory);
      } else {
        db.markNotFinished(id);
        navigate('/thank-you', { replace: true });
      }
    }
  };

  if (appState === 'LOADING') {
    return <div className="min-h-screen flex items-center justify-center">Loading Interview...</div>;
  }

  if (appState === 'READY' && session) {
    // Hardcoded estimated time based on user request
    const estimatedMinutes = 30;
    
    return (
      <div className="min-h-screen bg-white text-[#1A1A1A] font-[Montserrat] flex flex-col border-t-[6px] border-[#118C33]">
        {/* Header */}
        <header className="px-8 py-6 border-b-2 border-[#8DC63F] flex justify-between items-center bg-white">
          <img src="/fuling-logo.png" alt="FULING" className="h-[2.8rem] object-contain" />
          <div className="text-xs uppercase tracking-[0.05em] font-semibold text-[#555555]">Interview Platform</div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex justify-center items-start py-12 px-8">
          <div className="w-full max-w-[900px] animate-[fadeIn_0.4s_ease-out]">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
              
              {/* Left Column: Intro */}
              <div className="space-y-8">
                <div>
                  <h1 className="text-[2.2rem] tracking-wide uppercase font-light text-[#1A1A1A] mb-6 leading-tight after:content-[''] after:block after:w-[100px] after:h-[4px] after:mt-6 after:bg-gradient-to-r after:from-[#118C33] after:via-[#8DC63F] after:to-[#118C33]">
                    Welcome to your AI Interview
                  </h1>
                  <p className="text-lg text-[#555555] font-normal leading-relaxed">
                    This is a recorded session where you will answer a series of questions presented by our AI interviewer for the <strong className="text-[#1A1A1A] font-medium">{session.jobRoleContext || 'Developer'}</strong> position. The process is designed to be straightforward and comfortable.
                  </p>
                </div>
                
                <ul className="space-y-4">
                  <li className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-[#118C33] text-white flex items-center justify-center shrink-0 mt-1">
                      <Check size={14} strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-[#1A1A1A] font-medium block">Pace yourself</strong>
                      <span className="text-sm text-[#555555]">You will have time to read the question before recording your answer.</span>
                    </div>
                  </li>
                  <li className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-[#118C33] text-white flex items-center justify-center shrink-0 mt-1">
                      <Check size={14} strokeWidth={3} />
                    </div>
                    <div>
                      <strong className="text-[#1A1A1A] font-medium block">~{estimatedMinutes} Minutes Duration</strong>
                      <span className="text-sm text-[#555555]">We will cover your background and {session.claims.length} specific experiences.</span>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Right Column: System Check Card */}
              <div className="bg-[#F7F7F7] p-8 rounded border border-[#EAEAEA]">
                <h3 className="text-xl font-light text-[#1A1A1A] mb-6">System Check</h3>
                
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-4 border-b border-[#EAEAEA]">
                    <div className="flex items-center gap-3">
                      <CameraIcon className="text-[#555555]" size={20} />
                      <div>
                        <div className="text-[#1A1A1A] font-medium">Camera</div>
                        <div className="text-sm text-[#555555]">Detected</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[#1A1A1A] font-medium">
                      {cameraCheck === 'idle' && <span className="text-sm font-normal text-gray-400">Pending</span>}
                      {cameraCheck === 'checking' && <Loader2 size={16} className="animate-spin text-[#8DC63F]" />}
                      {cameraCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-[#8DC63F]"></div> Ready</>}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center py-4 border-b border-[#EAEAEA]">
                    <div className="flex items-center gap-3">
                      <Mic className="text-[#555555]" size={20} />
                      <div>
                        <div className="text-[#1A1A1A] font-medium">Microphone</div>
                        <div className="text-sm text-[#555555]">Default input</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[#1A1A1A] font-medium">
                      {micCheck === 'idle' && <span className="text-sm font-normal text-gray-400">Pending</span>}
                      {micCheck === 'checking' && <Loader2 size={16} className="animate-spin text-[#8DC63F]" />}
                      {micCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-[#8DC63F]"></div> Ready</>}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center py-4">
                    <div className="flex items-center gap-3">
                      <Wifi className="text-[#555555]" size={20} />
                      <div>
                        <div className="text-[#1A1A1A] font-medium">Connection</div>
                        <div className="text-sm text-[#555555]">Stable</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[#1A1A1A] font-medium">
                      {networkCheck === 'idle' && <span className="text-sm font-normal text-gray-400">Pending</span>}
                      {networkCheck === 'checking' && <Loader2 size={16} className="animate-spin text-[#8DC63F]" />}
                      {networkCheck === 'completed' && <><div className="w-2 h-2 rounded-full bg-[#8DC63F]"></div> Ready</>}
                    </div>
                  </div>
                </div>
                
                {systemCheck !== 'completed' ? (
                  <button 
                    onClick={handleSystemCheck}
                    disabled={systemCheck === 'checking'}
                    className={`w-full mt-8 py-3 px-6 rounded-sm font-semibold text-base uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border-none ${
                        systemCheck === 'checking' 
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                          : 'bg-[#118C33] hover:bg-[#0E7329] text-white cursor-pointer'
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
                      <div className="w-full mb-4 p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm font-medium">
                        Microphone access is required for the interview. Please grant permission and try again.
                      </div>
                    )}
                    <button 
                      onClick={handleStartInterview}
                      disabled={systemCheckFailed}
                      className={`w-full mt-4 py-3 px-6 rounded-sm font-semibold text-base uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border-none animate-[fadeIn_0.3s_ease-out] ${
                        systemCheckFailed
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-[#118C33] hover:bg-[#0E7329] text-white cursor-pointer'
                      }`}
                    >
                      Begin Session
                      <ArrowRight size={18} />
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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600 mb-6" size={48} />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Wrapping up interview...</h2>
        <p className="text-gray-500">Please wait while we finalize your responses.</p>
      </div>
    );
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
      />
    );
  }

  return null;
}
