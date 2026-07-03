import React, { useState, useEffect } from 'react';
import { db, InterviewSession, InterviewStatus } from '../../lib/db';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  Users, FileText, Plus, Copy, CheckCircle,
  LayoutDashboard, Briefcase, Settings, Search,
  Bell, HelpCircle, Video, Mail, CheckSquare,
  TrendingUp, Clock, FilePlus, MoreHorizontal, LogOut, ChevronRight, Loader2,
  Download, AlertCircle, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, X
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

// Helper to calculate duration from transcript timestamps (display string)
const calculateDuration = (transcript: any[]) => {
  const mins = durationMinutes(transcript);
  if (mins < 0) return 'N/A';
  return `${mins} min${mins > 1 ? 's' : ''}`;
};

// Helper to calculate duration in minutes (numeric, -1 when unknown) — used for sorting/export
const durationMinutes = (transcript: any[]): number => {
  if (!transcript || transcript.length < 2) return -1;
  const first = transcript[0].timestamp;
  const last = transcript[transcript.length - 1].timestamp;
  if (!first || !last) return -1;

  const parsedStart = !isNaN(Number(first)) ? Number(first) : first;
  const parsedEnd = !isNaN(Number(last)) ? Number(last) : last;

  const start = new Date(parsedStart).getTime();
  const end = new Date(parsedEnd).getTime();
  if (isNaN(start) || isNaN(end)) return -1;

  return Math.max(1, Math.round((end - start) / 60000));
};

type SortKey = 'score' | 'decision' | 'duration' | 'date';
type ToastVariant = 'success' | 'error';

const DECISION_RANK: Record<string, number> = {
  STRONG_HIRE: 5, HIRE: 4, LEAN_HIRE: 3, LEAN_NO_HIRE: 2, NO_HIRE: 1,
};

