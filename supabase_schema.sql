-- ═══════════════════════════════════════════════════════════════
--  HIDS AMS — Supabase Schema v2
--  Run entire file in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

create table if not exists settings (
  id              text primary key default 'main',
  college_name    text not null default 'Himachal Institute of Dental Sciences',
  academic_year   text not null default '2024-25',
  min_attendance  int  not null default 75,
  alert_threshold int  not null default 70,
  website         text default 'hids.ac.in',
  updated_at      timestamptz default now()
);
insert into settings (id) values ('main') on conflict do nothing;

create table if not exists users (
  id          uuid primary key default uuid_generate_v4(),
  email       text unique not null,
  name        text not null,
  initials    text not null default 'XX',
  role        text not null check (role in ('admin','faculty')),
  created_at  timestamptz default now()
);

create table if not exists academic_sessions (
  id            uuid primary key default uuid_generate_v4(),
  label         text unique not null,
  start_date    date,
  end_date      date,
  is_current    boolean default false,
  created_at    timestamptz default now()
);
insert into academic_sessions (label, is_current) values ('2024-25', true) on conflict do nothing;

-- subjects: no single teacher_id, multi-faculty via faculty_subjects
create table if not exists subjects (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  code        text not null,
  batch       text not null check (batch in ('BDS-1','BDS-2','BDS-3','BDS-4')),
  credits     int default 3,
  created_at  timestamptz default now()
);

-- many faculty ↔ many subjects
create table if not exists faculty_subjects (
  faculty_id  uuid references users(id) on delete cascade,
  subject_id  uuid references subjects(id) on delete cascade,
  assigned_by uuid references users(id) on delete set null,
  assigned_at timestamptz default now(),
  primary key (faculty_id, subject_id)
);

create table if not exists students (
  id          uuid primary key default uuid_generate_v4(),
  roll        text unique not null,
  name        text not null,
  batch       text not null check (batch in ('BDS-1','BDS-2','BDS-3','BDS-4')),
  year        int  not null default 1,
  phone       text,
  email       text,
  session_id  uuid references academic_sessions(id),
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create table if not exists alumni (
  id              uuid primary key default uuid_generate_v4(),
  roll            text not null,
  name            text not null,
  email           text,
  phone           text,
  graduated_batch text,
  session_label   text,
  graduated_on    date default current_date,
  created_at      timestamptz default now()
);

-- attendance: locked = faculty cannot edit after saving; admin always can
create table if not exists attendance (
  id          uuid primary key default uuid_generate_v4(),
  student_id  uuid references students(id) on delete cascade,
  subject_id  uuid references subjects(id) on delete cascade,
  session_id  uuid references academic_sessions(id),
  date        date not null,
  status      text not null check (status in ('present','absent')),
  marked_by   uuid references users(id) on delete set null,
  locked      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (student_id, subject_id, date)
);

-- tracks which subject+date combinations are locked (faculty saved)
create table if not exists attendance_locks (
  id          uuid primary key default uuid_generate_v4(),
  subject_id  uuid references subjects(id) on delete cascade,
  session_id  uuid references academic_sessions(id),
  date        date not null,
  locked_by   uuid references users(id) on delete set null,
  locked_at   timestamptz default now(),
  unique (subject_id, date)
);

-- holidays: excluded from attendance % calculation
create table if not exists holidays (
  id          uuid primary key default uuid_generate_v4(),
  date        date unique not null,
  name        text not null,
  holiday_type text default 'national',
  session_id  uuid references academic_sessions(id),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz default now()
);

-- class_schedule: each row = one class conducted
-- % = present / total rows for this subject (not calendar days)
create table if not exists class_schedule (
  id          uuid primary key default uuid_generate_v4(),
  subject_id  uuid references subjects(id) on delete cascade,
  session_id  uuid references academic_sessions(id),
  date        date not null,
  is_extra    boolean default false,
  created_at  timestamptz default now(),
  unique (subject_id, date)
);

create table if not exists email_log (
  id          uuid primary key default uuid_generate_v4(),
  to_email    text not null,
  subject     text not null,
  sent_by     uuid references users(id) on delete set null,
  session_id  uuid references academic_sessions(id),
  sent_at     timestamptz default now()
);

-- ══ RLS ══════════════════════════════════════════════════════
alter table settings           enable row level security;
alter table users              enable row level security;
alter table academic_sessions  enable row level security;
alter table subjects           enable row level security;
alter table faculty_subjects   enable row level security;
alter table students           enable row level security;
alter table alumni             enable row level security;
alter table attendance         enable row level security;
alter table attendance_locks   enable row level security;
alter table holidays           enable row level security;
alter table class_schedule     enable row level security;
alter table email_log          enable row level security;

do $$ declare r record;
begin
  for r in (select policyname, tablename from pg_policies where schemaname='public') loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "r_settings"   on settings          for select using (auth.role()='authenticated');
create policy "r_users"      on users             for select using (auth.role()='authenticated');
create policy "r_sessions"   on academic_sessions for select using (auth.role()='authenticated');
create policy "r_subjects"   on subjects          for select using (auth.role()='authenticated');
create policy "r_fs"         on faculty_subjects  for select using (auth.role()='authenticated');
create policy "r_students"   on students          for select using (auth.role()='authenticated');
create policy "r_alumni"     on alumni            for select using (auth.role()='authenticated');
create policy "r_att"        on attendance        for select using (auth.role()='authenticated');
create policy "r_attlocks"   on attendance_locks  for select using (auth.role()='authenticated');
create policy "r_holidays"   on holidays          for select using (auth.role()='authenticated');
create policy "r_schedule"   on class_schedule    for select using (auth.role()='authenticated');
create policy "r_emaillog"   on email_log         for select using (auth.role()='authenticated');

create policy "w_settings"   on settings          for all using (auth.role()='authenticated');
create policy "w_users"      on users             for all using (auth.role()='authenticated');
create policy "w_sessions"   on academic_sessions for all using (auth.role()='authenticated');
create policy "w_subjects"   on subjects          for all using (auth.role()='authenticated');
create policy "w_fs"         on faculty_subjects  for all using (auth.role()='authenticated');
create policy "w_students"   on students          for all using (auth.role()='authenticated');
create policy "w_alumni"     on alumni            for all using (auth.role()='authenticated');
create policy "w_att"        on attendance        for all using (auth.role()='authenticated');
create policy "w_attlocks"   on attendance_locks  for all using (auth.role()='authenticated');
create policy "w_holidays"   on holidays          for all using (auth.role()='authenticated');
create policy "w_schedule"   on class_schedule    for all using (auth.role()='authenticated');
create policy "w_emaillog"   on email_log         for all using (auth.role()='authenticated');
