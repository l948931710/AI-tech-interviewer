import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, InterviewSession } from '../../lib/db';
import ReportScreen from '../../components/ReportScreen';
import { ArrowLeft } from 'lucide-react';

export default function ReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<InterviewSession | null>(null);

  useEffect(() => {
    const loadSessionData = async () => {
      if (id) {
        const loadSession = await db.getSession(id);
        if (loadSession) {
          setSession(loadSession);
        } else {
          alert("Session not found");
          navigate('/hr/dashboard');
        }
      }
    };
    loadSessionData();
  }, [id, navigate]);

  if (!session) return <div>Loading...</div>;

  if (session.status !== 'COMPLETED' || !session.report) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-center p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Interview Not Completed</h2>
        <p className="text-gray-600 mb-6">This candidate has not finished their interview yet.</p>
        <button 
          onClick={() => navigate('/hr/dashboard')}
          className="text-indigo-600 hover:underline font-medium flex items-center gap-2"
        >
          <ArrowLeft size={18} /> Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen pb-12">
      <div className="max-w-4xl mx-auto px-6 pt-8 pb-4">
        <button 
          onClick={() => navigate('/hr/dashboard')}
          className="text-gray-500 hover:text-gray-900 font-medium transition flex items-center gap-2"
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