export default function Dashboard() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'candidates' | 'reports'>('dashboard');
  const [reportFilter, setReportFilter] = useState<'ALL' | InterviewStatus>('ALL');
  const [candidateFilter, setCandidateFilter] = useState<'ALL' | InterviewStatus>('ALL');
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);

  // 3.7 — global search
  const [searchQuery, setSearchQuery] = useState('');
  // 3.8 — reports sorting (default: score desc)
  const [reportSort, setReportSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  // 3.9 — row selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Toast Notification state
  const [toastMessage, setToastMessage] = useState<{ title: string; message: string; variant?: ToastVariant } | null>(null);

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

  // Clear row selection whenever the active table changes to avoid cross-tab confusion
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const refreshSessions = async () => {
    const data = await db.listSessions();
    setSessions(data);
  };

  // Low-level: generate a secure invite URL for a session or throw. Only ever returns a tokenized URL.
  const generateInviteUrl = async (id: string): Promise<string> => {
    const { getAuthHeaders } = await import('../../agent/core');
    const authHeaders = await getAuthHeaders();
    const res = await fetch('/api/agent/generate-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ sessionId: id })
    });

    if (!res.ok) {
      throw new Error(`Invite generation failed (${res.status})`);
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('Server did not return a secure token.');
    }
    return `${window.location.origin}/invite/${id}?token=${data.token}`;
  };

  // 3.1 — never copy a tokenless URL and never mark "Copied" unless a tokenized link was actually written.
  const generateAndCopyLink = async (id: string) => {
    try {
      const url = await generateInviteUrl(id);
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setToastMessage({ title: 'Link Copied', message: 'A fresh secure 24-hour invite link was copied. Any previous link is now invalid.' });
      setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 2000);
    } catch (e: any) {
      console.error('Link generation failed', e);
      setToastMessage({ title: 'Link Generation Failed', message: e.message || 'Could not generate a secure invite link. Please try again.', variant: 'error' });
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
      await refreshSessions();
    } catch (e: any) {
      console.error('Failed to generate report:', e);
      setToastMessage({ title: 'Generation Failed', message: e.message || 'Please try again later.', variant: 'error' });
    } finally {
      setGeneratingReportId(null);
    }
  };

  // 3.9 — bulk: generate & copy invites for all selected invitable candidates.
  const bulkCopyInvites = async (ids: string[]) => {
    const eligible = sessions.filter(s => ids.includes(s.id) && ['PENDING', 'IN_PROGRESS', 'NOT_FINISHED'].includes(s.status));
    if (!eligible.length) {
      setToastMessage({ title: 'No Invitable Candidates', message: 'None of the selected candidates can be (re)invited.', variant: 'error' });
      return;
    }
    const lines: string[] = [];
    const failed: string[] = [];
    for (const s of eligible) {
      try {
        lines.push(`${s.candidateInfo.name}\t${await generateInviteUrl(s.id)}`);
      } catch {
        failed.push(s.candidateInfo.name);
      }
    }
    if (lines.length) {
      await navigator.clipboard.writeText(lines.join('\n'));
      setToastMessage({
        title: 'Invites Copied',
        message: `${lines.length} secure link(s) copied to clipboard${failed.length ? `; ${failed.length} failed` : ''}. Previous links are now invalid.`,
        variant: failed.length ? 'error' : 'success',
      });
    } else {
      setToastMessage({ title: 'Copy Failed', message: 'Could not generate any invite links. Please try again.', variant: 'error' });
    }
  };

  // 3.9 — bulk: run analysis for all selected sessions that are awaiting a report.
  const bulkGenerateReports = async (ids: string[]) => {
    const targets = sessions.filter(s => ids.includes(s.id) && (s.status === 'INTERVIEW_ENDED' || s.status === 'NOT_FINISHED'));
    if (!targets.length) {
      setToastMessage({ title: 'Nothing to Analyze', message: 'None of the selected candidates are awaiting analysis.', variant: 'error' });
      return;
    }
    for (const s of targets) {
      await handleGenerateReport(s.id);
    }
    setToastMessage({ title: 'Batch Complete', message: `Generated ${targets.length} report(s).` });
  };

  // 3.9 — real CSV export of whatever rows are passed in (respects current search + filters).
  const exportCsv = (rows: InterviewSession[], filename: string) => {
    if (!rows.length) {
      setToastMessage({ title: 'Nothing to Export', message: 'There are no rows matching the current view.', variant: 'error' });
      return;
    }
    const headers = ['Name', 'Email', 'Role', 'Status', 'Score', 'Decision', 'Duration (min)', 'Created'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(s => {
      const dur = durationMinutes(s.transcript);
      lines.push([
        s.candidateInfo.name,
        s.candidateInfo.email || '',
        s.candidateInfo.jobRole || '',
        s.status,
        s.status === 'COMPLETED' && s.report?.overallScore != null ? s.report.overallScore : '',
        s.status === 'COMPLETED' && s.report?.overallRecommendation ? s.report.overallRecommendation : '',
        dur >= 0 ? dur : '',
        new Date(s.createdAt).toISOString(),
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToastMessage({ title: 'Export Ready', message: `${rows.length} row(s) exported to CSV.` });
  };

  // ---- Search + filter helpers -------------------------------------------------
  const matchesSearch = (s: InterviewSession) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (s.candidateInfo.name || '').toLowerCase().includes(q) ||
      (s.candidateInfo.email || '').toLowerCase().includes(q) ||
      (s.candidateInfo.jobRole || '').toLowerCase().includes(q)
    );
  };

  // ---- Sorting helpers (reports) ----------------------------------------------
  const scoreOf = (s: InterviewSession) => (s.status === 'COMPLETED' && s.report?.overallScore != null ? s.report.overallScore : -1);
  const decisionOf = (s: InterviewSession) => (s.status === 'COMPLETED' && s.report?.overallRecommendation ? (DECISION_RANK[s.report.overallRecommendation] ?? 0) : -1);
  const durationOf = (s: InterviewSession) => durationMinutes(s.transcript);
  const dateOf = (s: InterviewSession) => {
    if (s.status === 'COMPLETED' && s.transcript && s.transcript.length > 0) {
      return new Date(s.transcript[s.transcript.length - 1].timestamp || s.createdAt).getTime();
    }
    return s.createdAt;
  };

  const reportComparator = (a: InterviewSession, b: InterviewSession) => {
    let av = 0, bv = 0;
    switch (reportSort.key) {
      case 'score': av = scoreOf(a); bv = scoreOf(b); break;
      case 'decision': av = decisionOf(a); bv = decisionOf(b); break;
      case 'duration': av = durationOf(a); bv = durationOf(b); break;
      case 'date': av = dateOf(a); bv = dateOf(b); break;
    }
    const diff = av - bv;
    return reportSort.dir === 'asc' ? diff : -diff;
  };

  const toggleSort = (key: SortKey) => {
    setReportSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  // ---- Selection helpers -------------------------------------------------------
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (rows: InterviewSession[]) => {
    setSelectedIds(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(r.id));
      const next = new Set(prev);
      if (allSelected) rows.forEach(r => next.delete(r.id));
      else rows.forEach(r => next.add(r.id));
      return next;
    });
  };

  // ---- Derived data ------------------------------------------------------------
  const inProgressCount = sessions.filter(s => s.status === 'IN_PROGRESS').length;
  const pendingInvites = sessions.filter(s => s.status === 'PENDING').length;
  const reportsReady = sessions.filter(s => s.status === 'COMPLETED').length;
  const needsAnalysisCount = sessions.filter(s => s.status === 'INTERVIEW_ENDED' || s.status === 'NOT_FINISHED').length;

  const candidateRows = sessions
    .filter(s => candidateFilter === 'ALL' || s.status === candidateFilter)
    .filter(matchesSearch);

  const reportRows = sessions
    .filter(s => reportFilter === 'ALL' || s.status === reportFilter)
    .filter(matchesSearch)
    .slice()
    .sort(reportComparator);

  // 3.10 — actionable items for the Command Center. Live (IN_PROGRESS) is excluded — it needs no action.
  const attentionRows = sessions
    .filter(s => s.status !== 'IN_PROGRESS')
    .slice()
    .sort((a, b) => dateOf(b) - dateOf(a))
    .slice(0, 6);

  const selectedList = Array.from(selectedIds);
  const selectedInvitable = sessions.filter(s => selectedIds.has(s.id) && ['PENDING', 'IN_PROGRESS', 'NOT_FINISHED'].includes(s.status)).length;
  const selectedAnalyzable = sessions.filter(s => selectedIds.has(s.id) && (s.status === 'INTERVIEW_ENDED' || s.status === 'NOT_FINISHED')).length;

  // ---- Shared render helpers ---------------------------------------------------
  const statusBadge = (status: InterviewStatus) => {
    const map: Record<string, [string, string]> = {
      COMPLETED: ['Evaluated', 'bg-[#b026ff]/10 text-[#b026ff] border-[#b026ff]/20'],
      GENERATING: ['Analyzing', 'bg-purple-500/10 text-purple-400 border-purple-500/20'],
      INTERVIEW_ENDED: ['Pending Report', 'bg-blue-500/10 text-blue-400 border-blue-500/20'],
      IN_PROGRESS: ['In Progress', 'bg-primary/10 text-primary border-primary/20'],
      NOT_FINISHED: ['Incomplete', 'bg-orange-500/10 text-orange-400 border-orange-500/20'],
      PENDING: ['Awaiting Join', 'bg-white/5 text-white/50 border-white/10'],
    };
    const [label, cls] = map[status] || map.PENDING;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${cls}`}>{label}</span>;
  };

  const attentionHint = (status: InterviewStatus) => {
    switch (status) {
      case 'PENDING': return 'Not started — send an invite';
      case 'INTERVIEW_ENDED': return 'Interview ended — awaiting analysis';
      case 'NOT_FINISHED': return 'Ended early — awaiting analysis';
      case 'GENERATING': return 'Analysis in progress';
      case 'COMPLETED': return 'Report ready to review';
      default: return '';
    }
  };

  // 3.11 / 3.12 — contextual actions per status. Reused across tables and the Command Center.
  const renderRowActions = (session: InterviewSession) => {
    const s = session.status;
    const isCopied = copiedId === session.id;
    const busy = generatingReportId === session.id || s === 'GENERATING';

    const copyBtn = (label: string, iconOnly = false) => (
      <button
        onClick={() => generateAndCopyLink(session.id)}
        title="Generates a new secure link and invalidates the previous one"
        className={`inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white border border-white/20 hover:border-primary hover:text-primary bg-black/40 ${iconOnly ? 'px-2.5 py-2' : 'px-3 py-2'} rounded-lg transition-colors`}
      >
        {isCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
        {!iconOnly && (isCopied ? 'Copied' : label)}
      </button>
    );

    const analysisBtn = (
      <button
        onClick={() => handleGenerateReport(session.id)}
        disabled={busy}
        className={`inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg transition-colors border ${
          busy
            ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
            : 'text-primary bg-primary/10 hover:bg-primary/20 border-primary/30 shadow-[0_0_10px_rgba(0,240,255,0.1)]'
        }`}
      >
        {busy ? (<><Loader2 size={14} className="animate-spin" /> Analyzing...</>) : (<><FileText size={14} /> Run Analysis</>)}
      </button>
    );

    const viewBtn = (
      <Link
        to={`/hr/report/${session.id}`}
        className="inline-flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary hover:text-white transition-colors"
      >
        View Report
        <ChevronRight size={14} />
      </Link>
    );

    if (s === 'COMPLETED') return <div className="flex items-center justify-end">{viewBtn}</div>;
    if (s === 'GENERATING') {
      return (
        <div className="flex items-center justify-end">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/30 border border-white/10 bg-white/5 px-3 py-2 rounded-lg cursor-not-allowed">
            <Loader2 size={14} className="animate-spin" /> Analyzing...
          </span>
        </div>
      );
    }
    if (s === 'INTERVIEW_ENDED') return <div className="flex items-center justify-end">{analysisBtn}</div>;
    if (s === 'NOT_FINISHED') return <div className="flex items-center justify-end gap-2">{analysisBtn}{copyBtn('Re-share', true)}</div>;
    if (s === 'IN_PROGRESS') return <div className="flex items-center justify-end">{copyBtn('Re-share')}</div>;
    if (s === 'PENDING') return <div className="flex items-center justify-end">{copyBtn('Copy Link')}</div>;
    return <div className="flex items-center justify-end"><span className="text-[11px] text-white/20 italic">—</span></div>;
  };

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: 'right' }) => (
    <th className={`px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ${align === 'right' ? 'text-right' : ''}`}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1.5 hover:text-white transition-colors ${reportSort.key === k ? 'text-white' : ''}`}
      >
        {label}
        {reportSort.key === k ? (reportSort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );

  // 3.15 — filter/search-aware empty copy
  const reportsEmptyMessage = () => {
    if (searchQuery.trim()) return `No reports match "${searchQuery.trim()}".`;
    switch (reportFilter) {
      case 'COMPLETED': return 'No evaluated candidates yet. Finished interviews appear here once you run analysis.';
      case 'IN_PROGRESS': return 'No interviews are currently in progress.';
      case 'PENDING': return 'No candidates are awaiting to join.';
      case 'INTERVIEW_ENDED': return 'No interviews are pending analysis right now.';
      case 'NOT_FINISHED': return 'No incomplete interviews awaiting analysis.';
      case 'GENERATING': return 'No reports are currently being analyzed.';
      default: return 'Nothing here yet. When an interview ends, use “Run Analysis” to generate its intelligence report.';
    }
  };

  const candidatesEmptyMessage = () => {
    if (searchQuery.trim()) return `No candidates match "${searchQuery.trim()}".`;
    if (candidateFilter !== 'ALL') return 'No candidates with this status. Adjust the filter to see more.';
    return 'Create a new interview session to invite a candidate.';
  };

  const statusFilterOptions = (
    <>
      <option value="ALL">All Statuses</option>
      <option value="COMPLETED">Evaluated</option>
      <option value="GENERATING">Analyzing</option>
      <option value="INTERVIEW_ENDED">Pending Report</option>
      <option value="IN_PROGRESS">In Progress</option>
      <option value="NOT_FINISHED">Incomplete</option>
      <option value="PENDING">Awaiting Join</option>
    </>
  );

  // 3.9 — bulk action bar shared by both tables
  const BulkBar = ({ rows, csvName }: { rows: InterviewSession[]; csvName: string }) => {
    if (selectedIds.size === 0) return null;
    return (
      <div className="px-6 py-3 border-b border-white/10 bg-primary/5 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">{selectedIds.size} selected</span>
        <div className="flex-1" />
        <button
          onClick={() => bulkCopyInvites(selectedList)}
          disabled={selectedInvitable === 0}
          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-white/20 bg-black/40 text-white hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:hover:border-white/20 disabled:hover:text-white"
        >
          <Copy size={14} /> Copy Invites{selectedInvitable ? ` (${selectedInvitable})` : ''}
        </button>
        <button
          onClick={() => bulkGenerateReports(selectedList)}
          disabled={selectedAnalyzable === 0 || generatingReportId !== null}
          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30"
        >
          <FileText size={14} /> Run Analysis{selectedAnalyzable ? ` (${selectedAnalyzable})` : ''}
        </button>
        <button
          onClick={() => exportCsv(sessions.filter(s => selectedIds.has(s.id)), csvName)}
          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-white/20 bg-black/40 text-white hover:border-primary hover:text-primary transition-colors"
        >
          <Download size={14} /> Export
        </button>
        <button
          onClick={() => setSelectedIds(new Set())}
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg text-white/50 hover:text-white transition-colors"
        >
          <X size={14} /> Clear
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-white font-body">

      {/* Toast Notification Container */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 glass-panel rounded-xl p-4 flex items-start gap-3 z-50 animate-in slide-in-from-bottom-5 duration-300 border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${toastMessage.variant === 'error' ? 'bg-red-500/20 border-red-500/30' : 'bg-primary/20 border-primary/30'}`}>
            {toastMessage.variant === 'error'
              ? <AlertCircle className="text-red-400" size={16} />
              : <CheckCircle className="text-primary" size={16} />}
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-xl pl-12 pr-10 py-3 text-[13px] focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-white/30 text-white transition-all outline-none"
                placeholder="Search candidates by name, email, or role..."
                type="text"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
                  title="Clear search"
                >
                  <X size={16} />
                </button>
              )}
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
                {/* Stat Cards — clickable, jump to the matching filtered table (3.10 / 3.19) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* 3.19: headline now reflects genuinely live interviews only */}
                  <button
                    onClick={() => { setReportFilter('IN_PROGRESS'); setActiveTab('reports'); }}
                    className="text-left glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-primary/40 transition-colors"
                  >
                    <div className="absolute top-0 left-0 w-full h-[1px] aura-gradient opacity-30"></div>
                    <div className="flex items-start justify-between relative z-10">
                      <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase text-white/40 mb-2">Live Interviews</p>
                        <h3 className="text-4xl font-display font-bold text-white">{inProgressCount}</h3>
                      </div>
                      <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:bg-white/10 transition-colors shadow-[0_0_15px_rgba(0,240,255,0.1)]">
                        <Video className="text-primary" size={20} />
                      </div>
                    </div>
                    {inProgressCount > 0 ? (
                      <div className="mt-6 flex items-center gap-2 relative z-10">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(0,240,255,0.8)]"></span>
                        <span className="text-[11px] font-bold tracking-wider uppercase text-primary">Live Now</span>
                      </div>
                    ) : (
                      <div className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/30 font-medium relative z-10">
                        No Interviews In Progress
                      </div>
                    )}
                  </button>

                  <button
                    onClick={() => { setReportFilter('PENDING'); setActiveTab('reports'); }}
                    className="text-left glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-primary/40 transition-colors"
                  >
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
                  </button>

                  <button
                    onClick={() => { setReportFilter('COMPLETED'); setActiveTab('reports'); }}
                    className="text-left glass-panel p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-[#b026ff]/40 transition-colors"
                  >
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
                  </button>
                </div>

                {/* 3.10 — Needs Attention / Recent Activity */}
                <div className="glass-panel p-8 rounded-2xl border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <Sparkles className="text-primary" size={18} />
                      <h4 className="font-display font-bold text-white tracking-tight">Needs Attention</h4>
                    </div>
                    {needsAnalysisCount > 0 && (
                      <button
                        onClick={() => bulkGenerateReports(sessions.filter(s => s.status === 'INTERVIEW_ENDED' || s.status === 'NOT_FINISHED').map(s => s.id))}
                        disabled={generatingReportId !== null}
                        className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30"
                      >
                        <FileText size={14} /> Analyze All ({needsAnalysisCount})
                      </button>
                    )}
                  </div>
                  {attentionRows.length === 0 ? (
                    <div className="py-10 text-center">
                      <CheckCircle className="mx-auto h-10 w-10 text-white/20 mb-4" />
                      <p className="text-[13px] font-light text-white/50">All caught up. New interviews will surface here as they need action.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {attentionRows.map(session => (
                        <div key={session.id} className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white font-display font-bold text-sm shrink-0">
                              {session.candidateInfo.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">{session.candidateInfo.name}</p>
                              <p className="text-[11px] text-white/40 truncate font-light mt-0.5">
                                {attentionHint(session.status)} · {formatRelativeTime(dateOf(session))}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0">{renderRowActions(session)}</div>
                        </div>
                      ))}
                    </div>
                  )}
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
                    {/* 3.9 — Filter wired to a real status filter */}
                    <select
                      value={candidateFilter}
                      onChange={(e) => setCandidateFilter(e.target.value as any)}
                      className="text-[11px] font-bold uppercase tracking-widest text-white bg-black/50 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:border-primary appearance-none outline-none"
                    >
                      {statusFilterOptions}
                    </select>
                    {/* 3.9 — Export wired to a real CSV download of the visible rows */}
                    <button
                      onClick={() => exportCsv(candidateRows, 'candidates.csv')}
                      className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white px-4 py-2 rounded-lg border border-white/10 bg-white/5 transition-colors"
                    >
                      <Download size={14} /> Export
                    </button>
                  </div>
                </div>
                <BulkBar rows={candidateRows} csvName="candidates-selected.csv" />
                {candidateRows.length === 0 ? (
                  <div className="p-20 text-center text-white/40">
                    <Users className="mx-auto h-12 w-12 text-white/20 mb-6" />
                    <h3 className="text-xl font-display font-bold text-white mb-2">No Candidates Found</h3>
                    <p className="text-[13px] font-light text-white/50">{candidatesEmptyMessage()}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-black/20 border-b border-white/10">
                        <tr>
                          <th className="px-6 py-4 w-10">
                            <input
                              type="checkbox"
                              className="accent-primary w-4 h-4 rounded bg-black/40"
                              checked={candidateRows.length > 0 && candidateRows.every(r => selectedIds.has(r.id))}
                              onChange={() => toggleSelectAll(candidateRows)}
                            />
                          </th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Candidate Info</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Target Role</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Status</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Added</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {candidateRows.map(session => (
                          <tr key={session.id} className="hover:bg-white/[0.03] transition-colors group">
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                className="accent-primary w-4 h-4 rounded bg-black/40"
                                checked={selectedIds.has(session.id)}
                                onChange={() => toggleSelect(session.id)}
                              />
                            </td>
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
                              {statusBadge(session.status)}
                            </td>
                            <td className="px-6 py-4 text-[12px] text-white/40 font-light">
                              {formatRelativeTime(session.createdAt)}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {renderRowActions(session)}
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
                    {needsAnalysisCount > 0 && (
                      <button
                        onClick={() => bulkGenerateReports(sessions.filter(s => s.status === 'INTERVIEW_ENDED' || s.status === 'NOT_FINISHED').map(s => s.id))}
                        disabled={generatingReportId !== null}
                        className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest px-4 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-30"
                      >
                        <FileText size={14} /> Generate All Pending ({needsAnalysisCount})
                      </button>
                    )}
                    <button
                      onClick={() => exportCsv(reportRows, 'reports.csv')}
                      className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white px-4 py-2 rounded-lg border border-white/10 bg-white/5 transition-colors"
                    >
                      <Download size={14} /> Export
                    </button>
                    <select
                      value={reportFilter}
                      onChange={(e) => setReportFilter(e.target.value as any)}
                      className="text-[11px] font-bold uppercase tracking-widest text-white bg-black/50 border border-white/20 rounded-lg px-4 py-2 focus:outline-none focus:border-primary appearance-none outline-none"
                    >
                      {statusFilterOptions}
                    </select>
                  </div>
                </div>
                <BulkBar rows={reportRows} csvName="reports-selected.csv" />
                {reportRows.length === 0 ? (
                  <div className="p-20 text-center text-white/40">
                    <FilePlus className="mx-auto h-12 w-12 text-white/20 mb-6" />
                    <h3 className="text-xl font-display font-bold text-white mb-2">No Reports Found</h3>
                    <p className="text-[13px] font-light text-white/50">{reportsEmptyMessage()}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-black/20 border-b border-white/10">
                        <tr>
                          <th className="px-6 py-4 w-10">
                            <input
                              type="checkbox"
                              className="accent-primary w-4 h-4 rounded bg-black/40"
                              checked={reportRows.length > 0 && reportRows.every(r => selectedIds.has(r.id))}
                              onChange={() => toggleSelectAll(reportRows)}
                            />
                          </th>
                          <SortHeader label="Candidate / Date" k="date" />
                          <SortHeader label="Duration" k="duration" />
                          <SortHeader label="System Score" k="score" />
                          <SortHeader label="Decision" k="decision" />
                          <th className="px-6 py-4 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {reportRows.map(session => (
                          <tr key={session.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                className="accent-primary w-4 h-4 rounded bg-black/40"
                                checked={selectedIds.has(session.id)}
                                onChange={() => toggleSelect(session.id)}
                              />
                            </td>
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
                              {renderRowActions(session)}
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
