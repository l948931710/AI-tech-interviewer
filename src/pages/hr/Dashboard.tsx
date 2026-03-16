import React, { useState, useEffect } from 'react';
import { db, InterviewSession } from '../../lib/db';
import { Link } from 'react-router-dom';
import { 
  Users, FileText, Plus, Copy, CheckCircle, 
  LayoutDashboard, Briefcase, Settings, Search, 
  Bell, HelpCircle, Video, Mail, CheckSquare,
  TrendingUp, Clock, FilePlus, MoreHorizontal, LogOut, ChevronRight
} from 'lucide-react';
import FulingLogo from '../../assets/fuling-logo.png';

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
  
  const start = new Date(first).getTime();
  const end = new Date(last).getTime();
  if (isNaN(start) || isNaN(end)) return 'N/A';
  
  const diffMins = Math.max(1, Math.round((end - start) / 60000));
  return `${diffMins} min${diffMins > 1 ? 's' : ''}`;
};

export default function Dashboard() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'candidates' | 'reports'>('dashboard');
  const [reportFilter, setReportFilter] = useState<'ALL' | 'COMPLETED' | 'IN_PROGRESS' | 'PENDING'>('ALL');
  
  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<{title: string, message: string} | null>(null);

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'STRONG_HIRE': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'HIRE': return 'bg-green-100 text-green-800 border-green-200';
      case 'LEAN_HIRE': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'LEAN_NO_HIRE': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'NO_HIRE': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  useEffect(() => {
    const loadSessions = async () => {
      const data = await db.listSessions();
      setSessions(data);
    };
    
    loadSessions();

    // In a real app with Supabase, you would use Realtime subscriptions here.
    // For now, we poll every 15 seconds to simulate live updates since local storage events no longer fire across tabs.
    const interval = setInterval(loadSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const activeInterviews = sessions.filter(s => s.status !== 'COMPLETED').length;
  const pendingInvites = sessions.filter(s => s.status === 'PENDING').length;
  const reportsReady = sessions.filter(s => s.status === 'COMPLETED').length;
  
  const inProgressCount = sessions.filter(s => s.status === 'IN_PROGRESS').length;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 font-sans">
      
      {/* Toast Notification Container */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-white border border-slate-200 shadow-xl rounded-xl p-4 flex items-start gap-3 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
            <CheckCircle className="text-indigo-600" size={16} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">{toastMessage.title}</h4>
            <p className="text-sm text-slate-600 mt-0.5">{toastMessage.message}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600 ml-2">&times;</button>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3">
          <img src={FulingLogo} alt="Fuling Logo" className="h-10 object-contain ml-2" />
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pb-4">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </button>
          
          <button 
            onClick={() => setActiveTab('candidates')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'candidates' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Users size={20} />
            Candidates
          </button>
          
          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'reports' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <FileText size={20} />
            Reports
            {reportsReady > 0 && (
              <span className="ml-auto bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs">{reportsReady}</span>
            )}
          </button>
          
          {/* Work in progress links based on DataHire template */}
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors opacity-60 cursor-not-allowed hidden">
            <Briefcase size={20} />
            Jobs
          </button>

          <div className="pt-6 pb-2 px-3 text-xs font-bold text-slate-400 uppercase tracking-wider">System</div>
          
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors opacity-50 cursor-not-allowed">
            <Settings size={20} />
            Settings
          </button>
        </nav>
        
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 p-2">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden text-slate-500 font-bold">
              HR
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">Admin User</p>
              <p className="text-xs text-slate-500 truncate">Recruitment Team</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        
        {/* Top Header */}
        <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between shrink-0">
          <div className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                className="w-full bg-slate-50 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 placeholder:text-slate-400 transition-all outline-none" 
                placeholder="Search candidates, interviews, or roles..." 
                type="text"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-slate-400 hover:text-slate-600 relative transition-colors">
              <Bell size={20} />
              {inProgressCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white"></span>
              )}
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <HelpCircle size={20} />
            </button>
          </div>
        </header>

        {/* Dashboard Content Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Page Title & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 capitalize">
                  {activeTab === 'dashboard' && 'Interview Dashboard'}
                  {activeTab === 'candidates' && 'Candidates'}
                  {activeTab === 'reports' && 'Evaluation Reports'}
                </h2>
                <p className="text-slate-500 text-sm mt-1">
                  {activeTab === 'dashboard' && 'Monitor and manage your active AI technical screening sessions.'}
                  {activeTab === 'candidates' && 'View all candidate backgrounds and current pipeline status.'}
                  {activeTab === 'reports' && 'Review completed AI analysis and interview playback.'}
                </p>
              </div>
              <Link 
                to="/hr/new" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all whitespace-nowrap"
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
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">Active Interviews</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{activeInterviews}</h3>
                      </div>
                      <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                        <Video className="text-indigo-600" size={24} />
                      </div>
                    </div>
                    {inProgressCount > 0 ? (
                      <div className="mt-4 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                        <span className="text-xs font-bold text-indigo-600">{inProgressCount} live session{inProgressCount > 1 ? 's' : ''} currently</span>
                      </div>
                    ) : (
                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 font-medium">
                        Waiting for candidates to join
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">Pending Invites</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{pendingInvites}</h3>
                      </div>
                      <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                        <Mail className="text-amber-500" size={24} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <Clock size={14} />
                      Awaiting candidate response
                    </div>
                  </div>
                  
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">Reports Ready</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{reportsReady}</h3>
                      </div>
                      <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                        <CheckSquare className="text-emerald-500" size={24} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                      <TrendingUp size={14} />
                      Ready for HR review
                    </div>
                  </div>
                </div>

                {/* Bottom Grid Info */}
                <div className="grid grid-cols-1 gap-6">
                  {/* Pipeline Distribution Chart (Visual Polish) */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <h4 className="font-bold text-slate-900 mb-6">Pipeline Distribution</h4>
                    <div className="flex-1 flex flex-col justify-center gap-6 px-4 pb-4">
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>Pending / Screening</span>
                          <span>{sessions.length ? Math.round((pendingInvites / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="bg-amber-400 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (pendingInvites / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>Technical Interview in Progress</span>
                          <span>{sessions.length ? Math.round((inProgressCount / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (inProgressCount / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>Final Evaluation Ready</span>
                          <span>{sessions.length ? Math.round((reportsReady / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (reportsReady / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Removed Promo Card */}
                </div>
              </>
            )}

            {/* CANDIDATES TAB CONTENT */}
            {activeTab === 'candidates' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="font-bold text-slate-900">Candidate Roster</h4>
                  <div className="flex items-center gap-2">
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">Filter</button>
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">Export</button>
                  </div>
                </div>
                {sessions.length === 0 ? (
                  <div className="p-16 text-center text-slate-500">
                    <Users className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 mb-2">No candidates</h3>
                    <p className="text-sm">Create an interview to add a candidate.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Candidate Info</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Added</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sessions.map(session => (
                          <tr key={session.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-700 font-bold text-sm shrink-0">
                                  {session.candidateInfo.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-900 truncate">{session.candidateInfo.name}</p>
                                  <p className="text-xs text-slate-500 truncate">{session.candidateInfo.email || 'No email provided'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm font-medium text-slate-700">{session.candidateInfo.jobRole || 'Engineer'}</span>
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                                  Evaluated
                                </span>
                              ) : session.status === 'IN_PROGRESS' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                                  Interviewing
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10">
                                  Pending Check-in
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right text-sm text-slate-500">
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
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="font-bold text-slate-900">AI Evaluation Reports</h4>
                  <div className="flex items-center gap-2">
                    <select 
                      value={reportFilter} 
                      onChange={(e) => setReportFilter(e.target.value as any)}
                      className="text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">All Status</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="PENDING">Pending</option>
                    </select>
                  </div>
                </div>
                {sessions.filter(s => reportFilter === 'ALL' || s.status === reportFilter).length === 0 ? (
                  <div className="p-16 text-center text-slate-500">
                    <FilePlus className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 mb-2">No reports yet</h3>
                    <p className="text-sm">Reports will appear here once candidates complete their interviews.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Candidate / Date</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Score</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Hire Recommendation</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sessions.filter(s => reportFilter === 'ALL' || s.status === reportFilter).map(session => (
                          <tr key={session.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <p className="text-sm font-bold text-slate-900">{session.candidateInfo.name}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {session.status === 'COMPLETED' && session.transcript && session.transcript.length > 0
                                    ? `Submitted ${formatRelativeTime(new Date(session.transcript[session.transcript.length - 1].timestamp || session.createdAt).getTime())}`
                                    : `Created ${formatRelativeTime(session.createdAt)}`}
                                </p>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                              {session.status === 'COMPLETED' ? calculateDuration(session.transcript) : '—'}
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' && session.report?.overallScore ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full rounded-full ${session.report.overallScore >= 70 ? 'bg-emerald-500' : session.report.overallScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} 
                                      style={{ width: `${session.report.overallScore}%` }}
                                    ></div>
                                  </div>
                                  <span className="text-xs font-bold text-slate-700">{session.report.overallScore}%</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs italic opacity-80">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' && session.report?.overallRecommendation ? (
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${getRecommendationColor(session.report.overallRecommendation)}`}>
                                  {session.report.overallRecommendation.replace('_', ' ')}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs italic opacity-80">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {session.status === 'PENDING' ? (
                                <button 
                                  onClick={() => copyLink(session.id)}
                                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-lg transition-colors ml-auto"
                                >
                                  {copiedId === session.id ? <CheckCircle size={14} /> : <Copy size={14} />}
                                  {copiedId === session.id ? 'Copied' : 'Copy Link'}
                                </button>
                              ) : (
                                <Link 
                                  to={`/hr/report/${session.id}`}
                                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 mt-1"
                                >
                                  View Report
                                  <ChevronRight size={14} />
                                </Link>
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

