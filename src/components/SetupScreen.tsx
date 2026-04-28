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
      className="max-w-5xl mx-auto p-6 font-body"
    >
      <div className="text-center mb-12 relative">
        <div className="inline-flex items-center justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_30px_rgba(0,240,255,0.2)]">
            <Briefcase className="text-primary w-8 h-8" />
          </div>
        </div>
        <h1 className="text-5xl font-display font-bold tracking-tight text-white mb-4">
          Session Initialization
        </h1>
        <p className="text-[14px] font-light text-white/50 max-w-2xl mx-auto">
          Provide candidate context and role requirements. The Aura intelligence engine will construct a targeted, adversarial evaluation protocol based on the provided parameters.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Resume Upload */}
          <div className="glass-panel p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-primary shadow-[inset_0_0_15px_rgba(0,240,255,0.1)] group-hover:bg-primary/10 transition-colors">
                <FileText size={24} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-white tracking-tight">Candidate Profile</h2>
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mt-1">Data Ingestion</p>
              </div>
            </div>
            
            <div className="mt-6">
              <label 
                htmlFor="resume-upload" 
                className="flex flex-col items-center justify-center w-full h-48 border border-white/20 border-dashed rounded-xl cursor-pointer bg-black/40 hover:bg-black/60 hover:border-primary/50 transition-all group/upload relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover/upload:opacity-100 transition-opacity"></div>
                <div className="flex flex-col items-center justify-center pt-5 pb-6 relative z-10">
                  <Upload className="w-8 h-8 mb-4 text-white/40 group-hover/upload:text-primary transition-colors" />
                  <p className="mb-2 text-[13px] text-white/70">
                    <span className="font-bold text-white">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-bold">PDF, DOCX, TXT, MD</p>
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
                <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-lg text-[13px] text-primary font-medium flex items-center gap-3">
                  <FileText size={16} /> 
                  <span className="truncate">{resumeFileName}</span>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider opacity-70">Ready</span>
                </div>
              )}
            </div>
            
            <div className="mt-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-[1px] flex-1 bg-white/10"></div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/30">Or provide manual input</div>
                <div className="h-[1px] flex-1 bg-white/10"></div>
              </div>
              <textarea
                value={resumeText}
                onChange={(e) => {
                  setResumeText(e.target.value);
                  setResumeFile(null);
                  setResumeFileName('');
                }}
                className="w-full h-32 p-4 bg-black/40 border border-white/10 rounded-xl focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-none text-[13px] text-white/80 placeholder:text-white/20 outline-none font-mono"
                placeholder="Paste raw resume text here..."
                required={!resumeFile}
              />
            </div>
          </div>

          {/* Job Description */}
          <div className="glass-panel p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#b026ff]/50 to-transparent"></div>
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-[#b026ff] shadow-[inset_0_0_15px_rgba(176,38,255,0.1)] group-hover:bg-[#b026ff]/10 transition-colors">
                <Briefcase size={24} />
              </div>
              <div>
                <h2 className="text-xl font-display font-bold text-white tracking-tight">Role Context</h2>
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mt-1">Evaluation Parameters</p>
              </div>
            </div>
            
            <div className="mt-6 h-[calc(100%-80px)] flex flex-col">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-3">Target Description</div>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="flex-1 w-full min-h-[300px] p-4 bg-black/40 border border-white/10 rounded-xl focus:ring-1 focus:ring-[#b026ff] focus:border-[#b026ff] transition-all resize-none text-[13px] text-white/80 placeholder:text-white/20 outline-none font-mono leading-relaxed"
                placeholder="Paste the job description, core requirements, expected competencies, and technical stack here..."
                required
              />
            </div>
          </div>
        </div>

        <div className="flex justify-center mt-12">
          <button
            type="submit"
            disabled={(!resumeText && !resumeFile) || !jdText || isLoading}
            className="flex items-center gap-3 px-10 py-5 aura-gradient text-background rounded-xl font-bold text-[14px] uppercase tracking-widest hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(0,240,255,0.3)] disabled:shadow-none"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Initializing Engine...
              </>
            ) : (
              <>
                Generate Protocol
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
