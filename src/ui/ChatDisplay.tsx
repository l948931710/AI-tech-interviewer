import React from 'react';

interface ChatDisplayProps {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatDisplay({ transcript, interimTranscript, isListening, scrollRef }: ChatDisplayProps) {
  if (!transcript && !interimTranscript) return null;
  
  return (
    <div className="mb-4 p-4 bg-gray-50 rounded-xl text-gray-700 text-sm max-h-32 overflow-y-auto" ref={scrollRef}>
      <span className="font-medium text-gray-900">You: </span>
      {transcript} <span className="text-gray-400 italic">{interimTranscript}</span>
      {isListening && transcript.trim() && !interimTranscript.trim() && (
        <span className="inline-block ml-2 w-2 h-2 bg-indigo-400 rounded-full animate-pulse" title="Waiting for you to finish..." />
      )}
    </div>
  );
}
