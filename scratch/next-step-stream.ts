    const ai = getAI();
    const llmStartTime = Date.now();
    let streamResponse: any;

    try {
      streamResponse = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: userData,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              spokenQuestion: { type: "STRING" },
              nextQuestion: { type: "STRING" },
              answerStatus: { type: "STRING", description: "answered, partial, clarification_request, or non_answer" },
              decision: { type: "STRING", description: "FOLLOW_UP, NEXT_CLAIM, REPEAT_QUESTION, or END_INTERVIEW" },
              followUpIntent: { type: "STRING", description: "CLARIFY_GAP, DEEPEN, or CHALLENGE" },
              decisionRationale: { type: "STRING" },
              coveredPoints: { type: "ARRAY", items: { type: "STRING" } },
              missingPoints: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["spokenQuestion", "nextQuestion", "answerStatus", "decision", "decisionRationale", "coveredPoints", "missingPoints"]
          }
        }
      });
    } catch (llmError: any) {
      logLLMUsage(supabaseAdmin, {
        sessionId, requestId, endpoint: 'next-step', model: 'gemini-3-flash-preview',
        billingMode: 'text', latencyMs: Date.now() - llmStartTime,
        success: false, errorCode: llmError.message || 'LLM_ERROR'
      });
      throw llmError;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        let inSpokenQuestion = false;
        let spokenQuestionBuffer = "";
        let lastSentIndex = 0;
        let segmentIndex = 0;
        let finalJsonString = "";
        
        try {
          for await (const chunk of streamResponse) {
            const textChunk = chunk.text();
            buffer += textChunk;
            finalJsonString += textChunk;

            // Opportunistic streaming of spokenQuestion
            if (!inSpokenQuestion) {
               const match = buffer.match(/"spokenQuestion"\s*:\s*"/);
               if (match) {
                 inSpokenQuestion = true;
               }
            }
            
            if (inSpokenQuestion) {
               // Safely capture whatever is inside spokenQuestion so far
               const match = buffer.match(/"spokenQuestion"\s*:\s*"((?:\\.|[^"\\])*)/);
               if (match) {
                 spokenQuestionBuffer = match[1];
                 
                 // Split into sentences using punctuation boundaries
                 // matches chunk ends with . ? ! followed maybe by space
                 const sentenceSplitter = /([^.?!。？！]+[.?!。？！]+["']?\s*)/g;
                 let sentMatch;
                 let sentences = [];
                 while ((sentMatch = sentenceSplitter.exec(spokenQuestionBuffer)) !== null) {
                    sentences.push(sentMatch[0]);
                 }
                 
                 while (sentences.length > lastSentIndex) {
                    const sentenceToSend = sentences[lastSentIndex].trim();
                     // Basic unescaping for JSON string
                    const cleanSentence = sentenceToSend.replace(/\\n/g, ' ').replace(/\\"/g, '"');
                    
                    if (cleanSentence.length > 0) {
                      controller.enqueue(encoder.encode(`event: sentence\ndata: ${JSON.stringify({ text: cleanSentence, segmentIndex })}\n\n`));
                      segmentIndex++;
                    }
                    lastSentIndex++;
                 }
               }
               // Check if the property has closed
               // It's closed if there's an unescaped quote at the end
               if (buffer.match(/"spokenQuestion"\s*:\s*"((?:\\.|[^"\\])*)["']/)) {
                 inSpokenQuestion = false;
               }
            }
          }
          
          const llmLatencyMs = Date.now() - llmStartTime;
          // Note: exact token metadata is not always present on generateContentStream events, 
          // we use approximate or extract if available on the last chunk.
          const usageMeta = { promptTokenCount: Math.ceil(userData.length / 4), responseTokenCount: Math.ceil(finalJsonString.length / 4) }; 

          // Fire-and-forget: log LLM usage
          logLLMUsage(supabaseAdmin, {
            sessionId, requestId, endpoint: 'next-step', model: 'gemini-3-flash-preview',
            billingMode: 'text', latencyMs: llmLatencyMs, success: true,
            ...usageMeta
          });

          // Parse the full completion
          let rawText = finalJsonString.trim().replace(/```json/gi, '').replace(/```/g, '');
          parsed = JSON.parse(rawText);

          // Apply overrides safely
          const mustVerifyPoints = currentClaim.mustVerify || [];
          parsed.coveredPoints = (parsed.coveredPoints || []).filter((p: string) => mustVerifyPoints.includes(p));
          parsed.missingPoints = (parsed.missingPoints || []).filter((p: string) => mustVerifyPoints.includes(p) && !parsed.coveredPoints.includes(p));

          let decisionOverridden = false;
          if (parsed.answerStatus === 'clarification_request' && repeatCountForCurrentQuestion === 0 && parsed.decision !== 'REPEAT_QUESTION') {
            parsed.decision = 'REPEAT_QUESTION'; parsed.nextQuestion = question; parsed.spokenQuestion = question; decisionOverridden = true;
          } else if (forceNextClaim && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
            parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW'; decisionOverridden = true;
          } else if (parsed.answerStatus === 'non_answer' && consecutiveNonAnswers >= 1 && parsed.decision !== 'NEXT_CLAIM' && parsed.decision !== 'END_INTERVIEW') {
            parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW'; decisionOverridden = true;
          } else if ((parsed.answerStatus === 'partial' || parsed.answerStatus === 'answered') && totalQuestionsAskedForCurrentClaim < minQuestionsPerClaim && (parsed.decision === 'NEXT_CLAIM' || parsed.decision === 'END_INTERVIEW') && !forceNextClaim) {
            parsed.decision = 'FOLLOW_UP'; decisionOverridden = true;
          } else if (followUpCountForCurrentClaim >= maxFollowUpsPerClaim && parsed.decision === 'FOLLOW_UP') {
            const hasMissing = (parsed.missingPoints || []).length > 0;
            if (!hasMissing || followUpCountForCurrentClaim >= hardLimitFollowUps) {
              parsed.decision = nextClaim ? 'NEXT_CLAIM' : 'END_INTERVIEW'; decisionOverridden = true;
            }
          } else if (!nextClaim && parsed.decision === 'NEXT_CLAIM') {
            parsed.decision = 'END_INTERVIEW'; decisionOverridden = true;
          }

          if (decisionOverridden) {
            if (parsed.decision === 'NEXT_CLAIM' && nextClaim) {
              parsed.nextQuestion = language === 'zh-CN' ? `好的。接下来聊聊另一段经历：${nextClaim.experienceName}。关于"${nextClaim.claim}"，能详细说说吗？` : `Alright. Let's move to ${nextClaim.experienceName}. Could you elaborate on "${nextClaim.claim}"?`;
              parsed.spokenQuestion = parsed.nextQuestion;
            } else if (parsed.decision === 'END_INTERVIEW') {
              parsed.nextQuestion = language === 'zh-CN' ? "非常感谢你的回答。我们今天的面试就到此结束了。祝你生活愉快，再见！" : "Thank you for your answers. We will conclude our interview here for today. Have a great day, goodbye!";
              parsed.spokenQuestion = parsed.nextQuestion;
            } else if (parsed.decision === 'FOLLOW_UP') {
              parsed.nextQuestion = language === 'zh-CN' ? "关于这一点，你能再深入讲讲技术细节吗？" : "Regarding that, could you dive deeper into the technical details?";
              parsed.spokenQuestion = parsed.nextQuestion;
            }
          }

          // Atomic insertion logic
          const turnType = parsed.decision === 'NEXT_CLAIM' ? 'transition' : (parsed.decision === 'REPEAT_QUESTION' ? 'repeat' : 'follow_up');
          const uniqueCovered = Array.from(new Set(parsed.coveredPoints || [])) as string[];
          const missingPts = (parsed.missingPoints || []) as string[];

          const persistTask = async () => {
            try {
              const { error: insertError } = await supabaseAdmin.from('session_transcripts').insert({
                session_id: sessionId,
                request_id: requestId,
                question_id: questionId,
                question: question,
                answer: answer,
                claim_id: currentClaim.id,
                claim_text: currentClaim.claim,
                experience_name: currentClaim.experienceName,
                turn_type: turnType,
                answer_status: parsed.answerStatus,
                decision: parsed.decision,
                covered_points: uniqueCovered,
                missing_points: missingPts,
                next_question: parsed.nextQuestion
              });
              if (insertError) console.error("DB Insert failed: " + insertError.message);

              if (parsed.decision === 'END_INTERVIEW') {
                 await supabaseAdmin.from('interview_sessions').update({ status: 'INTERVIEW_ENDED', phase: 'completed' }).eq('id', sessionId);
              }
            } catch (e) {
              console.error("Background persist failed", e);
            }
          };

          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(persistTask());
          } else {
            persistTask().catch(e => console.error(e));
          }

          transcript.push({
            requestId,
            questionId,
            timestamp: new Date().getTime().toString(),
            question,
            answer,
            claimId: currentClaim.id,
            claimText: currentClaim.claim,
            experienceName: currentClaim.experienceName,
            turnType,
            answerStatus: parsed.answerStatus,
            decision: parsed.decision,
            coveredPoints: uniqueCovered,
            missingPoints: missingPts
          });
          
          parsed.transcript = transcript;
          
          controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(parsed)}\n\n`));
          controller.close();
          
        } catch (streamError: any) {
          console.error("Streaming error", streamError);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: streamError.message })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, { 
      status: 200, 
      headers: { 
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      } 
    });
