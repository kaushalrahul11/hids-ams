# 🦷 HIDS Attendance Management System

**Himachal Institute of Dental Sciences — hids.ac.in**

A full-stack attendance management system built with:
- **Frontend**: Vanilla JS + Vite
- **Backend/Database**: Supabase (PostgreSQL + Auth)
- **Hosting**: Vercel + GitHub

---

## 📁 Project Structure

```
hids-ams/
├── index.html              ← Main app (all pages/UI)
├── src/
│   ├── main.js             ← All app logic, Supabase calls
│   └── lib/
│       └── supabase.js     ← Supabase client
├── supabase_schema.sql     ← Run this in Supabase SQL editor
├── package.json
├── vite.config.js
├── vercel.json
├── .env.example            ← Copy to .env and fill credentials
└── .gitignore
```

---

## 🚀 STEP-BY-STEP DEPLOYMENT

### STEP 1 — Create Supabase Project

1. Go to **https://supabase.com** → Sign up (free)
2. Click **"New Project"**
   - Name: `hids-ams`
   - Database password: (save this!)
   - Region: Choose nearest (e.g. Singapore)
3. Wait ~2 minutes for project to be ready

### STEP 2 — Run Database Schema

1. In Supabase dashboard → **SQL Editor** → **New Query**
2. Copy the entire contents of `supabase_schema.sql`
3. Paste and click **Run**
4. You should see "Success" for all statements

### STEP 3 — Create Admin User

1. Supabase Dashboard → **Authentication** → **Users** → **Invite User**
2. Enter: `admin@hids.ac.in`
3. They'll get an email to set password (or set manually below)
4. In **SQL Editor**, run:
```sql
-- After the admin signs up, insert their profile:
INSERT INTO users (id, email, name, initials, role)
VALUES (
  (SELECT id FROM auth.users WHERE email='admin@hids.ac.in'),
  'admin@hids.ac.in',
  'Super Admin',
  'SA',
  'admin'
);
```

### STEP 4 — Get Supabase API Keys

1. Supabase → **Settings** → **API**
2. Copy:
   - **Project URL** (looks like `https://abcdef.supabase.co`)
   - **anon / public** key (long string starting with `eyJ...`)

### STEP 5 — Set Up Local Dev

```bash
# Clone or download project folder
cd hids-ams

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env and fill in your keys:
# VITE_SUPABASE_URL=https://your-project-id.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...

# Start local dev server
npm run dev
# Open http://localhost:5173
```

### STEP 6 — Push to GitHub

```bash
# Initialize git
git init
git add .
git commit -m "Initial commit: HIDS AMS"

# Create repo on github.com → copy the repo URL, then:
git remote add origin https://github.com/YOUR_USERNAME/hids-ams.git
git branch -M main
git push -u origin main
```

### STEP 7 — Deploy to Vercel

1. Go to **https://vercel.com** → Sign up with GitHub
2. Click **"Add New Project"** → Select your `hids-ams` repo
3. Framework: **Vite** (auto-detected)
4. **Environment Variables** — Add these:
   ```
   VITE_SUPABASE_URL     = https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY = eyJ...your-anon-key...
   ```
5. Click **Deploy** → Done!
6. You'll get a URL like `https://hids-ams.vercel.app`

### STEP 8 — Link to hids.ac.in (Wix)

**Option A — Custom Domain on Vercel (Recommended):**
1. Vercel → Project → **Settings** → **Domains**
2. Add: `attendance.hids.ac.in`
3. In your domain registrar / Wix DNS settings, add:
   - Type: `CNAME`
   - Name: `attendance`
   - Value: `cname.vercel-dns.com`
4. Wait 10 min → `https://attendance.hids.ac.in` is live!

**Option B — Link from Wix Site:**
1. In Wix Editor → Add a Button or Menu item
2. Link it to your Vercel URL
3. Or use Wix's **Embed** → **HTML iFrame** → paste Vercel URL

---

## 👤 ADDING FACULTY AFTER DEPLOYMENT

### Via App (Admin → Settings → Add Faculty):
- The app will create a Supabase Auth account
- Faculty receives login email automatically
- Assign subjects to them in the same form

### Via Supabase Dashboard (Manual):
1. Auth → Users → Invite User → enter faculty email
2. SQL Editor:
```sql
INSERT INTO users (id, email, name, initials, role)
VALUES (
  (SELECT id FROM auth.users WHERE email='faculty@hids.ac.in'),
  'faculty@hids.ac.in',
  'Dr. Faculty Name',
  'FN',
  'faculty'
);
```

---

## 📊 IMPORTING STUDENTS

Go to **Students → Import CSV/Excel**

Your file must have these columns:
```
name, roll, batch, phone, email
```

Batch values must be exactly: `BDS-1`, `BDS-2`, `BDS-3`, `BDS-4`

**Sample CSV:**
```csv
name,roll,batch,phone,email
Aarav Shah,BDS-1-01,BDS-1,9876543210,parent1@gmail.com
Ishaan Patel,BDS-1-02,BDS-1,9876543211,parent2@gmail.com
Siya Verma,BDS-2-01,BDS-2,9876543212,parent3@gmail.com
```

---

## ✅ FEATURES

| Feature | Description |
|---|---|
| 🔐 Role-based login | Super Admin + Faculty with restricted access |
| 📋 Mark Attendance | Toggle present/absent per student per day |
| 👥 Add/Delete Students | Manual + CSV/Excel bulk import |
| 📈 Reports | Overall, Subject-wise, Below threshold, Day-wise |
| 🕐 Previous Sessions | Full historical attendance by academic year |
| ⬆️ Selective Promotion | Choose which students move to next batch |
| 🎓 Alumni Tracking | Graduated BDS-4 students archived |
| 📧 Email Alerts | Log alerts for students below threshold |
| 📤 Export CSV | Download reports as Excel-compatible CSV |
| ☁️ Supabase Backend | All data stored in PostgreSQL, accessible anywhere |

---

## 🔑 DEMO CREDENTIALS (after setup)

| Role | Email | Note |
|---|---|---|
| Admin | admin@hids.ac.in | Create via Supabase Auth |
| Faculty | priya@hids.ac.in | Create via Admin panel |

---

## 🆘 TROUBLESHOOTING

**"Missing Supabase env vars"**
→ Make sure `.env` file exists with correct keys. Restart `npm run dev`.

**Login shows "Account not set up"**
→ User exists in Auth but not in `users` table. Run the INSERT SQL above.

**Attendance not saving**
→ Check RLS policies are enabled. Re-run the schema SQL.

**Vercel build fails**
→ Make sure env vars are added in Vercel dashboard → Settings → Environment Variables.

---

## 📞 SUPPORT

For issues, check Supabase docs: https://supabase.com/docs  
Vercel docs: https://vercel.com/docs
