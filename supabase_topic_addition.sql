-- ═══════════════════════════════════════════════════════════════
--  HIDS AMS — Topic column addition
--  Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Add topic column to class_schedule (topic per class date)
ALTER TABLE class_schedule ADD COLUMN IF NOT EXISTS topic text;

-- Add topic column to attendance (inherited per class)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS topic text;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'class_schedule' AND column_name = 'topic';
