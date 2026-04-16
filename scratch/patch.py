with open("src/pages/candidate/InterviewPortal.tsx", "r") as f:
    text = f.read()

import re

sseHelpers = """
async function* parseNextStepStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ type: string, payload: any }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\\n\\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const line = event.trim();
      if (!line.startsWith('event: ')) continue;
      const lines = line.split('\\n');
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
"""

text = text.replace("const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';", sseHelpers + "\nconst USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';")

target_str = """      const nextStep = await res.json();
      
      // Pure Server-Driven State!
      const updatedMemory = new InterviewMemory(session.claims, session.jobRoleContext);
      if (nextStep.transcript) {
        updatedMemory.restoreFromTranscript(nextStep.transcript);
      }
      setMemory(updatedMemory);
      
      setInterviewPhase('TECHNICAL'); // After any answer, we are technically in technical phase implicitly
      setCurrentQuestionId(crypto.randomUUID());
      setCurrentRequestId(crypto.randomUUID());
      setCurrentQuestion(nextStep.nextQuestion);
      
      if (nextStep.decision === 'END_INTERVIEW') {
         await speakQuestion(nextStep.spokenQuestion || nextStep.nextQuestion);
         navigate('/thank-you', { replace: true });
         return;
      }
      
      // 2. Stream AI voice back
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
      setVoiceState('idle');"""

replace_str = """      if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
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
      }"""

if target_str in text:
    text = text.replace(target_str, replace_str)
    with open("src/pages/candidate/InterviewPortal.tsx", "w") as f:
        f.write(text)
    print("Patched!")
else:
    print("Could not find Target string!")
