import React, { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import { InterviewScreen } from './components/InterviewScreen';
import ReportScreen from './components/ReportScreen';
import { 
  analyzeResume, 
  generateFirstQuestion, 
  getNextInterviewStep,
  generateReport, 
  CandidateInfo, 
  Claim, 
  InterviewReport,
  NextStep,
  StructuredInterviewTurn
} from './agent';
import { useAudio, generateTTSStream, generateTTS } from './voice';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

type AppState = 'SETUP' | 'ANALYZING' | 'INTERVIEWING' | 'REPORTING' | 'GENERATING_REPORT';

export interface ClaimHistory {
  claim: Claim | null;
  turns: {q: string, a: string, evaluation?: NextStep}[];
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('SETUP');
  const [jdText, setJdText] = useState('');
  
  // Interview Data
  const [candidateInfo, setCandidateInfo] = useState<CandidateInfo | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [currentClaimIndex, setCurrentClaimIndex] = useState(0);
  const [claimHistory, setClaimHistory] = useState<ClaimHistory[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [report, setReport] = useState<InterviewReport | null>(null);
  
  const [interviewPhase, setInterviewPhase] = useState<'INTRO' | 'TECHNICAL'>('INTRO');
  const [firstQuestionCache, setFirstQuestionCache] = useState<string | null>(null);
  const [firstSpokenQuestionCache, setFirstSpokenQuestionCache] = useState<string | null>(null);
  const firstQuestionPromiseRef = React.useRef<Promise<{question: string, spokenQuestion: string, rationale: string}> | null>(null);
  const firstQuestionAudioPromiseRef = React.useRef<Promise<string | null> | null>(null);
  
  // UI State
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const { playTTSStream, fallbackTTS, playTTS } = useAudio();
  
  const [loadingText, setLoadingText] = useState("Please wait while the AI prepares your interview...");
  const [reportLoadingText, setReportLoadingText] = useState("Generating your interview report...");
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  React.useEffect(() => {
    const checkKey = async () => {
      if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if ((window as any).aistudio && (window as any).aistudio.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  React.useEffect(() => {
    if (appState === 'ANALYZING') {
      const texts = [
        "Reading resume and job description...",
        "Cross-referencing skills and experience...",
        "Extracting key technical claims to verify...",
        "Prioritizing topics for deep-dive...",
        "Generating personalized interview strategy..."
      ];
      let i = 0;
      setLoadingText(texts[0]);
      const interval = setInterval(() => {
        i = (i + 1) % texts.length;
        setLoadingText(texts[i]);
      }, 2500);
      return () => clearInterval(interval);
    } else if (appState === 'GENERATING_REPORT') {
      const texts = [
        "Reviewing interview transcript...",
        "Evaluating technical depth and clarity...",
        "Identifying key strengths and risk flags...",
        "Calculating overall scores...",
        "Finalizing hiring recommendation..."
      ];
      let i = 0;
      setReportLoadingText(texts[0]);
      const interval = setInterval(() => {
        i = (i + 1) % texts.length;
        setReportLoadingText(texts[i]);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [appState]);

  const handleStart = async (resume: string | { inlineData: { data: string, mimeType: string } }, jd: string) => {
    setAppState('ANALYZING');
    setJdText(jd);
    
    try {
      // 1. Analyze Resume & JD
      const analysis = await analyzeResume(resume, jd);
      setCandidateInfo(analysis.candidateInfo);
      setClaims(analysis.prioritizedClaims);
      
      if (analysis.prioritizedClaims.length === 0) {
        throw new Error("No verifiable claims extracted from the resume.");
      }

      // 2. Pre-fetch First Technical Question in the background to reduce delay
      const firstClaim = analysis.prioritizedClaims[0];
      firstQuestionPromiseRef.current = generateFirstQuestion(analysis.candidateInfo, firstClaim, jd);
      firstQuestionPromiseRef.current
        .then(res => {
          setFirstQuestionCache(res.question);
          setFirstSpokenQuestionCache(res.spokenQuestion);
          firstQuestionAudioPromiseRef.current = generateTTS(res.spokenQuestion || res.question);
        })
        .catch(e => console.error("Failed to pre-fetch first question", e));
      
      // 3. Set Intro Question
      const firstName = analysis.candidateInfo.name.split(' ')[0];
      const introQuestion = `你好 ${firstName}，我是你的AI面试官。感谢你今天抽出时间。在我们开始讨论你的技术经历之前，你能先简单做个自我介绍吗？`;
      
      setCurrentQuestion(introQuestion);
      setInterviewPhase('INTRO');
      setAppState('INTERVIEWING');
      
      // 4. Play TTS for intro question
      await speakQuestion(introQuestion);

    } catch (error) {
      console.error("Setup failed:", error);
      alert("Failed to initialize interview. Please check the console and try again.");
      setAppState('SETUP');
    }
  };

  const speakQuestion = async (text: string) => {
    setIsPreparingAudio(true);
    
    try {
      const audioStream = generateTTSStream(text);
      
      // We don't know if it will succeed until we get the first chunk or an error
      // So we pass a callback to playTTSStream to know when playback actually starts
      await playTTSStream(audioStream, () => {
        setIsPreparingAudio(false);
        setIsAiSpeaking(true);
      });
      
    } catch (error) {
      // Fallback to browser native TTS if Gemini TTS fails (e.g. quota exceeded)
      setIsPreparingAudio(false);
      setIsAiSpeaking(true);
      await fallbackTTS(text);
    }
    
    setIsPreparingAudio(false);
    setIsAiSpeaking(false);
  };

  const handleSilenceTimeout = async (level: 'voice' | 'skip') => {
    // If the AI is already speaking, evaluating, or preparing audio, don't interrupt
    if (isAiSpeaking || isEvaluating || isPreparingAudio) return;
    
    if (level === 'voice') {
      const reminder = "你还在听吗？如果需要更多时间思考，或者需要我重复问题，请随时告诉我。";
      await speakQuestion(reminder);
    } else if (level === 'skip') {
      await handleAnswerSubmit("（候选人长时间未作答，跳过此问题）");
    }
  };

  const handleAnswerSubmit = async (answer: string) => {
    setIsEvaluating(true);
    
    if (interviewPhase === 'INTRO') {
      try {
        const newClaimHistory = [...claimHistory];
        if (newClaimHistory.length === 0) {
          newClaimHistory.push({ claim: null, turns: [] });
        }
        newClaimHistory[0].turns.push({ q: currentQuestion, a: answer });
        
        // Add the first technical claim
        newClaimHistory.push({ claim: claims[0], turns: [] });

        let nextQ = firstQuestionCache;
        let nextSpokenQ = firstSpokenQuestionCache;
        let prefetchAudio: string | null = null;
        
        if (!nextQ && firstQuestionPromiseRef.current) {
          const res = await firstQuestionPromiseRef.current;
          nextQ = res.question;
          nextSpokenQ = res.spokenQuestion;
        } else if (!nextQ) {
          const firstClaim = claims[0];
          const res = await generateFirstQuestion(candidateInfo!, firstClaim, jdText);
          nextQ = res.question;
          nextSpokenQ = res.spokenQuestion;
        }
        
        if (firstQuestionAudioPromiseRef.current) {
          prefetchAudio = await firstQuestionAudioPromiseRef.current;
        }
        
        setClaimHistory(newClaimHistory);
        setInterviewPhase('TECHNICAL');
        setCurrentQuestion(nextQ);
        setIsEvaluating(false);
        
        if (prefetchAudio) {
          setIsAiSpeaking(true);
          await playTTS(prefetchAudio);
          setIsAiSpeaking(false);
        } else {
          await speakQuestion(nextSpokenQ || nextQ);
        }
      } catch (error) {
        console.error("Failed to transition to technical phase:", error);
        setIsEvaluating(false);
        await speakQuestion("抱歉，我的网络好像有点问题，没能听清。你能再重复一下刚才的回答吗？");
      }
      return;
    }

    try {
      const currentClaim = claims[currentClaimIndex];
      const nextClaim = currentClaimIndex + 1 < claims.length ? claims[currentClaimIndex + 1] : null;
      
      const newClaimHistory = [...claimHistory];
      const currentClaimState = newClaimHistory[newClaimHistory.length - 1];
      currentClaimState.turns.push({ q: currentQuestion, a: answer });
      
      const flatHistory = newClaimHistory.flatMap(ch => ch.turns);

      // Enforce max questions per claim (e.g., 2)
      const questionsForCurrentClaim = currentClaimState.turns.length;
      const followUpCountForCurrentClaim = Math.max(0, questionsForCurrentClaim - 1);
      const maxFollowUpsPerClaim = 2;
      const hardLimitFollowUps = 3;
      const isLastClaim = !nextClaim;
      const isLastQuestionForClaim = followUpCountForCurrentClaim >= hardLimitFollowUps;
      const isLastQuestionOverall = isLastClaim && followUpCountForCurrentClaim === maxFollowUpsPerClaim - 1;

      const prevTurn = currentClaimState.turns.length >= 2 ? currentClaimState.turns[currentClaimState.turns.length - 2] : null;
      const previousAnswerStatus = prevTurn?.evaluation?.answerStatus || null;
      const previouslyMissingPoints = prevTurn?.evaluation?.missingPoints || [];
      const previouslyCoveredPoints = prevTurn?.evaluation?.coveredPoints || [];
      const questionsAskedForCurrentClaim = currentClaimState.turns.map(t => t.q);

      let nextStep: NextStep;
      
      if (isLastQuestionForClaim) {
        if (isLastClaim) {
          nextStep = {
            decision: 'END_INTERVIEW',
            answerStatus: 'answered',
            nextQuestion: "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            spokenQuestion: "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！",
            decisionRationale: "Reached question limit for the final claim.",
            missingPoints: [],
            coveredPoints: [],
            lightweightScores: {
              relevance: 0,
              specificity: 0,
              technicalDepth: 0,
              ownership: 0,
              evidence: 0
            }
          };
        } else {
          // Force move to next claim
          let repeatCount = 0;
          for (let i = flatHistory.length - 1; i >= 0; i--) {
            if (flatHistory[i].q === currentQuestion) {
              repeatCount++;
            } else {
              break;
            }
          }
          // Calculate consecutive non-answers for the current claim
          let consecutiveNonAnswers = 0;
          for (let i = currentClaimState.turns.length - 2; i >= 0; i--) { // Start from previous turn
            if (currentClaimState.turns[i].evaluation?.answerStatus === 'non_answer') {
              consecutiveNonAnswers++;
            } else {
              break;
            }
          }

          nextStep = await getNextInterviewStep(
            currentQuestion,
            answer,
            currentClaim,
            nextClaim,
            jdText,
            flatHistory,
            false,
            repeatCount,
            true, // forceNextClaim
            followUpCountForCurrentClaim,
            questionsForCurrentClaim,
            maxFollowUpsPerClaim,
            consecutiveNonAnswers,
            previousAnswerStatus,
            previouslyMissingPoints,
            previouslyCoveredPoints,
            questionsAskedForCurrentClaim
          );
        }
      } else {
        // Calculate how many times the current question has been asked consecutively
        let repeatCount = 0;
        for (let i = flatHistory.length - 1; i >= 0; i--) {
          if (flatHistory[i].q === currentQuestion) {
            repeatCount++;
          } else {
            break;
          }
        }

        // Calculate consecutive non-answers for the current claim
        let consecutiveNonAnswers = 0;
        for (let i = currentClaimState.turns.length - 2; i >= 0; i--) { // Start from previous turn
          if (currentClaimState.turns[i].evaluation?.answerStatus === 'non_answer') {
            consecutiveNonAnswers++;
          } else {
            break;
          }
        }

        // Get the next step
        nextStep = await getNextInterviewStep(
          currentQuestion,
          answer,
          currentClaim,
          nextClaim,
          jdText,
          flatHistory,
          isLastQuestionOverall,
          repeatCount,
          false,
          followUpCountForCurrentClaim,
          questionsForCurrentClaim,
          maxFollowUpsPerClaim,
          consecutiveNonAnswers,
          previousAnswerStatus,
          previouslyMissingPoints,
          previouslyCoveredPoints,
          questionsAskedForCurrentClaim
        );
      }
      
      // Assign evaluation to the current turn
      currentClaimState.turns[currentClaimState.turns.length - 1].evaluation = nextStep;

      // Check if we should end the interview
      if (nextStep.decision === 'END_INTERVIEW' || (nextStep.decision === 'NEXT_CLAIM' && !nextClaim)) {
        
        // If the AI returned NEXT_CLAIM but there are no more claims, force a generic closing statement
        let closingStatement = nextStep.nextQuestion;
        let spokenClosingStatement = nextStep.spokenQuestion || nextStep.nextQuestion;
        if (nextStep.decision === 'NEXT_CLAIM' && !nextClaim) {
            closingStatement = "非常感谢你的回答。我们今天的面试就到此结束了，感谢你抽出时间与我交流。后续如果有任何进展，我们的招聘团队会与你联系。祝你生活愉快，再见！";
            spokenClosingStatement = closingStatement;
        }

        if (closingStatement) {
          setCurrentQuestion(closingStatement);
          setIsEvaluating(false);
          await speakQuestion(spokenClosingStatement);
        }
        
        setClaimHistory(newClaimHistory);
        await finishInterview(flatHistory);
        return;
      }

      // Update state for next turn
      if (nextStep.decision === 'NEXT_CLAIM') {
        setCurrentClaimIndex(prev => prev + 1);
        newClaimHistory.push({ claim: nextClaim, turns: [] });
      }
      
      setClaimHistory(newClaimHistory);
      setCurrentQuestion(nextStep.nextQuestion);
      setIsEvaluating(false);
      
      // Speak next question
      await speakQuestion(nextStep.spokenQuestion || nextStep.nextQuestion);

    } catch (error) {
      console.error("Evaluation failed:", error);
      setIsEvaluating(false);
      await speakQuestion("抱歉，我的网络好像有点问题，没能听清。你能再重复一下刚才的回答吗？");
    }
  };

      const finishInterview = async (finalHistory: {q: string, a: string, evaluation?: NextStep}[]) => {
    setAppState('GENERATING_REPORT');
    try {
      const structuredTranscript: StructuredInterviewTurn[] = [];
      claimHistory.forEach((claimState) => {
        claimState.turns.forEach((turn, turnIndex) => {
          structuredTranscript.push({
            question: turn.q,
            answer: turn.a,
            claimId: claimState.claim?.id,
            claimText: claimState.claim?.claim,
            experienceName: claimState.claim?.experienceName,
            turnType: claimState.claim === null ? "intro" : (turnIndex === 0 ? "main" : "follow_up"),
            answerStatus: turn.evaluation?.answerStatus
          });
        });
      });

      const finalReport = await generateReport(structuredTranscript, claims);
      setReport(finalReport);
      setAppState('REPORTING');
    } catch (error) {
      console.error("Report generation failed:", error);
      alert("Failed to generate report.");
      setAppState('SETUP');
    }
  };

  const handleRestart = () => {
    setAppState('SETUP');
    setCandidateInfo(null);
    setClaims([]);
    setCurrentClaimIndex(0);
    setClaimHistory([]);
    setCurrentQuestion('');
    setReport(null);
    setInterviewPhase('INTRO');
    setFirstQuestionCache(null);
    setFirstSpokenQuestionCache(null);
    firstQuestionPromiseRef.current = null;
    firstQuestionAudioPromiseRef.current = null;
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {hasApiKey === false && (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">API Key Required</h2>
          <p className="text-gray-600 max-w-md mb-8">
            To use the advanced Pro models without strict quota limits, please select your Google Cloud API Key.
            <br/><br/>
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              Learn about billing and API keys
            </a>
          </p>
          <button 
            onClick={handleSelectKey}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            Select API Key
          </button>
        </div>
      )}

      {hasApiKey === true && appState === 'SETUP' && (
        <SetupScreen onStart={handleStart} isLoading={false} />
      )}
      
      {hasApiKey === true && appState === 'ANALYZING' && (
        <div className="min-h-screen flex flex-col items-center justify-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="mb-6 text-indigo-600"
          >
            <Loader2 size={48} />
          </motion.div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Analyzing Profile & Generating Plan</h2>
          <motion.p 
            key={loadingText}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-gray-500"
          >
            {loadingText}
          </motion.p>
        </div>
      )}

      {hasApiKey === true && appState === 'GENERATING_REPORT' && (
        <div className="min-h-screen flex flex-col items-center justify-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="mb-6 text-indigo-600"
          >
            <Loader2 size={48} />
          </motion.div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Generating Interview Report</h2>
          <motion.p 
            key={reportLoadingText}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-gray-500"
          >
            {reportLoadingText}
          </motion.p>
        </div>
      )}

      {hasApiKey === true && appState === 'INTERVIEWING' && candidateInfo && (
        <InterviewScreen 
          candidateInfo={candidateInfo}
          currentQuestion={currentQuestion}
          isAiSpeaking={isAiSpeaking}
          isEvaluating={isEvaluating}
          isPreparingAudio={isPreparingAudio}
          onAnswerSubmit={handleAnswerSubmit}
          onSilenceTimeout={handleSilenceTimeout}
        />
      )}

      {hasApiKey === true && appState === 'REPORTING' && report && candidateInfo && (
        <ReportScreen 
          report={report}
          candidateInfo={candidateInfo}
          history={claimHistory.flatMap(ch => ch.turns)}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
