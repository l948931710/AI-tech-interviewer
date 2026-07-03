import React from 'react';
import { CheckCircle, PauseCircle, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

export default function ThankYouScreen() {
  const [params] = useSearchParams();
  // 2.8 — differentiate an early end from a genuine completion.
  const outcome = params.get('outcome'); // 'ended' (early) | 'submitted' (complete) | null
  const isEarlyEnd = outcome === 'ended';
  const isZh = params.get('lang') === 'en-US' ? false : true;
  const resumeLink = params.get('resume'); // present only when the session is still resumable

  const t = (zh: string, en: string) => (isZh ? zh : en);

  const heading = isEarlyEnd
    ? { pre: t('面试', 'Session'), accent: t('未完成', 'Incomplete') }
    : { pre: t('面试', 'Session'), accent: t('完成', 'Complete') };

  return (
    <div className="min-h-screen bg-background text-white font-body flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] max-w-3xl h-[80%] rounded-full aura-gradient opacity-10 blur-[150px]"></div>
      </div>

      <div className="glass-panel p-12 md:p-16 rounded-3xl max-w-xl w-full flex flex-col items-center relative z-10 animate-[fadeIn_0.6s_ease-out]">
        <div className="absolute top-0 left-0 right-0 h-[1px] aura-gradient opacity-50"></div>

        <div className={`w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-10 border ${
          isEarlyEnd
            ? 'border-amber-400/30 shadow-[0_0_50px_rgba(251,191,36,0.12)]'
            : 'border-primary/20 shadow-[0_0_50px_rgba(0,240,255,0.15)]'
        }`}>
          {isEarlyEnd
            ? <PauseCircle size={48} className="text-amber-400" />
            : <CheckCircle size={48} className="text-primary" />}
        </div>

        <h1 className="text-4xl md:text-5xl font-bold font-display text-white mb-6 tracking-tight">
          {heading.pre} <span className={isEarlyEnd ? 'text-amber-400' : 'aura-gradient-text'}>{heading.accent}</span>
        </h1>

        {isEarlyEnd ? (
          <>
            <p className="text-lg text-white/80 leading-relaxed mb-6 font-light">
              {t(
                '你在面试完成前结束了本次会话。',
                'You ended this session before the interview was complete.'
              )}
            </p>
            <p className="text-sm text-white/50 leading-relaxed">
              {resumeLink
                ? t(
                    '你目前的进度已被保存。如果你想继续，可以使用同一个面试链接返回，从中断处接着进行。',
                    'Your progress so far has been saved. If you\'d like to continue, you can return using the same interview link and pick up where you left off.'
                  )
                : t(
                    '你目前的进度已被保存。如需重新参加或有任何疑问，请联系你的招聘负责人 (HR)。',
                    'Your progress so far has been saved. To resume or if you have any questions, please contact your recruiter.'
                  )}
            </p>

            {resumeLink && (
              <a
                href={resumeLink}
                className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm tracking-wide bg-white text-background hover:shadow-[0_0_30px_rgba(0,240,255,0.3)] transition-all"
              >
                {t('返回并继续面试', 'Return and resume interview')}
                <ArrowRight size={16} />
              </a>
            )}
          </>
        ) : (
          <>
            <p className="text-lg text-white/80 leading-relaxed mb-6 font-light">
              {t(
                '感谢你抽出时间完成本次 Aura 面试。',
                'Thank you for taking the time to complete your Aura Interview.'
              )}
            </p>
            <p className="text-sm text-white/50 leading-relaxed">
              {t(
                '你的回答已成功提交,正在分析中。我们的招聘团队会审阅你的表现并就后续步骤与你联系。你现在可以关闭此窗口。',
                'Your responses have been successfully submitted and are being analyzed. Our recruitment team will review your profile and be in touch regarding next steps. You may now close this window.'
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
