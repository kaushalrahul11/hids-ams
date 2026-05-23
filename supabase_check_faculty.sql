-- ═══════════════════════════════════════════════════════════════
--  HIDS AMS — Faculty Subject Assignment Diagnostic
--  Run this in Supabase SQL Editor to check if faculty UUIDs match
-- ═══════════════════════════════════════════════════════════════

-- 1. Check all users in your app's users table
SELECT id, email, name, role FROM users ORDER BY role, name;

-- 2. Check faculty_subjects assignments
SELECT 
  u.name AS faculty_name,
  u.email,
  u.id AS faculty_id,
  s.name AS subject_name,
  s.batch
FROM faculty_subjects fs
JOIN users u ON fs.faculty_id = u.id
JOIN subjects s ON fs.subject_id = s.id
ORDER BY u.name;

-- 3. Check auth.users (Supabase Auth) vs your users table
-- If IDs don't match here, that's the problem
SELECT 
  au.id AS auth_id,
  au.email AS auth_email,
  u.id AS users_table_id,
  u.name,
  u.role,
  CASE WHEN au.id = u.id THEN '✓ MATCH' ELSE '✗ MISMATCH - FIX NEEDED' END AS status
FROM auth.users au
LEFT JOIN users u ON au.email = u.email
ORDER BY au.email;

-- 4. FIX: If IDs are mismatched, run this to sync them
-- UPDATE users u
-- SET id = au.id
-- FROM auth.users au
-- WHERE au.email = u.email AND au.id != u.id;
-- (Uncomment line above and run ONLY if step 3 shows MISMATCH)

-- 5. Check subjects have faculty assigned
SELECT 
  s.name AS subject,
  s.batch,
  s.subject_type,
  COUNT(fs.faculty_id) AS faculty_count
FROM subjects s
LEFT JOIN faculty_subjects fs ON s.id = fs.subject_id
GROUP BY s.id, s.name, s.batch, s.subject_type
ORDER BY s.batch, s.name;
