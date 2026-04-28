import React, { useState, useEffect } from 'react';
import { db, InterviewSession } from '../../lib/db';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { 
  Users, FileText, Plus, Copy, CheckCircle, 
  LayoutDashboard, Briefcase, Settings, Search, 
  Bell, HelpCircle, Video, Mail, CheckSquare,
  TrendingUp, Clock, FilePlus, MoreHorizontal, LogOut, ChevronRight, Loader2
} from 'lucide-react';
import { getAuthHeaders } from '../../agent/core';

// Helper to format relative time for recent items (within 24 hours)
const formatRelativeTime = (timestampMs: number) => {
  const diffMs = Date.now() - timestampMs;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
  
  return new Date(timestampMs).toLocaleDateString();
};

// Helper to calculate duration from transcript timestamps
const calculateDuration = (transcript: any[]) => {
  if (!transcript || transcript.length < 2) return 'N/A';
  const first = transcript[0].timestamp;
  const last = transcript[transcript.length - 1].timestamp;
  if (!first || !last) return 'N/A';
  
  // If it's a numeric string, convert to Number, otherwise pass as is to Date constructor
  const parsedStart = !isNaN(Number(first)) ? Number(first) : first;
  const parsedEnd = !isNaN(Number(last)) ? Number(last) : last;
  
  const start = new Date(parsedStart).getTime();
  const end = new Date(parsedEnd).getTime();
  if (isNaN(start) || isNaN(end)) return 'N/A';
  
  const diffMins = Math.max(1, Math.round((end - start) / 60000));
  return `${diffMins} min${diffMins > 1 ? 's' : ''}`;
};

