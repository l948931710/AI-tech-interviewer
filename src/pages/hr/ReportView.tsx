import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, InterviewSession } from '../../lib/db';
import ReportScreen from '../../components/ReportScreen';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';

export default function ReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const loadSessionData = async () => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const loadSession = await db.getSession(id);
      if (loadSession) {
        setSession(loadSession);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    };
    loadSessionData();
  }, [id]);

  // Themed loading skeleton (replaces the bare "Loading..." div)
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center gap-4">
        <Loader2 size={36} className="text-primary animate-spin" />
        <p className="text-sm font-medium text-white/50 uppercase tracking-widest">Loading report…</p>
      </div>
    );
  }

  // In-app themed message for a missing session (replaces window.alert + redirect)
  if (notFound) {
    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center text-center p-6">
        <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8">
          <AlertTriangle className="text-amber-400 mx-auto mb-4" size={40} />
          <h2 className="text-2xl font-bold text-white mb-2">Session Not Found</h2>
          <p className="text-white/60 mb-6">We couldn't find a report for this interview. It may have been removed or the link is invalid.</p>
          <button
            onClick={() => navigate('/hr/dashboard')}
            className="inline-flex items-center gap-2 bg-primary text-background px-5 py-2.5 rounded-lg font-bold hover:opacity-90 transition-opacity"
          >
            <ArrowLeft size={18} /> Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!session || session.status !== 'COMPLETED' || !session.report) {
    return (
      <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center text-center p-6">
        <h2 className="text-2xl font-bold text-white mb-2">Interview Not Completed</h2>
        <p className="text-white/60 mb-6">This candidate has not finished their interview yet.</p>
        <button
          onClick={() => navigate('/hr/dashboard')}
          className="text-primary hover:underline font-medium flex items-center gap-2"
        >
          <ArrowLeft size={18} /> Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="bg-background text-white min-h-screen pb-12">
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-4">
        <button
          onClick={() => navigate('/hr/dashboard')}
          className="text-white/50 hover:text-white font-medium transition flex items-center gap-2"
        >
          <ArrowLeft size={18} />
          Back to Dashboard
        </button>
      </div>

      {/* We reuse the existing ReportScreen, but strip out the restart button capability via an empty function or updating the component */}
      <ReportScreen
        report={session.report}
        candidateInfo={session.candidateInfo}
        history={session.transcript}
      />
    </div>
  );
}
