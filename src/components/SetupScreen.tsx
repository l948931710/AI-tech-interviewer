import React, { useState } from 'react';
import { Upload, FileText, Briefcase, ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface SetupScreenProps {
  onStart: (resumeData: string | { inlineData: { data: string, mimeType: string } }, jdText: string) => void;
  isLoading: boolean;
}

export default function SetupScreen({ onStart, isLoading }: SetupScreenProps) {
  const [jdText, setJdText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<{ data: string, mimeType: string } | null>(null);
  const [resumeFileName, setResumeFileName] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFileName(file.name);
    setResumeText(''); // Clear text if file is uploaded
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setResumeFile({ data: base64, mimeType: file.type || 'application/pdf' });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((resumeText || resumeFile) && jdText) {
      const resumeData = resumeFile ? { inlineData: resumeFile } : resumeText;
      onStart(resumeData, jdText);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto p-6"
    >
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-4">
          AI Technical Interviewer
        </h1>
        <p className="text-lg text-gray-600">
          Upload a resume and job description to start a personalized, deep-dive technical interview.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Resume Upload */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                <FileText size={24} />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Candidate Resume</h2>
            </div>
            
            <div className="mt-4">
              <label 
                htmlFor="resume-upload" 
                className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 mb-3 text-gray-400" />
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">TXT, MD, or paste below</p>
                </div>
                <input 
                  id="resume-upload" 
                  type="file" 
                  className="hidden" 
                  accept=".txt,.md,.pdf,.docx"
                  onChange={handleFileUpload}
                />
              </label>
              {resumeFileName && (
                <div className="mt-2 text-sm text-emerald-600 font-medium flex items-center justify-center gap-1">
                  <FileText size={16} /> {resumeFileName} uploaded
                </div>
              )}
            </div>
            
            <div className="mt-4">
              <div className="text-sm text-gray-500 mb-2">Or paste resume text:</div>
              <textarea
                value={resumeText}
                onChange={(e) => {
                  setResumeText(e.target.value);
                  setResumeFile(null);
                  setResumeFileName('');
                }}
                className="w-full h-32 p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-sm"
                placeholder="Paste the candidate's resume here..."
                required={!resumeFile}
              />
            </div>
          </div>

          {/* Job Description */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <Briefcase size={24} />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Job Description</h2>
            </div>
            
            <div className="mt-4 h-full flex flex-col">
              <div className="text-sm text-gray-500 mb-2">Paste the target role description:</div>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="flex-1 w-full min-h-[280px] p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none text-sm"
                placeholder="Paste the job description, requirements, and expectations here..."
                required
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={(!resumeText && !resumeFile) || !jdText || isLoading}
            className="flex items-center gap-2 px-8 py-4 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Analyzing Profile...
              </>
            ) : (
              <>
                Start Interview
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
