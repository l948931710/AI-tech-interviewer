import { useState, useEffect, useCallback, useRef } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function useASR() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const isIntentionalStopRef = useRef(false);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'zh-CN';

      recognitionRef.current.onresult = (event: any) => {
        setIsSpeechDetected(true);
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          setTranscript((prev) => prev + ' ' + final);
        }
        setInterimTranscript(interim);
      };

      recognitionRef.current.onspeechstart = () => setIsSpeechDetected(true);
      recognitionRef.current.onspeechend = () => setIsSpeechDetected(false);
      recognitionRef.current.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.error('Speech recognition error', event.error);
        }
        if (event.error === 'not-allowed') {
          isIntentionalStopRef.current = true;
          setIsListening(false);
        }
      };
      recognitionRef.current.onend = () => {
        setIsSpeechDetected(false);
        if (!isIntentionalStopRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };
    }
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      setTranscript('');
      setInterimTranscript('');
      setIsSpeechDetected(false);
      isIntentionalStopRef.current = false;
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error(e);
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      isIntentionalStopRef.current = true;
      recognitionRef.current.stop();
      setIsListening(false);
      setIsSpeechDetected(false);
    }
  }, [isListening]);

  return {
    isListening,
    isSpeechDetected,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    setTranscript
  };
}
