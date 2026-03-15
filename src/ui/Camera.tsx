import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraProps {
  showCamera: boolean;
  hasVideo: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function Camera({ showCamera, hasVideo, videoRef }: CameraProps) {
  return (
    <AnimatePresence>
      {showCamera && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="absolute bottom-8 right-8 w-48 aspect-video rounded-xl overflow-hidden border-2 border-white dark:border-slate-800 shadow-2xl bg-slate-900 group z-30"
        >
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
          />
          {!hasVideo && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-xs bg-slate-800">
              Camera Off
            </div>
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-bold tracking-wider text-white">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
            REC
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
