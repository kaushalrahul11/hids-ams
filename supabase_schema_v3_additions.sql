-- ═══════════════════════════════════════════════════════════════
--  HIDS AMS — Schema v3 ADDITIONS (run on top of v2)
--  Only run this if you already ran supabase_schema.sql / v2
--  Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════

-- 1. Add subject_type to subjects table (theory / practical)
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'theory' CHECK (subject_type IN ('theory','practical'));

-- 2. Add practical_batch to students (NULL = all batches / theory)
--    'A' = Roll 1-50, 'B' = Roll 51-100, NULL = not a practical batch student
ALTER TABLE students ADD COLUMN IF NOT EXISTS prac_batch text CHECK (prac_batch IN ('A','B',NULL));

-- 3. Track practical batch per subject (which batch is being marked)
--    Practical attendance key = student_id + subject_id + date + prac_batch
--    We add prac_batch column to attendance too
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS prac_batch text CHECK (prac_batch IN ('A','B',NULL));

-- 4. Update attendance unique constraint to include prac_batch
--    Drop old unique, add new one that includes prac_batch
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_student_id_subject_id_date_key;
ALTER TABLE attendance ADD CONSTRAINT attendance_student_subject_date_batch_key UNIQUE (student_id, subject_id, date);

-- 5. Add assigned_by column to faculty_subjects if missing
ALTER TABLE faculty_subjects ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE faculty_subjects ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now();

-- RLS policies for new columns are inherited from existing table policies
-- No new tables, no new policies needed.

-- Verify
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'subjects' AND column_name = 'subject_type';