export default function Dashboard() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'candidates' | 'reports'>('dashboard');
  const [reportFilter, setReportFilter] = useState<'ALL' | 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'INTERVIEW_ENDED'>('ALL');
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  
  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<{title: string, message: string} | null>(null);

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'STRONG_HIRE': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'HIRE': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'LEAN_HIRE': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'LEAN_NO_HIRE': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'NO_HIRE': return 'bg-red-500/10 text-red-400 border-red-500/20';
      default: return 'bg-white/5 text-white/70 border-white/10';
    }
  };

  useEffect(() => {
    const loadSessions = async () => {
      const data = await db.listSessions();
      setSessions(data);
    };
    
    loadSessions();

    const interval = setInterval(loadSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const generateAndCopyLink = async (id: string) => {
    try {
      const { getAuthHeaders } = await import('../../agent/core');
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/agent/generate-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ sessionId: id })
      });
      
      let token = '';
      if (res.ok) {
        const data = await res.json();
        token = data.token;
      }
      
      const url = token ? `${window.location.origin}/invite/${id}?token=${token}` : `${window.location.origin}/invite/${id}`;
      navigator.clipboard.writeText(url);
      setCopiedId(id);
      
      if (token) {
        setToastMessage({ title: 'Link Copied', message: 'A secure 24-hour invite link has been generated.' });
      }
      
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Link generation failed", e);
    }
  };

  const handleGenerateReport = async (sessionId: string) => {
    setGeneratingReportId(sessionId);
    try {
      const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';

      if (USE_LOCAL) {
        const { generateReport } = await import('../../agent');
        const session = await db.getSession(sessionId);
        if (!session) throw new Error('Session not found');
        const report = await generateReport(session.transcript || [], session.claims);
        await db.completeSession(sessionId, report);
      } else {
        const baseUrl = `${window.location.origin}/api`;
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`${baseUrl}/generate-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ sessionId })
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Report generation failed: ${response.status} - ${errorBody}`);
        }

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let done = false;
          let finalJsonStr = '';

          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              finalJsonStr += decoder.decode(value, { stream: true });
            }
          }
          finalJsonStr += decoder.decode();

          try {
            const result = JSON.parse(finalJsonStr.trim());
            if (result.error) {
               throw new Error(result.error);
            }
          } catch (e: any) {
            console.error("Failed to parse final stream response", e);
            throw new Error(e.message || "Invalid report format received");
          }
        }
      }

      setToastMessage({ title: 'Report Ready', message: 'AI evaluation report generated successfully.' });
      const data = await db.listSessions();
      setSessions(data);
    } catch (e: any) {
      console.error('Failed to generate report:', e);
      setToastMessage({ title: 'Generation Failed', message: e.message || 'Please try again later.' });
    } finally {
      setGeneratingReportId(null);
    }
  };

  const activeInterviews = sessions.filter(s => s.status !== 'COMPLETED').length;
  const pendingInvites = sessions.filter(s => s.status === 'PENDING').length;
  const reportsReady = sessions.filter(s => s.status === 'COMPLETED').length;
  const inProgressCount = sessions.filter(s => s.status === 'IN_PROGRESS').length;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-white font-body">
      
      {/* Toast Notification Container */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 glass-panel rounded-xl p-4 flex items-start gap-3 z-50 animate-in slide-in-from-bottom-5 duration-300 border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30">
            <CheckCircle className="text-primary" size={16} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">{toastMessage.title}</h4>
            <p className="text-sm text-white/60 mt-0.5">{toastMessage.message}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-white/40 hover:text-white ml-2">&times;</button>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-white/5 flex flex-col shrink-0 relative z-20 backdrop-blur-xl">
        <div className="p-6 flex items-center gap-3">
          <div className="text-2xl font-bold tracking-tight font-display aura-gradient-text ml-2">AURA</div>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto pb-4 mt-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === 'dashboard' ? 'bg-white/10 text-white shadow-[inset_2px_0_0_0_#00f0ff]' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}
          >
            <LayoutDashboard size={18} className={activeTab === 'dashboard' ? 'text-primary' : ''} />
            Dashboard
          </button>
          
          <button 
            onClick={() => setActiveTab('candidates')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === 'candidates' ? 'bg-white/10 text-white shadow-[inset_2px_0_0_0_#00f0ff]' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}
          >
            <Users size={18} className={activeTab === 'candidates' ? 'text-primary' : ''} />
            Candidates
          </button>
          
          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeTab === 'reports' ? 'bg-white/10 text-white shadow-[inset_2px_0_0_0_#00f0ff]' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}
          >
            <FileText size={18} className={activeTab === 'reports' ? 'text-primary' : ''} />
            Reports
            {reportsReady > 0 && (
              <span className="ml-auto bg-primary/20 text-primary py-0.5 px-2 rounded-full text-[10px] font-bold border border-primary/20">{reportsReady}</span>
            )}
          </button>

          <div className="pt-8 pb-2 px-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">System</div>
          
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-white/30 hover:bg-white/5 transition-colors cursor-not-allowed">
            <Settings size={18} />
            Settings
          </button>
        </nav>
        
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center overflow-hidden text-white/70 font-bold border border-white/10">
              HR
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">Administrator</p>
              <p className="text-xs text-white/40 truncate">Recruitment</p>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/hr', { replace: true });
              }}
              title="Logout"
              className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        
        {/* Subtle Background Elements */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-50">
          <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full aura-gradient opacity-[0.03] blur-[120px]"></div>
        </div>

        {/* Top Header */}
        <header className="h-20 border-b border-white/5 bg-background/50 backdrop-blur-md px-8 flex items-center justify-between shrink-0 relative z-10">
          <div className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input 
                className="w-full bg-black/20 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-[13px] focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-white/30 text-white transition-all outline-none" 
                placeholder="Search candidates, roles, or sessions..." 
                type="text"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-white/50 hover:text-white relative transition-colors bg-white/5 rounded-full border border-white/10">
              <Bell size={18} />
              {inProgressCount > 0 && (
                <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-primary rounded-full border-2 border-background animate-pulse"></span>
              )}
            </button>
            <button className="p-2 text-white/50 hover:text-white transition-colors bg-white/5 rounded-full border border-white/10">
              <HelpCircle size={18} />
            </button>
          </div>
        </header>

        {/* Dashboard Content Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-8 relative z-10">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Page Title & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold font-display tracking-tight text-white capitalize">
                  {activeTab === 'dashboard' && 'Command Center'}
                  {activeTab === 'candidates' && 'Candidates Roster'}
                  {activeTab === 'reports' && 'AI Intelligence Reports'}
                </h2>
                <p className="text-white/50 text-[13px] mt-2 font-light">
                  {activeTab === 'dashboard' && 'Monitor and manage active technical interview sessions.'}
                  {activeTab === 'candidates' && 'Track candidate progression through the hiring pipeline.'}
                  {activeTab === 'reports' && 'Review deep-dive AI evaluations and session transcripts.'}
                </p>
              </div>
              <Link 
                to="/hr/new" 
                className="aura-gradient text-background px-6 py-3 rounded-xl font-bold text-[13px] tracking-wider uppercase flex items-center gap-2 hover:opacity-90 shadow-[0_0_20px_rgba(0,240,255,0.2)] transition-all whitespace-nowrap"
              >
                <Plus size={18} />
                New Interview
              </Link>
            </div>

            {/* DASHBOARD TAB CONTENT */}
            {activeTab === 'dashboard' && (
              <>
                {/* Stat Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-[1px] aura-gradient opacity-30"></div>
                    <div className="flex items-start justify-between relative z-10">
                      <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase text-white/40 mb-2">Active Sessions</p>
                        <h3 className="text-4xl font-display font-bold text-white">{activeInterviews}</h3>
                      </div>
                      <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:bg-white/10 transition-colors shadow-[0_0_15px_rgba(0,240,255,0.1)]">
                        <Video className="text-primary" size={20} />
                      </div>
                    </div>
                    {inProgressCount > 0 ? (
                      <div className="mt-6 flex items-center gap-2 relative z-10">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(0,240,255,0.8)]"></span>
                        <span className="text-[11px] font-bold tracking-wider uppercase text-primary">{inProgressCount} Interview(s) In Progress</span>
                      </div>
                    ) : (
                      <div className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/30 font-medium relative z-10">
                        Awaiting Candidate Join
                      </div>
                    )}
                  </div>
                  
                  <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                    <div className="flex items-start justify-between relative z-10">
                      <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase text-white/40 mb-2">Pending Invites</p>
                        <h3 className="text-4xl font-display font-bold text-white">{pendingInvites}</h3>
                      </div>
                      <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:bg-white/10 transition-colors">
                        <Mail className="text-white/70" size={20} />
                      </div>
                    </div>
                    <div className="mt-6 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-white/40 font-medium relative z-10">
                      <Clock size={14} />
                      Awaiting Response
                    </div>
                  </div>
                  
                  <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                    <div className="flex items-start justify-between relative z-10">
                      <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase text-white/40 mb-2">Reports Ready</p>
                        <h3 className="text-4xl font-display font-bold text-white">{reportsReady}</h3>
                      </div>
                      <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:bg-white/10 transition-colors shadow-[0_0_15px_rgba(176,38,255,0.1)]">
                        <CheckSquare className="text-[#b026ff]" size={20} />
                      </div>
                    </div>
                    <div className="mt-6 flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-[#b026ff] relative z-10">
                      <TrendingUp size={14} />
                      Available for Review
                    </div>
                  </div>
                </div>

                {/* Bottom Grid Info */}
                <div className="grid grid-cols-1 gap-6">
                  {/* Pipeline Distribution Chart */}
                  <div className="glass-panel p-8 rounded-2xl border border-white/10 shadow-lg flex flex-col">
                    <h4 className="font-display font-bold text-white mb-8 tracking-tight">Pipeline Distribution</h4>
                    <div className="flex-1 flex flex-col justify-center gap-8 px-2 pb-4">
                      <div className="space-y-3">
                        <div className="flex justify-between text-[11px] font-bold tracking-widest uppercase text-white/60">
                          <span>Pending / Unstarted</span>
                          <span>{sessions.length ? Math.round((pendingInvites / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5">
                          <div className="bg-white/40 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (pendingInvites / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-[11px] font-bold tracking-widest uppercase text-white/60">
                          <span className="text-primary">In Progress</span>
                          <span className="text-primary">{sessions.length ? Math.round((inProgressCount / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5 relative">
                          <div className="absolute inset-0 bg-primary/20 blur-[2px]"></div>
                          <div className="bg-primary h-full rounded-full transition-all duration-1000 relative z-10 shadow-[0_0_10px_rgba(0,240,255,0.8)]" style={{ width: `${sessions.length ? (inProgressCount / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-[11px] font-bold tracking-widest uppercase text-white/60">
                          <span className="text-[#b026ff]">Evaluated</span>
                          <span className="text-[#b026ff]">{sessions.length ? Math.round((reportsReady / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5 relative">
                          <div className="bg-[#b026ff] h-full rounded-full transition-all duration-1000 relative z-10 shadow-[0_0_10px_rgba(176,38,255,0.8)]" style={{ width: `${sessions.length ? (reportsReady / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* CANDIDATES TAB CONTENT */}
            {activeTab === 'candidates' && (
              <div className="glass-panel rounded-2xl border border-white/10 shadow-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                  <h4 className="font-display font-bold text-white tracking-tight">Candidates Roster</h4>
                  <div className="flex items-center gap-3">
                    <button className="text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white px-4 py-2 rounded-lg border border-white/10 bg-white/5 transition-colors">Filter</button>
                    <button className="text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white px-4 py-2 rounded-lg border border-white/10 bg-white/5 transition-colors">Export</button>
                  </div>
                </div>
                {sessions.length === 0 ? (
                  <div className="p-20 text-center text-white/40">
                    <Users className="mx-auto h-12 w-12 text-white/20 mb-6" />
                    <h3 className="text-xl font-display font-bold text-white mb-2">No Candidates Found</h3>
                    <p className="text-[13px] font-light text-white/50">Create a new interview session to invite a candidate.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-black/20 border-b border-white/10">
                        <tr>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Candidate Info</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Target Role</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Status</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Added</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {sessions.map(session => (
                          <tr key={session.id} className="hover:bg-white/[0.03] transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white font-display font-bold text-sm shrink-0">
                                  {session.candidateInfo.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-white truncate">{session.candidateInfo.name}</p>
                                  <p className="text-[11px] text-white/40 truncate font-light mt-0.5">{session.candidateInfo.email || 'No email provided'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[13px] text-white/70">{session.candidateInfo.jobRole || 'Engineer'}</span>
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#b026ff]/10 text-[#b026ff] border border-[#b026ff]/20">
                                  Evaluated
                                </span>
                              ) : session.status === 'GENERATING' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                  Analyzing
                                </span>
                              ) : session.status === 'INTERVIEW_ENDED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  Pending Report
                                </span>
                              ) : session.status === 'IN_PROGRESS' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                                  In Progress
                                </span>
                              ) : session.status === 'NOT_FINISHED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                  Incomplete
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-white/5 text-white/50 border border-white/10">
                                  Awaiting Join
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right text-[12px] text-white/40 font-light">
                              {formatRelativeTime(session.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* REPORTS TAB CONTENT */}
            {activeTab === 'reports' && (
              <div className="glass-panel rounded-2xl border border-white/10 shadow-lg overflow-hidden">
                <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                  <h4 className="font-display font-bold text-white tracking-tight">Intelligence Reports</h4>
                  <div className="flex items-center gap-2">
                    <select 
                      value={reportFilter} 
                      onChange={(e) => setReportFilter(e.target.value as any)}
                      className="text-[11px] font-bold uppercase tracking-widest text-white bg-black/50 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:border-primary appearance-none outline-none"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="COMPLETED">Evaluated</option>
                      <option value="GENERATING">Analyzing</option>
                      <option value="INTERVIEW_ENDED">Pending Report</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="PENDING">Awaiting Join</option>
                    </select>
                  </div>
                </div>
                {sessions.filter(s => reportFilter === 'ALL' || s.status === reportFilter).length === 0 ? (
                  <div className="p-20 text-center text-white/40">
                    <FilePlus className="mx-auto h-12 w-12 text-white/20 mb-6" />
                    <h3 className="text-xl font-display font-bold text-white mb-2">No Reports Available</h3>
                    <p className="text-[13px] font-light text-white/50">Completed interviews will automatically generate intelligence reports here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-black/20 border-b border-white/10">
                        <tr>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Candidate / Date</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Duration</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">System Score</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Decision</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {sessions.filter(s => reportFilter === 'ALL' || s.status === reportFilter).map(session => (
                          <tr key={session.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <p className="text-sm font-bold text-white">{session.candidateInfo.name}</p>
                                <p className="text-[11px] text-white/40 font-light mt-1">
                                  {session.status === 'COMPLETED' && session.transcript && session.transcript.length > 0
                                    ? `Submitted ${formatRelativeTime(new Date(session.transcript[session.transcript.length - 1].timestamp || session.createdAt).getTime())}`
                                    : `Created ${formatRelativeTime(session.createdAt)}`}
                                </p>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-[13px] text-white/60 font-medium">
                              {session.status === 'COMPLETED' || session.status === 'INTERVIEW_ENDED' || session.status === 'NOT_FINISHED' ? calculateDuration(session.transcript) : '—'}
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' && session.report?.overallScore ? (
                                <div className="flex items-center gap-3">
                                  <div className="w-16 bg-black/40 border border-white/5 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full rounded-full shadow-[0_0_10px_currentColor] ${session.report.overallScore >= 70 ? 'bg-primary text-primary' : session.report.overallScore >= 50 ? 'bg-amber-400 text-amber-400' : 'bg-red-400 text-red-400'}`} 
                                      style={{ width: `${session.report.overallScore}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-[11px] font-bold tracking-widest text-white/80">{session.report.overallScore}%</span>
                                </div>
                              ) : (
                                <span className="text-white/20 text-xs italic opacity-80">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' && session.report?.overallRecommendation ? (
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getRecommendationColor(session.report.overallRecommendation)}`}>
                                  {session.report.overallRecommendation.replace('_', ' ')}
                                </span>
                              ) : (
                                <span className="text-white/20 text-xs italic opacity-80">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {session.status === 'PENDING' ? (
                                <button 
                                  onClick={() => generateAndCopyLink(session.id)}
                                  className="inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white border border-white/20 hover:border-primary hover:text-primary bg-black/40 px-3 py-2 rounded-lg transition-colors ml-auto"
                                >
                                  {copiedId === session.id ? <CheckCircle size={14} /> : <Copy size={14} />}
                                  {copiedId === session.id ? 'Copied' : 'Copy Link'}
                                </button>
                              ) : session.status === 'INTERVIEW_ENDED' || session.status === 'NOT_FINISHED' || session.status === 'GENERATING' ? (
                                <button
                                  onClick={() => handleGenerateReport(session.id)}
                                  disabled={generatingReportId === session.id || session.status === 'GENERATING'}
                                  className={`inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg transition-colors ml-auto border ${
                                    generatingReportId === session.id || session.status === 'GENERATING'
                                      ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                                      : 'text-primary bg-primary/10 hover:bg-primary/20 border-primary/30 shadow-[0_0_10px_rgba(0,240,255,0.1)]'
                                  }`}
                                >
                                  {generatingReportId === session.id || session.status === 'GENERATING' ? (
                                    <><Loader2 size={14} className="animate-spin" /> Analyzing...</>
                                  ) : (
                                    <><FileText size={14} /> Run Analysis</>
                                  )}
                                </button>
                              ) : session.status === 'COMPLETED' ? (
                                <Link 
                                  to={`/hr/report/${session.id}`}
                                  className="inline-flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary hover:text-white transition-colors mt-1"
                                >
                                  View Report
                                  <ChevronRight size={14} />
                                </Link>
                              ) : (
                                <span className="text-[11px] text-white/20 italic">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            
          </div>
        </div>
      </main>
    </div>
  );
}

