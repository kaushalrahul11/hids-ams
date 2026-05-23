-- ═══════════════════════════════════════════════════════════════
--  HIDS AMS — Practical Batch Separate Attendance Fix
--  Run in Supabase SQL Editor ONCE
-- ═══════════════════════════════════════════════════════════════

-- 1. Add prac_batch to class_schedule so Batch A & B have separate entries
ALTER TABLE class_schedule ADD COLUMN IF NOT EXISTS prac_batch text CHECK (prac_batch IN ('A','B',NULL));

-- 2. Drop old unique constraint on class_schedule and add new one including prac_batch
ALTER TABLE class_schedule DROP CONSTRAINT IF EXISTS class_schedule_subject_id_date_key;
ALTER TABLE class_schedule ADD CONSTRAINT class_schedule_subject_date_batch_key 
  UNIQUE (subject_id, date, prac_batch);

-- 3. Add prac_batch to attendance_locks so each batch can be locked independently
ALTER TABLE attendance_locks ADD COLUMN IF NOT EXISTS prac_batch text CHECK (prac_batch IN ('A','B',NULL));

-- 4. Drop old unique constraint on attendance_locks and add new one
ALTER TABLE attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_subject_id_date_key;
ALTER TABLE attendance_locks ADD CONSTRAINT attendance_locks_subject_date_batch_key 
  UNIQUE (subject_id, date, prac_batch);

-- Verify columns added
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('class_schedule','attendance_locks') 
  AND column_name = 'prac_batch'
ORDER BY table_name;
