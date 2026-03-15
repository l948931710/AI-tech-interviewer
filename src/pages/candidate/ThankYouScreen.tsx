import React from 'react';
import { CheckCircle } from 'lucide-react';

export default function ThankYouScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-white p-12 rounded-3xl shadow-lg max-w-xl w-full border border-gray-100 flex flex-col items-center">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-8">
          <CheckCircle size={40} />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 mb-6 tracking-tight">
          Interview Complete
        </h1>
        <p className="text-xl text-gray-600 leading-relaxed mb-4">
          Thank you for taking the time to complete the AI Technical Interview. 
        </p>
        <p className="text-gray-500">
          Your responses have been successfully submitted. Our recruitment team will review your interview and be in touch regarding next steps. You may now close this window.
        </p>
      </div>
    </div>
  );
}
