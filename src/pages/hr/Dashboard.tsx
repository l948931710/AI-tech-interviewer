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

  const handleGenerateReport = async (sessionId: string) => {
    setGeneratingReportId(sessionId);
    try {
      const USE_LOCAL = import.meta.env.VITE_USE_LOCAL_DB === 'true';

      if (USE_LOCAL) {
        // Local dev: generate report client-side since server can't access localStorage
        const { generateReport } = await import('../../agent');
        const session = await db.getSession(sessionId);
        if (!session) throw new Error('Session not found');
        const report = await generateReport(session.transcript || [], session.claims);
        await db.completeSession(sessionId, report);
      } else {
        // Production: generate report server-side
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

        // Handle streaming response to bypass 60s timeout
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
          
          // Decode any remaining bytes
          finalJsonStr += decoder.decode();

          // Try to parse the final accumulated result
          try {
            // Trim whitespace (Edge API sends spaces as keep-alive pings)
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

      setToastMessage({ title: '报告生成完毕', message: 'AI 评估报告已生成，可立即查看。' });
      // Refresh sessions to show updated status
      const data = await db.listSessions();
      setSessions(data);
    } catch (e: any) {
      console.error('Failed to generate report:', e);
      setToastMessage({ title: '报告生成失败', message: e.message || '请稍后重试。' });
    } finally {
      setGeneratingReportId(null);
    }
  };

  const activeInterviews = sessions.filter(s => s.status !== 'COMPLETED').length;
  const pendingInvites = sessions.filter(s => s.status === 'PENDING').length;
  const reportsReady = sessions.filter(s => s.status === 'COMPLETED').length;
  const interviewEndedCount = sessions.filter(s => s.status === 'INTERVIEW_ENDED').length;
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
            控制台
          </button>
          
          <button 
            onClick={() => setActiveTab('candidates')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'candidates' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Users size={20} />
            候选人
          </button>
          
          <button 
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'reports' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <FileText size={20} />
            评估报告
            {reportsReady > 0 && (
              <span className="ml-auto bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs">{reportsReady}</span>
            )}
          </button>
          
          {/* Work in progress links based on DataHire template */}
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors opacity-60 cursor-not-allowed hidden">
            <Briefcase size={20} />
            Jobs
          </button>

          <div className="pt-6 pb-2 px-3 text-xs font-bold text-slate-400 uppercase tracking-wider">系统设置</div>
          
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors opacity-50 cursor-not-allowed">
            <Settings size={20} />
            设置
          </button>
        </nav>
        
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 p-2">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden text-slate-500 font-bold">
              HR
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">管理员</p>
              <p className="text-xs text-slate-500 truncate">招聘团队</p>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/hr', { replace: true });
              }}
              title="退出登录"
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={18} />
            </button>
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
                placeholder="搜索候选人、面试或职位..." 
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
                  {activeTab === 'dashboard' && '面试控制台'}
                  {activeTab === 'candidates' && '候选人列表'}
                  {activeTab === 'reports' && 'AI评估报告'}
                </h2>
                <p className="text-slate-500 text-sm mt-1">
                  {activeTab === 'dashboard' && '监控和管理正在进行的 AI 技术面试。'}
                  {activeTab === 'candidates' && '查看所有候选人背景及当前招聘漏斗状态。'}
                  {activeTab === 'reports' && '查看已完成的 AI 评估分析及面试记录。'}
                </p>
              </div>
              <Link 
                to="/hr/new" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all whitespace-nowrap"
              >
                <Plus size={18} />
                新建面试
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
                        <p className="text-sm font-medium text-slate-500 mb-1">进行中的面试</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{activeInterviews}</h3>
                      </div>
                      <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                        <Video className="text-indigo-600" size={24} />
                      </div>
                    </div>
                    {inProgressCount > 0 ? (
                      <div className="mt-4 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                        <span className="text-xs font-bold text-indigo-600">当前有 {inProgressCount} 场面试正在进行</span>
                      </div>
                    ) : (
                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 font-medium">
                        等待候选人加入
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">已邀请(待参加)</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{pendingInvites}</h3>
                      </div>
                      <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                        <Mail className="text-amber-500" size={24} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <Clock size={14} />
                      等待候选人响应
                    </div>
                  </div>
                  
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">报告生成完毕</p>
                        <h3 className="text-3xl font-extrabold text-slate-900">{reportsReady}</h3>
                      </div>
                      <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                        <CheckSquare className="text-emerald-500" size={24} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                      <TrendingUp size={14} />
                      可供 HR 查看
                    </div>
                  </div>
                </div>

                {/* Bottom Grid Info */}
                <div className="grid grid-cols-1 gap-6">
                  {/* Pipeline Distribution Chart (Visual Polish) */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                    <h4 className="font-bold text-slate-900 mb-6">招聘漏斗分布</h4>
                    <div className="flex-1 flex flex-col justify-center gap-6 px-4 pb-4">
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>待参加 / 未开启</span>
                          <span>{sessions.length ? Math.round((pendingInvites / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="bg-amber-400 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (pendingInvites / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>面试进行中</span>
                          <span>{sessions.length ? Math.round((inProgressCount / sessions.length) * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000" style={{ width: `${sessions.length ? (inProgressCount / sessions.length) * 100 : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-700">
                          <span>已评估完毕</span>
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
                  <h4 className="font-bold text-slate-900">候选人名单</h4>
                  <div className="flex items-center gap-2">
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">筛选</button>
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">导出</button>
                  </div>
                </div>
                {sessions.length === 0 ? (
                  <div className="p-16 text-center text-slate-500">
                    <Users className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 mb-2">暂无候选人</h3>
                    <p className="text-sm">新建一个面试来添加候选人。</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">候选人信息</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">投递岗位</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">求职状态</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">添加时间</th>
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
                                  <p className="text-xs text-slate-500 truncate">{session.candidateInfo.email || '未提供邮箱'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm font-medium text-slate-700">{session.candidateInfo.jobRole || 'Engineer'}</span>
                            </td>
                            <td className="px-6 py-4">
                              {session.status === 'COMPLETED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                                  已评估
                                </span>
                              ) : session.status === 'GENERATING' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20">
                                  报告生成中
                                </span>
                              ) : session.status === 'INTERVIEW_ENDED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20">
                                  待生成报告
                                </span>
                              ) : session.status === 'IN_PROGRESS' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                                  面试中
                                </span>
                              ) : session.status === 'NOT_FINISHED' ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20">
                                  未完成
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10">
                                  等待参加
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
                  <h4 className="font-bold text-slate-900">AI 评估报告</h4>
                  <div className="flex items-center gap-2">
                    <select 
                      value={reportFilter} 
                      onChange={(e) => setReportFilter(e.target.value as any)}
                      className="text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">所有状态</option>
                      <option value="COMPLETED">已评估</option>
                      <option value="GENERATING">生成中</option>
                      <option value="INTERVIEW_ENDED">待生成报告</option>
                      <option value="IN_PROGRESS">面试中</option>
                      <option value="PENDING">未开启</option>
                    </select>
                  </div>
                </div>
                {sessions.filter(s => reportFilter === 'ALL' || s.status === reportFilter).length === 0 ? (
                  <div className="p-16 text-center text-slate-500">
                    <FilePlus className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 mb-2">暂无报告</h3>
                    <p className="text-sm">候选人完成面试后，自动生成的评估报告将显示在这里。</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">候选人 / 日期</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">面试时长</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">系统评分</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">录用建议</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">操作</th>
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
                              {session.status === 'COMPLETED' || session.status === 'INTERVIEW_ENDED' || session.status === 'NOT_FINISHED' ? calculateDuration(session.transcript) : '—'}
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
                              ) : session.status === 'INTERVIEW_ENDED' || session.status === 'NOT_FINISHED' || session.status === 'GENERATING' ? (
                                <button
                                  onClick={() => handleGenerateReport(session.id)}
                                  disabled={generatingReportId === session.id || session.status === 'GENERATING'}
                                  className={`inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors ml-auto ${
                                    generatingReportId === session.id || session.status === 'GENERATING'
                                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                                  }`}
                                >
                                  {generatingReportId === session.id || session.status === 'GENERATING' ? (
                                    <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                                  ) : (
                                    <><FileText size={14} /> 生成报告</>
                                  )}
                                </button>
                              ) : session.status === 'COMPLETED' ? (
                                <Link 
                                  to={`/hr/report/${session.id}`}
                                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 mt-1"
                                >
                                  查看报告
                                  <ChevronRight size={14} />
                                </Link>
                              ) : (
                                <span className="text-xs text-slate-400 italic">—</span>
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

