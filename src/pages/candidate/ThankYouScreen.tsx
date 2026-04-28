import React from 'react';
import { CheckCircle } from 'lucide-react';

export default function ThankYouScreen() {
  return (
    <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] max-w-3xl h-[80%] rounded-full aura-gradient opacity-10 blur-[150px]"></div>
      </div>

      <div className="glass-panel p-12 md:p-16 rounded-3xl max-w-xl w-full flex flex-col items-center relative z-10 animate-[fadeIn_0.6s_ease-out]">
        <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>
        
        <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-10 shadow-[0_0_50px_rgba(0,240,255,0.15)] border border-primary/20">
          <CheckCircle size={48} className="text-primary" />
        </div>
        
        <h1 className="text-4xl md:text-5xl font-bold font-display text-white mb-6 tracking-tight">
          Session <span className="aura-gradient-text">Complete</span>
        </h1>
        
        <p className="text-lg text-white/80 leading-relaxed mb-6 font-light">
          Thank you for taking the time to complete your Aura Interview. 
        </p>
        
        <p className="text-sm text-white/50 leading-relaxed">
          Your responses have been successfully submitted and are being analyzed. Our recruitment team will review your profile and be in touch regarding next steps. You may now close this window.
        </p>
      </div>
    </div>
  );
}
