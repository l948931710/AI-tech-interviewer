-- Add segment_index column to llm_usage_logs if it doesn't exist
ALTER TABLE public.llm_usage_logs ADD COLUMN IF NOT EXISTS segment_index INTEGER DEFAULT NULL;
