// ═══════════════════════════════════════════════════════════
//  HIDS AMS v3 — main.js
//  Fixes: faculty assign bug, no backdate, subject type,
//         practical batch A/B, edit student
// ═══════════════════════════════════════════════════════════
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx'

// ── STATE ───────────────────────────────────────────────────
let CU  = null
let DB  = {
  settings:{}, sessions:[], curSession:null,
  users:[], subjects:[], students:[], alumni:[],
  attByStudentSubject:{},
  attLocks:{},
  holidays:[],
  classSchedule:{},
  emailLog:[],
}
let loginRole = 'admin'

// ── UTILS ───────────────────────────────────────────────────
const $    = id => document.getElementById(id)
const safe = s  => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const todayStr  = () => new Date().toISOString().split('T')[0]
const fmtDate   = ds => ds ? new Date(ds+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''
const ini       = n  => (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
const pctColor  = p  => p>=75?'#16a34a':p>=60?'#d97706':'#dc2626'
const pctBadge  = p  => p>=75?'bp':p>=60?'bl':'ba'

// Faculty cannot mark attendance for past dates
const canMarkDate = date => {
  if (CU?.role === 'admin') return true
  return date === todayStr()
}

// Practical batch helper — batch A: roll ending ≤50, B: >50
function getPracBatch(roll){
  const num = parseInt((roll||'').split('-').pop()) || 0
  return num <= 50 ? 'A' : 'B'
}

function getPracBatchLabel(b){ return b==='A'?'Batch A (Roll 1–50)':'Batch B (Roll 51–100)' }

// ── TOAST ───────────────────────────────────────────────────
let _tt
function toast(msg,type='s'){
  const w=$('toast-wrap'); if(!w) return
  const cls=type==='s'?'toast-s':type==='e'?'toast-e':'toast-i'
  const ico=type==='s'?'ti-circle-check':type==='e'?'ti-alert-circle':'ti-info-circle'
  w.innerHTML=`<div class="toast-item ${cls}"><i class="ti ${ico}"></i>${msg}</div>`
  clearTimeout(_tt); _tt=setTimeout(()=>w.innerHTML='',3500)
}

// ── MODAL ───────────────────────────────────────────────────
function openModal(html){ $('modal-inner').innerHTML=html; $('modal-bg').classList.add('show') }
function closeModal(){ $('modal-bg').classList.remove('show') }
window.closeModal=closeModal

// ── LOADER ──────────────────────────────────────────────────
function showLoad(m='Loading…'){ if($('loader-msg')) $('loader-msg').textContent=m; if($('loader')) $('loader').style.display='flex' }
function hideLoad(){ if($('loader')) $('loader').style.display='none' }

// ── SIDEBAR MOBILE ──────────────────────────────────────────
function toggleSidebar(){ $('sidebar').classList.toggle('open'); $('sb-overlay').classList.toggle('show') }
function closeSidebar(){ $('sidebar').classList.remove('open'); $('sb-overlay').classList.remove('show') }
window.toggleSidebar=toggleSidebar
window.closeSidebar=closeSidebar

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
function setRole(r){
  loginRole=r
  $('rt-admin').classList.toggle('active',r==='admin')
  $('rt-faculty').classList.toggle('active',r==='faculty')
  $('err-box').style.display='none'
}
window.setRole=setRole

function togglePw(){
  const i=$('l-pass'),ic=$('eye-i')
  i.type=i.type==='password'?'text':'password'
  ic.className=i.type==='password'?'ti ti-eye':'ti ti-eye-off'
}
window.togglePw=togglePw

async function doLogin(){
  const email=$('l-email').value.trim().toLowerCase()
  const pass=$('l-pass').value
  const eb=$('err-box'); eb.style.display='none'
  if(!email||!pass){ eb.style.display='flex'; $('err-txt').textContent='Enter email and password.'; return }
  showLoad('Signing in…')
  const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
  if(error){ hideLoad(); eb.style.display='flex'; $('err-txt').textContent='Invalid credentials.'; return }
  const {data:profile}=await supabase.from('users').select('*').eq('email',email).single()
  if(!profile){ await supabase.auth.signOut(); hideLoad(); eb.style.display='flex'; $('err-txt').textContent='Account not set up. Contact admin.'; return }
  if(profile.role!==loginRole){ await supabase.auth.signOut(); hideLoad(); eb.style.display='flex'; $('err-txt').textContent=`This is a ${profile.role} account.`; return }
  CU=profile; await bootstrapApp()
}
window.doLogin=doLogin

async function doLogout(){
  await supabase.auth.signOut(); CU=null
  $('app').style.display='none'; $('login-screen').style.display='flex'
  $('l-email').value=''; $('l-pass').value=''; setRole('admin')
}
window.doLogout=doLogout

// ═══════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════
async function bootstrapApp(){
  showLoad('Loading data…')
  try{
    await Promise.all([fetchSettings(),fetchSessions(),fetchUsers(),fetchSubjects(),fetchStudents(),fetchAlumni(),fetchHolidays()])
    $('login-screen').style.display='none'
    $('app').style.display='flex'; $('app').style.flexDirection='column'
    initAppUI()
  }catch(e){ console.error(e); toast('Load failed: '+e.message,'e') }
  hideLoad()
}

async function fetchSettings(){ const{data}=await supabase.from('settings').select('*').eq('id','main').single(); if(data) DB.settings=data }

async function fetchSessions(){
  const{data}=await supabase.from('academic_sessions').select('*').order('created_at',{ascending:false})
  DB.sessions=data||[]; DB.curSession=DB.sessions.find(s=>s.is_current)||DB.sessions[0]
}

async function fetchUsers(){
  // ── FIX: fetch faculty_subjects separately and merge to avoid join issues ──
  const{data:users}=await supabase.from('users').select('*')
  const{data:fs}=await supabase.from('faculty_subjects').select('faculty_id, subject_id')
  DB.users=(users||[]).map(u=>({
    ...u,
    faculty_subjects:(fs||[]).filter(f=>f.faculty_id===u.id)
  }))
}

async function fetchSubjects(){
  // ── FIX: fetch faculty_subjects separately to avoid Supabase join RLS issues ──
  const{data:subs}=await supabase.from('subjects').select('*')
  const{data:fs}=await supabase.from('faculty_subjects').select('faculty_id, subject_id')
  DB.subjects=(subs||[]).map(s=>({
    ...s,
    faculty_subjects:(fs||[]).filter(f=>f.subject_id===s.id)
  }))
}

async function fetchStudents(){
  const{data}=await supabase.from('students').select('*').eq('is_active',true).order('roll')
  DB.students=data||[]
}

async function fetchAlumni(){
  const{data}=await supabase.from('alumni').select('*').order('graduated_on',{ascending:false})
  DB.alumni=data||[]
}

async function fetchHolidays(){
  const{data}=await supabase.from('holidays').select('*').order('date')
  DB.holidays=data||[]
}

async function fetchAttForSubject(subjectId,sessionId){
  if(!DB.attByStudentSubject) DB.attByStudentSubject={}
  const{data}=await supabase.from('attendance').select('student_id,date,status,locked').eq('subject_id',subjectId).eq('session_id',sessionId)
  ;(data||[]).forEach(r=>{
    if(!DB.attByStudentSubject[r.student_id]) DB.attByStudentSubject[r.student_id]={}
    if(!DB.attByStudentSubject[r.student_id][subjectId]) DB.attByStudentSubject[r.student_id][subjectId]=[]
    const idx=DB.attByStudentSubject[r.student_id][subjectId].findIndex(x=>x.date===r.date)
    if(idx>=0) DB.attByStudentSubject[r.student_id][subjectId][idx]=r
    else DB.attByStudentSubject[r.student_id][subjectId].push(r)
  })
}

async function fetchLocksForSubject(subjectId){
  const{data}=await supabase.from('attendance_locks').select('date').eq('subject_id',subjectId)
  ;(data||[]).forEach(r=>{ DB.attLocks[`${subjectId}_${r.date}`]=true })
}

async function fetchClassSchedule(subjectId,sessionId){
  const{data}=await supabase.from('class_schedule').select('date,topic').eq('subject_id',subjectId).eq('session_id',sessionId).order('date',{ascending:false})
  DB.classSchedule[subjectId]=(data||[]).map(r=>r.date)
  // store topic map: classTopics[subjectId][date] = topic
  if(!DB.classTopics) DB.classTopics={}
  DB.classTopics[subjectId]={}
  ;(data||[]).forEach(r=>{ if(r.topic) DB.classTopics[subjectId][r.date]=r.topic })
}

// ── ATTENDANCE % — based on actual classes conducted, excluding holidays ──
function getAttStat(studentId,subjectId){
  const conducted=DB.classSchedule[subjectId]||[]
  const records=DB.attByStudentSubject?.[studentId]?.[subjectId]||[]
  const recMap={}; records.forEach(r=>recMap[r.date]=r.status)
  const holidaySet=new Set(DB.holidays.map(h=>h.date))
  const classDates=conducted.filter(d=>!holidaySet.has(d))
  let p=0,t=classDates.length
  classDates.forEach(d=>{ if(recMap[d]==='present') p++ })
  return {p,a:t-p,t,pct:t>0?Math.round(p/t*100):0}
}

function getOverall(studentId){
  const st=DB.students.find(s=>s.id===studentId); if(!st) return 0
  const subs=DB.subjects.filter(s=>s.batch===st.batch)
  let p=0,t=0; subs.forEach(s=>{const a=getAttStat(studentId,s.id);p+=a.p;t+=a.t})
  return t>0?Math.round(p/t*100):0
}

function isDateLocked(subjectId,date){ return !!DB.attLocks[`${subjectId}_${date}`] }
function isHoliday(date){ return DB.holidays.some(h=>h.date===date) }

// ── FACULTY HELPERS ──────────────────────────────────────────
function getFacultyForSubject(subjectId){
  const sub=DB.subjects.find(s=>s.id===subjectId); if(!sub) return []
  return (sub.faculty_subjects||[])
    .map(fs=>DB.users.find(u=>u.id===fs.faculty_id))
    .filter(Boolean)
}

function getTeacherNames(subjectId){
  const facs=getFacultyForSubject(subjectId)
  return facs.length?facs.map(f=>f.name).join(', '):'Unassigned'
}

function getMySubjects(){
  if(!CU) return []
  if(CU.role==='admin') return DB.subjects
  return DB.subjects.filter(s=>(s.faculty_subjects||[]).some(fs=>fs.faculty_id===CU.id))
}

// ── PRACTICAL BATCH HELPERS ──────────────────────────────────
function getStudentsForSubjectAndBatch(sub, pracBatch){
  const batchStudents = DB.students.filter(s=>s.batch===sub.batch)
  if(sub.subject_type!=='practical') return batchStudents
  // Filter by practical batch based on roll number
  return batchStudents.filter(s=>{
    const num=parseInt((s.roll||'').split('-').pop())||0
    return pracBatch==='A' ? (num>=1&&num<=50) : (num>=51&&num<=100)
  })
}

// ═══════════════════════════════════════════════════════════
//  APP UI INIT
// ═══════════════════════════════════════════════════════════
const ADMIN_NAV=[
  {id:'dashboard', label:'Dashboard',        icon:'ti-home'},
  {id:'mark',      label:'Mark Attendance',  icon:'ti-checkbox'},
  {id:'students',  label:'Students',         icon:'ti-users'},
  {id:'reports',   label:'Reports',          icon:'ti-chart-bar'},
  {id:'history',   label:'Past Sessions',    icon:'ti-history'},
  {id:'subjects',  label:'Subjects',         icon:'ti-book'},
  {id:'holidays',  label:'Holidays',         icon:'ti-calendar-off'},
  {id:'promote',   label:'Year & Promotion', icon:'ti-arrow-up-circle'},
  {id:'email',     label:'Email Alerts',     icon:'ti-mail'},
  {id:'settings',  label:'Settings',         icon:'ti-settings'},
]
const FACULTY_NAV=[
  {id:'mysubjects',label:'My Subjects',      icon:'ti-book'},
  {id:'mark',      label:'Mark Attendance',  icon:'ti-checkbox'},
  {id:'students',  label:'My Students',      icon:'ti-users'},
  {id:'reports',   label:'Report',           icon:'ti-chart-bar'},
]

function initAppUI(){
  $('hdr-acy').textContent   = DB.settings.academic_year||'—'
  $('hdr-uname').textContent = CU.name
  $('hdr-urole').textContent = CU.role==='admin'?'Administrator':'Faculty'
  $('sb-av').textContent     = CU.initials
  $('sb-av').className       = 'av '+(CU.role==='admin'?'av-admin':'av-faculty')
  $('sb-name').textContent   = CU.name
  const rt=$('sb-rtag')
  rt.textContent = CU.role==='admin'?'Administrator':'Faculty'
  rt.className   = 'rtag '+(CU.role==='admin'?'rt-admin':'rt-faculty')
  const menu=CU.role==='admin'?ADMIN_NAV:FACULTY_NAV
  $('sidebar-nav').innerHTML=menu.map(n=>
    `<div class="ni" id="ni-${n.id}" onclick="showPg('${n.id}');closeSidebar()"><i class="ti ${n.icon}" aria-hidden="true"></i><span>${n.label}</span></div>`
  ).join('')
  if($('add-stu-btn'))    $('add-stu-btn').style.display    = CU.role==='admin'?'inline-flex':'none'
  if($('import-stu-btn')) $('import-stu-btn').style.display = CU.role==='admin'?'inline-flex':'none'
  if($('set-acy'))        $('set-acy').value     = DB.settings.academic_year||''
  if($('set-college'))    $('set-college').value = DB.settings.college_name||''
  if($('set-min'))        $('set-min').value     = DB.settings.min_attendance||75
  if($('set-thresh'))     $('set-thresh').value  = DB.settings.alert_threshold||70
  // Populate report subject dropdowns
  const allSubs=CU.role==='admin'?DB.subjects:DB.subjects.filter(s=>(s.faculty_subjects||[]).some(fs=>fs.faculty_id===CU.id))
  const sfSel=$('rp-sub-filter')
  const dSel=$('rp-sub')
  if(sfSel) sfSel.innerHTML='<option value="">All Subjects</option>'+allSubs.map(s=>`<option value="${s.id}">${safe(s.name)} (${s.batch})</option>`).join('')
  if(dSel)  dSel.innerHTML=allSubs.map(s=>`<option value="${s.id}">${safe(s.name)} (${s.batch})</option>`).join('')
  showPg(CU.role==='admin'?'dashboard':'mysubjects')
}

let curPage=''
async function showPg(id){
  curPage=id
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'))
  const pg=$(`pg-${id}`); if(pg) pg.classList.add('active')
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'))
  const ni=$(`ni-${id}`); if(ni) ni.classList.add('active')
  if(id==='dashboard')  renderDash()
  if(id==='mark')       initMarkPage()
  if(id==='students')   renderStudents()
  if(id==='reports')    genReport()
  if(id==='history')    renderHistory()
  if(id==='mysubjects') renderMySubjects()
  if(id==='subjects')   renderAdminSubjects()
  if(id==='holidays')   renderHolidays()
  if(id==='promote')    renderPromotePage()
  if(id==='email')      renderEmailPage()
  if(id==='settings')   renderSettings()
}
window.showPg=showPg

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
async function renderDash(){
  $('dash-sub').textContent=`${DB.settings.college_name||''} — ${DB.settings.academic_year||''}`
  showLoad('Loading dashboard…')
  DB.attByStudentSubject={}
  await Promise.all(DB.subjects.map(async s=>{
    await fetchClassSchedule(s.id,DB.curSession?.id)
    await fetchAttForSubject(s.id,DB.curSession?.id)
  }))
  hideLoad()
  let sumP=0,cnt=0,low=0
  DB.students.forEach(s=>{const oa=getOverall(s.id);if(oa>0){sumP+=oa;cnt++;if(oa<70)low++}})
  const avg=cnt?Math.round(sumP/cnt):0
  $('d-total').textContent = DB.students.length
  $('d-avg').textContent   = avg+'%'
  $('d-low').textContent   = low
  $('d-risk-cnt').textContent = low

  $('d-subj').innerHTML=DB.subjects.map(sub=>{
    const sts=DB.students.filter(s=>s.batch===sub.batch)
    let tp=0; sts.forEach(s=>{tp+=getAttStat(s.id,sub.id).pct})
    const av=sts.length?Math.round(tp/sts.length):0
    const conducted=(DB.classSchedule[sub.id]||[]).length
    const typeBadge=sub.subject_type==='practical'?'<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">Practical</span>':''
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(sub.name)}${typeBadge}</div>
        <div style="font-size:11px;color:var(--subtle)">${sub.batch} · ${conducted} classes · ${safe(getTeacherNames(sub.id))}</div>
      </div>
      <div class="pb" style="width:70px"><div class="pf" style="width:${av}%;background:${pctColor(av)}"></div></div>
      <span style="font-size:13px;font-weight:800;color:${pctColor(av)};min-width:34px;text-align:right">${av}%</span>
    </div>`
  }).join('')

  const risks=DB.students.filter(s=>{const oa=getOverall(s.id);return oa<70&&oa>0;})
  $('d-atrisk').innerHTML=risks.length
    ?risks.slice(0,10).map(s=>{const oa=getOverall(s.id);return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="roll-b">${safe(s.roll)}</span>
          <div><div style="font-size:13px;font-weight:600">${safe(s.name)}</div><div style="font-size:11px;color:var(--subtle)">${s.batch}</div></div>
        </div>
        <span style="font-size:13px;font-weight:800;color:var(--danger)">${oa}%</span>
      </div>`}).join('')
    :'<p style="color:var(--subtle);font-size:13px;text-align:center;padding:16px 0">✓ No students below 70%</p>'

  const upcoming=DB.holidays.filter(h=>h.date>=todayStr()).slice(0,4)
  const hel=$('d-holidays')
  if(hel) hel.innerHTML=upcoming.length
    ?upcoming.map(h=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:600">${safe(h.name)}</span>
        <span class="badge bi" style="font-size:10px">${fmtDate(h.date)}</span>
      </div>`).join('')
    :'<p style="color:var(--subtle);font-size:13px">No upcoming holidays.</p>'

  const{data:logs}=await supabase.from('email_log').select('*').order('sent_at',{ascending:false}).limit(4)
  $('d-emaillog').innerHTML=logs?.length
    ?logs.map(e=>`<div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;font-size:13px">${safe(e.subject)}</div>
        <div style="font-size:11px;color:var(--muted)">To: ${safe(e.to_email)}</div>
        <div style="font-size:11px;color:var(--subtle)">${new Date(e.sent_at).toLocaleString('en-IN')}</div>
      </div>`).join('')
    :'<p style="color:var(--subtle);font-size:13px;text-align:center;padding:16px 0">No alerts sent yet.</p>'
}

// ═══════════════════════════════════════════════════════════
//  MARK ATTENDANCE  (with backdate block for faculty)
// ═══════════════════════════════════════════════════════════
let attDayMap = {}

async function initMarkPage(){
  const subs=getMySubjects()
  const sel=$('mk-sub')
  sel.innerHTML=subs.length
    ?subs.map(s=>{
        const typeTag = s.subject_type==='practical'?' [Practical]':''
        return `<option value="${s.id}">${safe(s.name)}${typeTag} — ${s.batch}</option>`
      }).join('')
    :'<option value="">No subjects assigned</option>'

  // Faculty: force today's date only
  const dateInput=$('mk-date')
  const today=todayStr()
  dateInput.value=today
  if(CU.role==='faculty'){
    dateInput.setAttribute('max',today)
    dateInput.setAttribute('min',today)
    dateInput.readOnly=true
    dateInput.title='Faculty can only mark today\'s attendance'
    dateInput.style.background='#f8fafc'
  } else {
    dateInput.removeAttribute('max')
    dateInput.removeAttribute('min')
    dateInput.readOnly=false
    dateInput.title=''
    dateInput.style.background=''
  }

  const banner=$('fac-lock-banner')
  if(CU.role==='faculty'){
    $('fac-lock-txt').textContent=`Restricted to: ${subs.map(s=>s.name).join(', ')||'None'}. You can only mark today's attendance.`
    banner.style.display='flex'
  } else { banner.style.display='none' }

  $('att-card').style.display='none'
  if(subs.length){ sel.value=subs[0].id; await loadAttForm() }
}

async function loadAttForm(){
  const subId=$('mk-sub').value
  const date=$('mk-date').value
  const card=$('att-card')
  if(!subId||!date){ card.style.display='none'; return }

  // ── BACKDATE CHECK for faculty ──
  if(CU.role==='faculty' && date!==todayStr()){
    card.style.display='none'
    toast('Faculty can only mark today\'s attendance.','e')
    $('mk-date').value=todayStr()
    return
  }

  if(!getMySubjects().find(s=>s.id===subId) && CU.role==='faculty'){
    toast('Access denied for this subject.','e'); card.style.display='none'; return
  }
  if(isHoliday(date)){
    card.style.display='none'; toast(`${fmtDate(date)} is a holiday.`,'i'); return
  }

  const sub=DB.subjects.find(s=>s.id===subId); if(!sub) return

  // For practical subjects, show batch selector
  const isPrac = sub.subject_type==='practical'
  const pracBatchSel=$('mk-prac-batch')
  if(pracBatchSel){
    pracBatchSel.style.display=isPrac?'flex':'none'
  }

  showLoad('Loading…')
  await fetchLocksForSubject(subId)
  await fetchClassSchedule(subId,DB.curSession?.id)
  const locked=isDateLocked(subId,date)
  const isFaculty=CU.role==='faculty'
  const readOnly=locked&&isFaculty

  // Get students: for practical, filter by selected batch
  const pracBatch=isPrac?($('mk-prac-batch-val')?.value||'A'):null
  const students=isPrac
    ?getStudentsForSubjectAndBatch(sub,pracBatch)
    :DB.students.filter(s=>s.batch===sub.batch)

  attDayMap=await fetchDayAtt(subId,date)
  hideLoad()

  card.style.display='block'
  const lockedBadge=locked?`<span class="badge ba" style="font-size:10px;margin-left:6px"><i class="ti ti-lock" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>${isFaculty?'Locked':'Locked by faculty'}</span>`:''
  const pracTag=isPrac?`<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">${pracBatch?getPracBatchLabel(pracBatch):''}</span>`:''
  $('att-title').innerHTML=`${safe(sub.name)}${pracTag} — ${fmtDate(date)}${lockedBadge}`
  $('att-conducted').textContent=`Classes conducted: ${(DB.classSchedule[subId]||[]).length} | Students: ${students.length}`

  // Load existing topic for this date
  const existingTopic=(DB.classTopics?.[subId]?.[date])||''
  const topicEl=$('att-topic')
  const topicWrap=$('att-topic-wrap')
  if(topicEl){
    topicEl.value=existingTopic
    topicEl.disabled=readOnly
    topicEl.style.background=readOnly?'#f8fafc':''
  }
  if(topicWrap) topicWrap.style.display='block'

  $('att-list').innerHTML=students.length?students.map(s=>{
    const st=attDayMap[s.id]||'present'
    return `<div class="att-row" id="ar-${s.id}">
      <div class="att-ri">
        <span class="roll-b">${safe(s.roll)}</span>
        <div>
          <div style="font-size:13px;font-weight:700">${safe(s.name)}</div>
          <div style="font-size:11px;color:var(--subtle)">${s.batch}${isPrac?' · '+getPracBatchLabel(getPracBatch(s.roll)):''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span class="badge ${st==='present'?'bp':'ba'}" id="lbl-${s.id}" style="min-width:58px;justify-content:center">${st==='present'?'Present':'Absent'}</span>
        ${readOnly
          ?'<div style="width:40px;height:22px;border-radius:11px;background:#e2e8f0;opacity:.5"></div>'
          :`<button class="toggle ${st==='present'?'p':'a'}" id="tgl-${s.id}" onclick="toggleAtt('${s.id}','${subId}','${date}')" aria-label="Toggle"></button>`
        }
      </div>
    </div>`
  }).join(''):'<p style="color:var(--subtle);text-align:center;padding:20px 0">No students in this batch/group.</p>'

  updateCounts(students)
  $('save-att-btn').style.display=readOnly?'none':'inline-flex'
  const adminEditBtn=$('admin-edit-btn')
  if(adminEditBtn) adminEditBtn.style.display=(locked&&CU.role==='admin')?'inline-flex':'none'
  if(locked&&isFaculty) toast('Locked. Contact admin to edit.','i')
}
window.loadAttForm=loadAttForm

async function switchPracBatch(val){
  if($('mk-prac-batch-val')) $('mk-prac-batch-val').value=val
  document.querySelectorAll('.prac-tab').forEach(t=>t.classList.remove('active'))
  document.querySelectorAll(`.prac-tab[data-b="${val}"]`).forEach(t=>t.classList.add('active'))
  await loadAttForm()
}
window.switchPracBatch=switchPracBatch

async function fetchDayAtt(subjectId,date){
  const{data}=await supabase.from('attendance').select('student_id,status').eq('subject_id',subjectId).eq('date',date)
  const map={}; (data||[]).forEach(r=>map[r.student_id]=r.status); return map
}

function toggleAtt(studentId,subId,date){
  const cur=attDayMap[studentId]||'present'
  const next=cur==='present'?'absent':'present'
  attDayMap[studentId]=next
  const btn=$(`tgl-${studentId}`), lbl=$(`lbl-${studentId}`)
  if(btn) btn.className='toggle '+(next==='present'?'p':'a')
  if(lbl){lbl.className='badge '+(next==='present'?'bp':'ba');lbl.textContent=next==='present'?'Present':'Absent'}
  const sub=DB.subjects.find(s=>s.id===subId)
  const isPrac=sub?.subject_type==='practical'
  const pracBatch=isPrac?($('mk-prac-batch-val')?.value||'A'):null
  updateCounts(isPrac?getStudentsForSubjectAndBatch(sub,pracBatch):DB.students.filter(s=>s.batch===sub?.batch))
}
window.toggleAtt=toggleAtt

function markAll(status){
  const subId=$('mk-sub').value, date=$('mk-date').value
  if(!subId||!date){toast('Select subject and date.','i');return}
  if(CU.role==='faculty'&&isDateLocked(subId,date)){toast('Locked.','i');return}
  if(CU.role==='faculty'&&date!==todayStr()){toast('Only today\'s date allowed.','e');return}
  const sub=DB.subjects.find(s=>s.id===subId)
  const isPrac=sub?.subject_type==='practical'
  const pracBatch=isPrac?($('mk-prac-batch-val')?.value||'A'):null
  const sts=isPrac?getStudentsForSubjectAndBatch(sub,pracBatch):DB.students.filter(s=>s.batch===sub.batch)
  sts.forEach(s=>{
    attDayMap[s.id]=status
    const btn=$(`tgl-${s.id}`), lbl=$(`lbl-${s.id}`)
    if(btn) btn.className='toggle '+(status==='present'?'p':'a')
    if(lbl){lbl.className='badge '+(status==='present'?'bp':'ba');lbl.textContent=status==='present'?'Present':'Absent'}
  })
  updateCounts(sts)
}
window.markAll=markAll

function updateCounts(students){
  let p=0,a=0
  students.forEach(s=>{if(attDayMap[s.id]==='present'||!attDayMap[s.id]) p++; else a++})
  $('ct-p').textContent=p+' Present'; $('ct-a').textContent=a+' Absent'
}

async function saveAtt(){
  const subId=$('mk-sub').value, date=$('mk-date').value
  if(!subId||!date){toast('Nothing to save.','i');return}
  if(CU.role==='faculty'&&isDateLocked(subId,date)){toast('Already locked.','e');return}
  if(CU.role==='faculty'&&date!==todayStr()){toast('Faculty can only mark today.','e');return}
  const sub=DB.subjects.find(s=>s.id===subId)
  const isPrac=sub?.subject_type==='practical'
  const pracBatch=isPrac?($('mk-prac-batch-val')?.value||'A'):null
  const sts=isPrac?getStudentsForSubjectAndBatch(sub,pracBatch):DB.students.filter(s=>s.batch===sub.batch)
  if(!sts.length){toast('No students.','i');return}
  showLoad('Saving…')
  const rows=sts.map(s=>({
    student_id:s.id, subject_id:subId, session_id:DB.curSession?.id,
    date, status:attDayMap[s.id]||'present', marked_by:CU.id, locked:false
  }))
  const{error}=await supabase.from('attendance').upsert(rows,{onConflict:'student_id,subject_id,date'})
  if(error){hideLoad();toast('Save failed: '+error.message,'e');return}

  // Save topic to class_schedule
  const topicVal=($('att-topic')?.value||'').trim()
  await supabase.from('class_schedule').upsert(
    {subject_id:subId,session_id:DB.curSession?.id,date,topic:topicVal||null},
    {onConflict:'subject_id,date'}
  )
  if(!DB.classSchedule[subId]) DB.classSchedule[subId]=[]
  if(!DB.classSchedule[subId].includes(date)) DB.classSchedule[subId].push(date)
  if(!DB.classTopics) DB.classTopics={}
  if(!DB.classTopics[subId]) DB.classTopics[subId]={}
  if(topicVal) DB.classTopics[subId][date]=topicVal
  if(CU.role==='faculty'){
    await supabase.from('attendance_locks').upsert({subject_id:subId,session_id:DB.curSession?.id,date,locked_by:CU.id},{onConflict:'subject_id,date'})
    await supabase.from('attendance').update({locked:true}).eq('subject_id',subId).eq('date',date)
    DB.attLocks[`${subId}_${date}`]=true
    hideLoad(); toast('Saved & locked. Admin can edit if needed.','s')
    await loadAttForm()
  } else {
    hideLoad(); toast('Attendance saved!','s')
  }
}
window.saveAtt=saveAtt

async function adminUnlock(){
  const subId=$('mk-sub').value, date=$('mk-date').value
  if(!subId||!date||CU.role!=='admin') return
  openModal(`
    <h3 style="color:var(--danger)"><i class="ti ti-lock-open" style="font-size:15px;vertical-align:-2px;margin-right:6px"></i>Unlock Attendance</h3>
    <p style="font-size:14px;color:var(--muted);margin-bottom:14px">Unlock attendance for <strong>${fmtDate(date)}</strong>? Faculty will be able to re-edit.</p>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmUnlock('${subId}','${date}')"><i class="ti ti-lock-open"></i>Unlock</button>
    </div>`)
}
window.adminUnlock=adminUnlock

async function confirmUnlock(subId,date){
  showLoad('Unlocking…')
  await supabase.from('attendance_locks').delete().eq('subject_id',subId).eq('date',date)
  await supabase.from('attendance').update({locked:false}).eq('subject_id',subId).eq('date',date)
  delete DB.attLocks[`${subId}_${date}`]
  hideLoad(); closeModal(); toast('Unlocked. You can now edit.','s'); await loadAttForm()
}
window.confirmUnlock=confirmUnlock

// ═══════════════════════════════════════════════════════════
//  STUDENTS — ADD / EDIT / DELETE / IMPORT
// ═══════════════════════════════════════════════════════════
async function renderStudents(){
  const search=($('stu-search')?.value||'').toLowerCase()
  const batch=$('stu-batch')?.value||''
  let list=DB.students
  if(CU.role==='faculty'){
    const batches=[...new Set(getMySubjects().map(s=>s.batch))]
    list=list.filter(s=>batches.includes(s.batch))
    if($('stu-sub')) $('stu-sub').textContent='Students in your assigned batch(es)'
  }
  if(batch) list=list.filter(s=>s.batch===batch)
  if(search) list=list.filter(s=>
    s.name?.toLowerCase().includes(search)||
    s.roll?.toLowerCase().includes(search)||
    s.email?.toLowerCase().includes(search)
  )
  $('stu-tbody').innerHTML=list.map(s=>{
    const oa=getOverall(s.id), col=pctColor(oa)
    const pracBadge=s.prac_batch?`<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:700">Batch ${s.prac_batch}</span>`:''
    return `<tr>
      <td><span class="roll-b">${safe(s.roll)}</span></td>
      <td style="font-weight:700">${safe(s.name)}${pracBadge}</td>
      <td>${s.batch}</td>
      <td class="hide-mobile">Yr ${s.year||1}</td>
      <td class="hide-mobile" style="color:var(--muted);font-size:12px">${safe(s.email||'—')}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="pb" style="width:56px"><div class="pf" style="width:${oa}%;background:${col}"></div></div>
          <span style="font-weight:800;color:${col};font-size:12px">${oa}%</span>
        </div>
      </td>
      <td><span class="badge ${pctBadge(oa)}" style="font-size:10px">${oa>=75?'Good':oa>=60?'Warn':'Risk'}</span></td>
      <td>
        <div style="display:flex;gap:3px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="showStudentModal('${s.id}')"><i class="ti ti-eye"></i></button>
          ${CU.role==='admin'?`
            <button class="btn btn-sm btn-info" onclick="showEditStudentModal('${s.id}')"><i class="ti ti-edit"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteStudent('${s.id}')"><i class="ti ti-trash"></i></button>
          `:''}
        </div>
      </td>
    </tr>`
  }).join('')
}
window.renderStudents=renderStudents

function showAddStudentModal(){
  openModal(`
    <h3><i class="ti ti-user-plus" style="font-size:15px;vertical-align:-2px;margin-right:6px;color:var(--accent)"></i>Add New Student</h3>
    <div class="form-row">
      <div class="mg"><label>Full Name *</label><input id="ns-name" type="text" placeholder="Student full name"/></div>
      <div class="mg"><label>Roll Number *</label><input id="ns-roll" type="text" placeholder="BDS-1-11"/></div>
    </div>
    <div class="form-row">
      <div class="mg"><label>Batch *</label>
        <select id="ns-batch">
          <option value="BDS-1">BDS Year 1</option><option value="BDS-2">BDS Year 2</option>
          <option value="BDS-3">BDS Year 3</option><option value="BDS-4">BDS Year 4</option>
        </select>
      </div>
      <div class="mg"><label>Practical Batch</label>
        <select id="ns-prac-batch">
          <option value="">Auto (from roll no.)</option>
          <option value="A">Batch A (Roll 1–50)</option>
          <option value="B">Batch B (Roll 51–100)</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="mg"><label>Phone</label><input id="ns-phone" type="text" placeholder="Parent mobile"/></div>
      <div class="mg"><label>Parent Email</label><input id="ns-email" type="email" placeholder="parent@email.com"/></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addStudent()"><i class="ti ti-check"></i>Add Student</button>
    </div>`)
}
window.showAddStudentModal=showAddStudentModal

async function addStudent(){
  const name=$('ns-name').value.trim(), roll=$('ns-roll').value.trim(), batch=$('ns-batch').value
  const phone=$('ns-phone').value.trim(), email=$('ns-email').value.trim()
  const pracBatch=$('ns-prac-batch').value||getPracBatch(roll)
  if(!name||!roll){toast('Name and Roll required.','e');return}
  if(DB.students.find(s=>s.roll===roll)){toast('Roll number exists.','e');return}
  showLoad('Adding…')
  const{data,error}=await supabase.from('students').insert({
    roll,name,batch,year:parseInt(batch.split('-')[1]),phone,email,prac_batch:pracBatch,
    session_id:DB.curSession?.id,is_active:true
  }).select().single()
  hideLoad()
  if(error){toast('Failed: '+error.message,'e');return}
  DB.students.push(data); DB.students.sort((a,b)=>a.roll.localeCompare(b.roll))
  closeModal(); renderStudents(); toast(`${name} added!`,'s')
}
window.addStudent=addStudent

// ── EDIT STUDENT ─────────────────────────────────────────────
function showEditStudentModal(id){
  const s=DB.students.find(st=>st.id===id); if(!s) return
  openModal(`
    <h3><i class="ti ti-edit" style="font-size:15px;vertical-align:-2px;margin-right:6px;color:var(--info)"></i>Edit Student</h3>
    <div class="form-row">
      <div class="mg"><label>Full Name *</label><input id="es-name" type="text" value="${safe(s.name)}"/></div>
      <div class="mg"><label>Roll Number *</label><input id="es-roll" type="text" value="${safe(s.roll)}"/></div>
    </div>
    <div class="form-row">
      <div class="mg"><label>Batch *</label>
        <select id="es-batch">
          <option value="BDS-1" ${s.batch==='BDS-1'?'selected':''}>BDS Year 1</option>
          <option value="BDS-2" ${s.batch==='BDS-2'?'selected':''}>BDS Year 2</option>
          <option value="BDS-3" ${s.batch==='BDS-3'?'selected':''}>BDS Year 3</option>
          <option value="BDS-4" ${s.batch==='BDS-4'?'selected':''}>BDS Year 4</option>
        </select>
      </div>
      <div class="mg"><label>Practical Batch</label>
        <select id="es-prac-batch">
          <option value="A" ${s.prac_batch==='A'?'selected':''}>Batch A (Roll 1–50)</option>
          <option value="B" ${s.prac_batch==='B'?'selected':''}>Batch B (Roll 51–100)</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="mg"><label>Phone</label><input id="es-phone" type="text" value="${safe(s.phone||'')}"/></div>
      <div class="mg"><label>Parent Email</label><input id="es-email" type="email" value="${safe(s.email||'')}"/></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-info" onclick="saveEditStudent('${id}')"><i class="ti ti-device-floppy"></i>Save Changes</button>
    </div>`)
}
window.showEditStudentModal=showEditStudentModal

async function saveEditStudent(id){
  const name=$('es-name').value.trim(), roll=$('es-roll').value.trim(), batch=$('es-batch').value
  const phone=$('es-phone').value.trim(), email=$('es-email').value.trim(), pracBatch=$('es-prac-batch').value
  if(!name||!roll){toast('Name and Roll required.','e');return}
  const duplicate=DB.students.find(s=>s.roll===roll&&s.id!==id)
  if(duplicate){toast('Roll number already used by another student.','e');return}
  showLoad('Saving…')
  const{error}=await supabase.from('students').update({
    name,roll,batch,year:parseInt(batch.split('-')[1]),phone,email,prac_batch:pracBatch
  }).eq('id',id)
  hideLoad()
  if(error){toast('Failed: '+error.message,'e');return}
  const st=DB.students.find(s=>s.id===id)
  if(st){st.name=name;st.roll=roll;st.batch=batch;st.year=parseInt(batch.split('-')[1]);st.phone=phone;st.email=email;st.prac_batch=pracBatch}
  DB.students.sort((a,b)=>a.roll.localeCompare(b.roll))
  closeModal(); renderStudents(); toast('Student updated!','s')
}
window.saveEditStudent=saveEditStudent

function deleteStudent(id){
  const s=DB.students.find(st=>st.id===id)
  openModal(`
    <h3 style="color:var(--danger)">Delete Student</h3>
    <div style="background:#f8fafc;border-radius:9px;padding:12px;margin-bottom:14px">
      <div style="font-size:15px;font-weight:800">${safe(s.name)}</div>
      <div style="font-size:13px;color:var(--muted)">${safe(s.roll)} · ${s.batch}</div>
    </div>
    <div class="banner banner-amber"><i class="ti ti-alert-triangle"></i>All attendance records deleted too. Cannot be undone.</div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDeleteStudent('${id}')"><i class="ti ti-trash"></i>Delete</button>
    </div>`)
}
window.deleteStudent=deleteStudent

async function confirmDeleteStudent(id){
  showLoad('Deleting…')
  await supabase.from('attendance').delete().eq('student_id',id)
  await supabase.from('students').delete().eq('id',id)
  DB.students=DB.students.filter(s=>s.id!==id)
  hideLoad(); closeModal(); renderStudents(); toast('Deleted.','s')
}
window.confirmDeleteStudent=confirmDeleteStudent

async function showStudentModal(id){
  const s=DB.students.find(st=>st.id===id); if(!s) return
  const subs=DB.subjects.filter(sub=>sub.batch===s.batch)
  showLoad('Loading…')
  DB.attByStudentSubject=DB.attByStudentSubject||{}
  await Promise.all(subs.map(async sub=>{
    await fetchClassSchedule(sub.id,DB.curSession?.id)
    await fetchAttForSubject(sub.id,DB.curSession?.id)
  }))
  hideLoad()
  const oa=getOverall(id)
  openModal(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="avatar-c" style="background:#eff6ff;color:#1d4ed8">${ini(s.name)}</div>
        <div><h3 style="font-size:15px;margin:0">${safe(s.name)}</h3>
          <p style="color:var(--muted);font-size:12px;margin:2px 0 0">${safe(s.roll)} · ${s.batch} · Prac Batch ${s.prac_batch||'A'}</p></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:${pctColor(oa)}">${oa}%</div>
        <div style="font-size:11px;color:var(--muted)">Overall</div>
      </div>
    </div>
    <div class="tbl-wrap" style="margin-bottom:14px">
      <table>
        <thead><tr><th>Subject</th><th>Type</th><th>Present</th><th>Absent</th><th>Classes</th><th>%</th></tr></thead>
        <tbody>${subs.map(sub=>{
          const a=getAttStat(id,sub.id)
          const typeTag=sub.subject_type==='practical'?'<span style="background:#fef3c7;color:#92400e;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">Prac</span>':'<span style="background:#eff6ff;color:#1d4ed8;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">Theory</span>'
          return `<tr>
            <td style="font-weight:600;font-size:12px">${safe(sub.name)}</td>
            <td>${typeTag}</td>
            <td style="color:var(--success);font-weight:700">${a.p}</td>
            <td style="color:var(--danger);font-weight:700">${a.a}</td>
            <td>${a.t}</td>
            <td style="font-weight:800;color:${pctColor(a.pct)}">${a.t>0?a.pct+'%':'—'}</td>
          </tr>`
        }).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn" onclick="closeModal()">Close</button>
      <button class="btn btn-info" onclick="closeModal();showEditStudentModal('${id}')"><i class="ti ti-edit"></i>Edit</button>
      ${oa<75?`<button class="btn btn-primary" onclick="emailOneStudent('${id}');closeModal()"><i class="ti ti-mail"></i>Alert Parent</button>`:''}
    </div>`)
}
window.showStudentModal=showStudentModal

// ── CSV/EXCEL IMPORT ─────────────────────────────────────────
function showImportModal(){
  openModal(`
    <h3><i class="ti ti-file-import" style="font-size:15px;vertical-align:-2px;margin-right:6px;color:var(--info)"></i>Import Students</h3>
    <div class="banner banner-blue"><i class="ti ti-info-circle"></i>Required columns: <strong>name, roll, batch, phone, email</strong><br>Optional: <strong>prac_batch</strong> (A or B — auto-detected from roll if missing)<br>Batch values: BDS-1 / BDS-2 / BDS-3 / BDS-4</div>
    <div style="margin:14px 0">
      <input type="file" id="import-file" accept=".csv,.xlsx,.xls" onchange="previewImport(event)"
        style="width:100%;padding:10px;border:2px dashed var(--border);border-radius:9px;font-size:13px;cursor:pointer"/>
    </div>
    <div id="import-preview" style="margin-bottom:12px"></div>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="import-confirm-btn" style="display:none" onclick="confirmImport()"><i class="ti ti-upload"></i>Import</button>
    </div>`)
}
window.showImportModal=showImportModal

let importRows=[]
function previewImport(event){
  const file=event.target.files[0]; if(!file) return
  const reader=new FileReader()
  reader.onload=e=>{
    try{
      let rows=[]
      if(file.name.endsWith('.csv')){
        const lines=e.target.result.split('\n').filter(l=>l.trim())
        const headers=lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z_]/g,''))
        rows=lines.slice(1).map(line=>{
          const vals=line.split(',').map(v=>v.trim().replace(/^"|"$/g,''))
          const obj={}; headers.forEach((h,i)=>obj[h]=vals[i]||''); return obj
        }).filter(r=>r.name&&r.roll)
      } else {
        const wb=XLSX.read(e.target.result,{type:'array'})
        const ws=wb.Sheets[wb.SheetNames[0]]
        const raw=XLSX.utils.sheet_to_json(ws,{defval:''})
        rows=raw.map(r=>{const n={};Object.entries(r).forEach(([k,v])=>n[k.toLowerCase().trim()]=String(v).trim());return n}).filter(r=>r.name&&r.roll)
      }
      const batches=['BDS-1','BDS-2','BDS-3','BDS-4']
      importRows=rows.map(r=>({
        name:r.name||'', roll:r.roll||'',
        batch:batches.includes(r.batch)?r.batch:'BDS-1',
        phone:r.phone||'', email:r.email||'',
        year:parseInt((r.batch||'BDS-1').split('-')[1])||1,
        prac_batch:['A','B'].includes((r.prac_batch||'').toUpperCase())?(r.prac_batch||'').toUpperCase():getPracBatch(r.roll)
      })).filter(r=>r.name&&r.roll)
      const dupes=importRows.filter(r=>DB.students.find(s=>s.roll===r.roll))
      $('import-preview').innerHTML=`
        <div class="banner ${importRows.length?'banner-green':'banner-amber'}">
          <i class="ti ${importRows.length?'ti-circle-check':'ti-alert-triangle'}"></i>
          <strong>${importRows.length}</strong> valid rows.
          ${dupes.length?`<span style="color:var(--danger)">${dupes.length} duplicates skipped.</span>`:'All new.'}
        </div>
        <div class="tbl-wrap" style="max-height:180px;overflow-y:auto">
          <table><thead><tr><th>Roll</th><th>Name</th><th>Batch</th><th>Prac Batch</th></tr></thead>
          <tbody>${importRows.slice(0,8).map(r=>`<tr><td>${safe(r.roll)}</td><td>${safe(r.name)}</td><td>${r.batch}</td><td>Batch ${r.prac_batch}</td></tr>`).join('')}
          ${importRows.length>8?`<tr><td colspan="4" style="text-align:center;color:var(--subtle)">…${importRows.length-8} more</td></tr>`:''}</tbody></table>
        </div>`
      $('import-confirm-btn').style.display=importRows.length?'inline-flex':'none'
    }catch(err){toast('Parse failed: '+err.message,'e')}
  }
  if(file.name.endsWith('.csv')) reader.readAsText(file); else reader.readAsArrayBuffer(file)
}
window.previewImport=previewImport

async function confirmImport(){
  const newRows=importRows.filter(r=>!DB.students.find(s=>s.roll===r.roll))
  if(!newRows.length){toast('No new students.','i');return}
  showLoad(`Importing ${newRows.length}…`)
  const{data,error}=await supabase.from('students').insert(newRows.map(r=>({...r,session_id:DB.curSession?.id,is_active:true}))).select()
  hideLoad()
  if(error){toast('Failed: '+error.message,'e');return}
  DB.students.push(...(data||[])); DB.students.sort((a,b)=>a.roll.localeCompare(b.roll))
  closeModal(); renderStudents(); toast(`${data?.length} students imported!`,'s')
}
window.confirmImport=confirmImport

// ═══════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════
async function genReport(){
  const type=$('rp-type')?.value||'overview'
  const batch=$('rp-batch')?.value||''
  const year=$('rp-year')?.value||''
  const thresh=parseInt($('rp-thresh')?.value||70)
  const subFilter=$('rp-sub-filter')?.value||''
  const dateFrom=$('rp-date-from')?.value||''
  const dateTo=$('rp-date-to')?.value||''
  const thead=$('rp-thead'), tbody=$('rp-tbody')

  // Show/hide relevant filter rows
  const subWrap=$('rp-sub-wrap')
  const dateWrap=$('rp-date-wrap')
  const subFilterWrap=$('rp-sub-filter-wrap')
  if(subWrap)    subWrap.style.display   = type==='daily'?'flex':'none'
  if(dateWrap)   dateWrap.style.display  = (type==='daily'||type==='datewise')?'flex':'none'
  if(subFilterWrap) subFilterWrap.style.display = (type==='subject'||type==='datewise'||type==='daily')?'flex':'none'

  let students=DB.students
  if(CU.role==='faculty'){
    const batches=[...new Set(getMySubjects().map(s=>s.batch))]
    students=students.filter(s=>batches.includes(s.batch))
  }
  if(batch) students=students.filter(s=>s.batch===batch)
  if(year)  students=students.filter(s=>String(s.year||'1')===year)

  // ── OVERALL SUMMARY ──────────────────────────────────────
  if(type==='overview'){
    $('rp-title').textContent='Overall Attendance Summary'
    thead.innerHTML='<tr><th>Roll</th><th>Name</th><th>Batch</th><th>Year</th><th>Prac Batch</th><th>Overall %</th><th>Status</th><th>Action</th></tr>'
    const rows=students.map(s=>{
      const oa=getOverall(s.id)
      return {s,oa}
    }).filter(({s,oa})=>!thresh||oa===0||(thresh&&oa<=100))
    tbody.innerHTML=rows.map(({s,oa})=>`<tr>
      <td><span class="roll-b">${safe(s.roll)}</span></td>
      <td style="font-weight:700">${safe(s.name)}</td>
      <td>${s.batch}</td>
      <td>Year ${s.year||1}</td>
      <td><span class="tag-batch-${(s.prac_batch||'a').toLowerCase()}">Batch ${s.prac_batch||'A'}</span></td>
      <td style="font-weight:800;color:${pctColor(oa)}">${oa}%</td>
      <td><span class="badge ${pctBadge(oa)}">${oa>=75?'Good':oa>=60?'Warn':'Risk'}</span></td>
      <td><button class="btn btn-sm" onclick="showStudentModal('${s.id}')"><i class="ti ti-eye"></i></button></td>
    </tr>`).join('')
    $('rp-cnt').textContent=rows.length+' students'

  // ── SUBJECT-WISE ─────────────────────────────────────────
  } else if(type==='subject'){
    $('rp-title').textContent='Subject-wise Attendance'
    let subs=CU.role==='faculty'?getMySubjects():(batch?DB.subjects.filter(s=>s.batch===batch):DB.subjects)
    if(subFilter) subs=subs.filter(s=>s.id===subFilter)
    thead.innerHTML=`<tr><th>Subject</th><th>Type</th><th>Batch</th><th>Faculty</th><th>Classes</th><th>Avg %</th><th>Below ${thresh}%</th><th>Action</th></tr>`
    tbody.innerHTML=subs.map(sub=>{
      const sts=students.filter(s=>s.batch===sub.batch)
      let tp=0,bl=0
      sts.forEach(s=>{const a=getAttStat(s.id,sub.id);tp+=a.pct;if(a.pct<thresh&&a.t>0) bl++})
      const av=sts.length?Math.round(tp/sts.length):0
      const conducted=(DB.classSchedule[sub.id]||[]).length
      const typeTag=sub.subject_type==='practical'
        ?'<span class="tag-practical">Practical</span>'
        :'<span class="tag-theory">Theory</span>'
      return `<tr>
        <td style="font-weight:700">${safe(sub.name)}</td>
        <td>${typeTag}</td>
        <td>${sub.batch}</td>
        <td style="font-size:12px">${safe(getTeacherNames(sub.id))}</td>
        <td>${conducted}</td>
        <td style="font-weight:800;color:${pctColor(av)}">${av}%</td>
        <td><span class="badge ${bl>0?'ba':'bp'}">${bl}</span></td>
        <td><button class="btn btn-sm" onclick="showSubjReport('${sub.id}')"><i class="ti ti-eye"></i></button></td>
      </tr>`
    }).join('')
    $('rp-cnt').textContent=subs.length+' subjects'

  // ── BELOW THRESHOLD ──────────────────────────────────────
  } else if(type==='low'){
    $('rp-title').textContent=`Students Below ${thresh}% Attendance`
    const low=students.filter(s=>{const oa=getOverall(s.id);return oa<thresh&&oa>0;})
    thead.innerHTML=`<tr><th>Roll</th><th>Name</th><th>Batch</th><th>Year</th><th>Overall %</th><th>Shortage</th><th>Parent Email</th><th>Action</th></tr>`
    tbody.innerHTML=low.map(s=>{
      const oa=getOverall(s.id)
      // Calculate classes needed
      const subs=DB.subjects.filter(sub=>sub.batch===s.batch)
      let totalConducted=0
      subs.forEach(sub=>{ totalConducted+=(DB.classSchedule[sub.id]||[]).length })
      const minRequired=Math.ceil(totalConducted*thresh/100)
      const actualPresent=Math.round(oa*totalConducted/100)
      const shortage=Math.max(0,minRequired-actualPresent)
      return `<tr>
        <td><span class="roll-b">${safe(s.roll)}</span></td>
        <td style="font-weight:700">${safe(s.name)}</td>
        <td>${s.batch}</td>
        <td>Year ${s.year||1}</td>
        <td style="font-weight:800;color:var(--danger)">${oa}%</td>
        <td><span style="background:#fee2e2;color:#991b1b;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700">${shortage} classes short</span></td>
        <td style="font-size:12px;color:var(--muted)">${safe(s.email||'—')}</td>
        <td><div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="showStudentModal('${s.id}')"><i class="ti ti-eye"></i></button>
          <button class="btn btn-sm" onclick="emailOneStudent('${s.id}')"><i class="ti ti-mail"></i></button>
        </div></td>
      </tr>`
    }).join('')
    $('rp-cnt').textContent=low.length+' students'

  // ── DATE-WISE (with topic) ───────────────────────────────
  } else if(type==='datewise'){
    $('rp-title').textContent='Date-wise Class Report'
    let subs=CU.role==='faculty'?getMySubjects():(batch?DB.subjects.filter(s=>s.batch===batch):DB.subjects)
    if(subFilter) subs=subs.filter(s=>s.id===subFilter)
    showLoad('Loading date-wise data…')
    // Fetch all class_schedule records with topic for these subjects
    const subIds=subs.map(s=>s.id)
    let schedQuery=supabase.from('class_schedule')
      .select('subject_id,date,topic,subjects(name,code,batch)')
      .in('subject_id',subIds)
      .eq('session_id',DB.curSession?.id)
      .order('date',{ascending:false})
    if(dateFrom) schedQuery=schedQuery.gte('date',dateFrom)
    if(dateTo)   schedQuery=schedQuery.lte('date',dateTo)
    const{data:schedRecs}=await schedQuery

    // Fetch attendance summary per date
    const attQuery=supabase.from('attendance')
      .select('subject_id,date,status')
      .in('subject_id',subIds)
      .eq('session_id',DB.curSession?.id)
    const{data:attRecs}=await attQuery

    hideLoad()

    // Build summary: for each class date, count present/absent
    const summaryMap={}
    ;(attRecs||[]).forEach(r=>{
      const k=`${r.subject_id}_${r.date}`
      if(!summaryMap[k]) summaryMap[k]={p:0,a:0}
      if(r.status==='present') summaryMap[k].p++; else summaryMap[k].a++
    })

    thead.innerHTML='<tr><th>Date</th><th>Subject</th><th>Batch</th><th>Topic Covered</th><th>Present</th><th>Absent</th><th>Total</th><th>Att%</th></tr>'
    const rows=(schedRecs||[])
    tbody.innerHTML=rows.length?rows.map(r=>{
      const k=`${r.subject_id}_${r.date}`
      const sm=summaryMap[k]||{p:0,a:0}
      const t=sm.p+sm.a
      const pct=t>0?Math.round(sm.p/t*100):0
      const isHol=isHoliday(r.date)
      return `<tr ${isHol?'style="opacity:.5"':''}>
        <td style="white-space:nowrap">${fmtDate(r.date)}${isHol?'<span class="badge bl" style="margin-left:4px;font-size:9px">Holiday</span>':''}</td>
        <td style="font-weight:700">${safe(r.subjects?.name||'—')}</td>
        <td>${safe(r.subjects?.batch||'—')}</td>
        <td style="color:var(--info);font-size:12px;max-width:200px">${r.topic?`<span style="background:#eff6ff;padding:2px 8px;border-radius:4px;font-size:11px">${safe(r.topic)}</span>`:'<span style="color:var(--subtle)">—</span>'}</td>
        <td style="color:var(--success);font-weight:700">${sm.p}</td>
        <td style="color:var(--danger);font-weight:700">${sm.a}</td>
        <td>${t}</td>
        <td style="font-weight:800;color:${pctColor(pct)}">${t>0?pct+'%':'—'}</td>
      </tr>`
    }).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--subtle);padding:20px">No class records found for the selected filters.</td></tr>'
    $('rp-cnt').textContent=rows.length+' class records'

  // ── DAY-WISE STUDENT GRID ────────────────────────────────
  } else if(type==='daily'){
    const subId=$('rp-sub')?.value
    const sub=DB.subjects.find(s=>s.id===subId)
    $('rp-title').textContent=sub?`Day-wise: ${sub.name}`:'Day-wise'
    if(!sub){thead.innerHTML='';tbody.innerHTML='';return}
    showLoad('Loading…')
    let attQ=supabase.from('attendance').select('student_id,date,status').eq('subject_id',subId).eq('session_id',DB.curSession?.id).order('date',{ascending:false})
    if(dateFrom) attQ=attQ.gte('date',dateFrom)
    if(dateTo)   attQ=attQ.lte('date',dateTo)
    const{data:dayRecs}=await attQ
    hideLoad()
    let days=[...new Set((dayRecs||[]).map(r=>r.date))]
    const bySd={}
    ;(dayRecs||[]).forEach(r=>{if(!bySd[r.student_id])bySd[r.student_id]={};bySd[r.student_id][r.date]=r.status})
    // Filter students if prac batch filter
    let sts=students.filter(s=>s.batch===sub.batch)

    // Topic row
    const topicMap=DB.classTopics?.[subId]||{}

    thead.innerHTML=`<tr>
      <th>Roll</th><th>Name</th>
      ${days.map(d=>{
        const topic=topicMap[d]
        return `<th style="font-size:10px;min-width:60px;text-align:center">
          ${fmtDate(d)}${topic?`<div style="color:var(--info);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60px" title="${safe(topic)}">${safe(topic)}</div>`:''}
        </th>`
      }).join('')}
      <th>%</th>
    </tr>`
    tbody.innerHTML=sts.map(s=>{
      const cells=days.map(d=>{
        const v=bySd[s.id]?.[d]
        return `<td style="text-align:center">${v==='present'?'<span style="color:var(--success);font-weight:800">P</span>':v==='absent'?'<span style="color:var(--danger);font-weight:800">A</span>':'<span style="color:var(--subtle)">—</span>'}</td>`
      }).join('')
      const a=getAttStat(s.id,subId)
      return `<tr><td><span class="roll-b">${safe(s.roll)}</span></td><td style="font-weight:700">${safe(s.name)}</td>${cells}<td style="font-weight:800;color:${pctColor(a.pct)}">${a.t>0?a.pct+'%':'—'}</td></tr>`
    }).join('')
    $('rp-cnt').textContent=sts.length+' students'
  }
}
window.genReport=genReport

// ── Report filter helpers ────────────────────────────────────
function onReportTypeChange(){
  const type=$('rp-type')?.value||'overview'
  // Populate subject dropdowns from all subjects
  const allSubs=getMySubjects()
  const sfSel=$('rp-sub-filter')
  const dSel=$('rp-sub')
  if(sfSel){
    sfSel.innerHTML='<option value="">All Subjects</option>'+allSubs.map(s=>`<option value="${s.id}">${safe(s.name)} (${s.batch})</option>`).join('')
  }
  if(dSel){
    dSel.innerHTML=allSubs.map(s=>`<option value="${s.id}">${safe(s.name)} (${s.batch})</option>`).join('')
  }
  genReport()
}
window.onReportTypeChange=onReportTypeChange

function clearDateFilter(){
  const df=$('rp-date-from'), dt=$('rp-date-to')
  if(df) df.value=''; if(dt) dt.value=''
  genReport()
}
window.clearDateFilter=clearDateFilter

// ═══════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════
async function renderHistory(){
  const past=DB.sessions.filter(s=>!s.is_current)
  $('hist-session-sel').innerHTML=past.length
    ?past.map(s=>`<option value="${s.id}">${safe(s.label)}</option>`).join('')
    :'<option value="">No previous sessions</option>'
  if(past.length) await loadHistoryReport()
}
window.renderHistory=renderHistory

async function loadHistoryReport(){
  const sessionId=$('hist-session-sel')?.value
  const batch=$('hist-batch-sel')?.value||''
  if(!sessionId) return
  showLoad('Loading…')
  const{data:allRecs}=await supabase.from('attendance')
    .select('student_id,subject_id,status,students!inner(roll,name,batch),subjects(name,code)')
    .eq('session_id',sessionId)
  hideLoad()
  const map={}
  ;(allRecs||[]).forEach(r=>{
    if(batch&&r.students?.batch!==batch) return
    const k=r.student_id
    if(!map[k]) map[k]={student:r.students,subs:{}}
    if(!map[k].subs[r.subject_id]) map[k].subs[r.subject_id]={sub:r.subjects,p:0,t:0}
    map[k].subs[r.subject_id].t++
    if(r.status==='present') map[k].subs[r.subject_id].p++
  })
  const rows=Object.values(map)
  $('hist-tbody').innerHTML=rows.map(v=>{
    const s=v.student||{}
    let tp=0,tt=0
    Object.values(v.subs).forEach(x=>{tp+=x.p;tt+=x.t})
    const pct=tt>0?Math.round(tp/tt*100):0
    return `<tr>
      <td><span class="roll-b">${safe(s.roll)}</span></td>
      <td style="font-weight:700">${safe(s.name)}</td>
      <td>${safe(s.batch||'—')}</td>
      <td style="font-weight:800;color:${pctColor(pct)}">${pct}%</td>
      <td><span class="badge ${pctBadge(pct)}">${pct>=75?'Good':pct>=60?'Warn':'Risk'}</span></td>
    </tr>`
  }).join('')
  $('hist-count').textContent=rows.length+' students'
}
window.loadHistoryReport=loadHistoryReport

// ═══════════════════════════════════════════════════════════
//  MY SUBJECTS (Faculty)
// ═══════════════════════════════════════════════════════════
async function renderMySubjects(){
  const subs=getMySubjects()
  if($('mysub-p')) $('mysub-p').textContent=`${CU.name} — ${subs.length} subject(s) assigned`
  if(!subs.length){$('my-sub-grid').innerHTML='<p style="color:var(--subtle)">No subjects assigned.</p>';return}
  showLoad('Loading…')
  DB.attByStudentSubject=DB.attByStudentSubject||{}
  await Promise.all(subs.map(async s=>{
    await fetchClassSchedule(s.id,DB.curSession?.id)
    await fetchAttForSubject(s.id,DB.curSession?.id)
  }))
  hideLoad()
  $('my-sub-grid').innerHTML=subs.map(sub=>{
    const sts=DB.students.filter(s=>s.batch===sub.batch)
    let tp=0; sts.forEach(s=>{tp+=getAttStat(s.id,sub.id).pct})
    const av=sts.length?Math.round(tp/sts.length):0
    const conducted=(DB.classSchedule[sub.id]||[]).length
    const low=sts.filter(s=>{const a=getAttStat(s.id,sub.id);return a.pct<70&&a.t>0}).length
    const typeTag=sub.subject_type==='practical'
      ?'<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:5px;font-weight:700">Practical</span>'
      :'<span style="background:#eff6ff;color:#1d4ed8;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:5px;font-weight:700">Theory</span>'
    return `<div class="subj-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <h4 style="font-size:13px;font-weight:800">${safe(sub.name)}${typeTag}</h4>
          <div style="font-size:11px;color:var(--muted)">${safe(sub.code)} · ${sub.batch}</div>
        </div>
        <span style="font-size:17px;font-weight:800;color:${pctColor(av)}">${av}%</span>
      </div>
      <div class="pb" style="margin-bottom:8px"><div class="pf" style="width:${av}%;background:${pctColor(av)}"></div></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:11px">
        <span style="font-size:11px;color:var(--muted)">${sts.length} students · ${conducted} classes</span>
        ${low>0?`<span style="font-size:11px;color:var(--danger);font-weight:700">${low} below 70%</span>`:'<span style="font-size:11px;color:var(--success)">All ≥ 70%</span>'}
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        ${sub.subject_type==='practical'
          ?`<button class="btn btn-primary btn-sm" onclick="goMarkPrac('${sub.id}','A')"><i class="ti ti-checkbox"></i>Mark Batch A</button>
             <button class="btn btn-warn btn-sm" onclick="goMarkPrac('${sub.id}','B')"><i class="ti ti-checkbox"></i>Batch B</button>`
          :`<button class="btn btn-primary btn-sm" onclick="goMark('${sub.id}')"><i class="ti ti-checkbox"></i>Mark</button>`
        }
        <button class="btn btn-sm" onclick="showSubjReport('${sub.id}')"><i class="ti ti-chart-bar"></i>Report</button>
      </div>
    </div>`
  }).join('')
}

async function goMark(subId){
  showPg('mark')
  setTimeout(async()=>{ $('mk-sub').value=subId; await loadAttForm() },120)
}
window.goMark=goMark

async function goMarkPrac(subId,batch){
  showPg('mark')
  setTimeout(async()=>{
    $('mk-sub').value=subId
    const pbv=$('mk-prac-batch-val')
    if(pbv) pbv.value=batch
    document.querySelectorAll('.prac-tab').forEach(t=>t.classList.remove('active'))
    document.querySelectorAll(`.prac-tab[data-b="${batch}"]`).forEach(t=>t.classList.add('active'))
    await loadAttForm()
  },120)
}
window.goMarkPrac=goMarkPrac

async function showSubjReport(subId){
  const sub=DB.subjects.find(s=>s.id===subId)
  const sts=DB.students.filter(s=>s.batch===sub.batch)
  showLoad('Loading…')
  await fetchClassSchedule(subId,DB.curSession?.id)
  await fetchAttForSubject(subId,DB.curSession?.id)
  hideLoad()
  const conducted=(DB.classSchedule[subId]||[]).length
  openModal(`
    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <div><h3 style="font-size:15px;margin:0">${safe(sub.name)}</h3>
        <p style="color:var(--muted);font-size:12px;margin:2px 0 0">${safe(sub.code)} · ${sub.batch} · ${conducted} classes · ${sub.subject_type==='practical'?'Practical':'Theory'}</p></div>
      <button class="btn btn-sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Roll</th><th>Name</th>${sub.subject_type==='practical'?'<th>Prac Batch</th>':''}<th>Present</th><th>Absent</th><th>Classes</th><th>%</th></tr></thead>
        <tbody>${sts.map(s=>{
          const a=getAttStat(s.id,subId)
          return `<tr><td><span class="roll-b">${safe(s.roll)}</span></td><td style="font-weight:600">${safe(s.name)}</td>
            ${sub.subject_type==='practical'?`<td><span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700">Batch ${s.prac_batch||'A'}</span></td>`:''}
            <td style="color:var(--success);font-weight:700">${a.p}</td><td style="color:var(--danger);font-weight:700">${a.a}</td>
            <td>${a.t}</td><td style="font-weight:800;color:${pctColor(a.pct)}">${a.t>0?a.pct+'%':'—'}</td></tr>`
        }).join('')}</tbody>
      </table>
    </div>`)
}
window.showSubjReport=showSubjReport

// ═══════════════════════════════════════════════════════════
//  SUBJECTS — Admin (with subject_type + assign fix)
// ═══════════════════════════════════════════════════════════
async function renderAdminSubjects(){
  showLoad('Loading subjects…')
  DB.attByStudentSubject={}
  await Promise.all(DB.subjects.map(async s=>{
    await fetchClassSchedule(s.id,DB.curSession?.id)
    await fetchAttForSubject(s.id,DB.curSession?.id)
  }))
  hideLoad()
  const subsByBatch={}
  DB.subjects.forEach(s=>{if(!subsByBatch[s.batch])subsByBatch[s.batch]=[];subsByBatch[s.batch].push(s)})
  $('admin-subj-grid').innerHTML=Object.entries(subsByBatch).map(([batch,subs])=>`
    <div style="margin-bottom:20px">
      <h3 style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">${batch}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${subs.map(sub=>{
          const sts=DB.students.filter(s=>s.batch===sub.batch)
          let tp=0; sts.forEach(s=>{tp+=getAttStat(s.id,sub.id).pct})
          const av=sts.length?Math.round(tp/sts.length):0
          const conducted=(DB.classSchedule[sub.id]||[]).length
          const facs=getFacultyForSubject(sub.id)
          const typeTag=sub.subject_type==='practical'
            ?'<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">Practical</span>'
            :'<span style="background:#eff6ff;color:#1d4ed8;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">Theory</span>'
          return `<div class="subj-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
              <div>
                <h4 style="font-size:13px;font-weight:800">${safe(sub.name)} ${typeTag}</h4>
                <div style="font-size:11px;color:var(--muted)">${safe(sub.code)} · ${conducted} classes</div>
              </div>
              <span style="font-size:14px;font-weight:800;color:${pctColor(av)}">${av}%</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
              <i class="ti ti-users" style="font-size:12px;vertical-align:-1px;margin-right:3px"></i>
              ${facs.length?facs.map(f=>`<span style="background:#f0f4ff;padding:1px 5px;border-radius:3px;margin-right:3px;display:inline-block;font-size:11px">${safe(f.name)}</span>`).join(''):'<span style="color:var(--subtle);font-size:11px">Unassigned</span>'}
            </div>
            <div class="pb" style="margin-bottom:10px"><div class="pf" style="width:${av}%;background:${pctColor(av)}"></div></div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <button class="btn btn-sm" onclick="showSubjReport('${sub.id}')"><i class="ti ti-chart-bar"></i></button>
              <button class="btn btn-sm" onclick="goMark('${sub.id}')"><i class="ti ti-checkbox"></i></button>
              <button class="btn btn-sm btn-info" onclick="showAssignFacultyModal('${sub.id}')"><i class="ti ti-user-check"></i>Assign</button>
              <button class="btn btn-sm btn-danger" onclick="deleteSubject('${sub.id}')"><i class="ti ti-trash"></i></button>
            </div>
          </div>`
        }).join('')}
      </div>
    </div>`
  ).join('')||'<p style="color:var(--subtle)">No subjects yet. Add one above.</p>'
}

function showAddSubjectModal(){
  openModal(`
    <h3>Add New Subject</h3>
    <div class="form-row">
      <div class="mg"><label>Subject Name *</label><input id="ns-name2" type="text" placeholder="e.g. Oral Medicine"/></div>
      <div class="mg"><label>Subject Code *</label><input id="ns-code2" type="text" placeholder="e.g. OM-301"/></div>
    </div>
    <div class="form-row">
      <div class="mg"><label>Batch</label>
        <select id="ns-batch2"><option>BDS-1</option><option>BDS-2</option><option>BDS-3</option><option>BDS-4</option></select>
      </div>
      <div class="mg"><label>Credits</label><input id="ns-credits2" type="number" value="3"/></div>
    </div>
    <div class="mg"><label>Subject Type</label>
      <div style="display:flex;gap:10px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="radio" name="ns-type" value="theory" checked/> Theory
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="radio" name="ns-type" value="practical"/> Practical
        </label>
      </div>
    </div>
    <div class="banner banner-blue" style="margin-top:8px"><i class="ti ti-info-circle"></i>For Practical subjects, attendance is marked separately for Batch A (Roll 1–50) and Batch B (Roll 51–100).</div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addSubject()"><i class="ti ti-plus"></i>Add Subject</button>
    </div>`)
}
window.showAddSubjectModal=showAddSubjectModal

async function addSubject(){
  const name=$('ns-name2').value.trim(), code=$('ns-code2').value.trim()
  const batch=$('ns-batch2').value, credits=parseInt($('ns-credits2').value)||3
  const subject_type=document.querySelector('input[name="ns-type"]:checked')?.value||'theory'
  if(!name||!code){toast('Name and code required.','e');return}
  showLoad('Adding…')
  const{data,error}=await supabase.from('subjects').insert({name,code,batch,credits,subject_type}).select().single()
  hideLoad()
  if(error){toast('Failed: '+error.message,'e');return}
  data.faculty_subjects=[]
  DB.subjects.push(data)
  closeModal(); renderAdminSubjects(); toast('Subject added!','s')
}
window.addSubject=addSubject

// ── FIXED: ASSIGN FACULTY ─────────────────────────────────────
function showAssignFacultyModal(subId){
  const sub=DB.subjects.find(s=>s.id===subId)
  const facs=DB.users.filter(u=>u.role==='faculty')
  // Get currently assigned faculty IDs fresh from local DB
  const assigned=new Set((sub.faculty_subjects||[]).map(fs=>fs.faculty_id))
  openModal(`
    <h3><i class="ti ti-user-check" style="font-size:14px;vertical-align:-2px;margin-right:6px;color:var(--info)"></i>Assign Faculty — ${safe(sub.name)}</h3>
    <div class="banner banner-blue"><i class="ti ti-info-circle"></i>Select one or more faculty. Multiple faculty can share one subject. Uncheck to remove.</div>
    <div style="margin:12px 0;border:1px solid var(--border);border-radius:9px;overflow:hidden;max-height:320px;overflow-y:auto">
      ${facs.length
        ? facs.map(f=>`
          <label style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer">
            <input type="checkbox" class="assign-chk" value="${f.id}" ${assigned.has(f.id)?'checked':''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0"/>
            <div class="avatar-c" style="background:#e1f5ee;color:#0f6e56;width:32px;height:32px;font-size:11px;flex-shrink:0">${safe(f.initials)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700">${safe(f.name)}</div>
              <div style="font-size:11px;color:var(--muted)">${safe(f.email)}</div>
            </div>
            ${assigned.has(f.id)?'<span class="badge bi" style="font-size:10px;flex-shrink:0">Assigned</span>':''}
          </label>`).join('')
        : '<p style="padding:16px;color:var(--subtle);text-align:center">No faculty added yet. Go to Settings to add faculty.</p>'
      }
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-info" onclick="confirmAssignFaculty('${subId}')"><i class="ti ti-check"></i>Save Assignment</button>
    </div>`)
}
window.showAssignFacultyModal=showAssignFacultyModal

async function confirmAssignFaculty(subId){
  const selected=[...document.querySelectorAll('.assign-chk:checked')].map(cb=>cb.value)
  showLoad('Saving assignment…')
  // ── FIX: explicit delete then insert, with error handling ──
  const{error:delErr}=await supabase.from('faculty_subjects').delete().eq('subject_id',subId)
  if(delErr){ hideLoad(); toast('Delete old assignments failed: '+delErr.message,'e'); return }

  if(selected.length){
    const rows=selected.map(fid=>({faculty_id:fid,subject_id:subId,assigned_by:CU.id}))
    const{error:insErr}=await supabase.from('faculty_subjects').insert(rows)
    if(insErr){ hideLoad(); toast('Assign failed: '+insErr.message,'e'); return }
  }

  // ── FIX: refresh data fresh from DB ──
  await fetchSubjects()
  await fetchUsers()

  hideLoad(); closeModal()
  renderAdminSubjects()
  toast(`Faculty assignment saved for ${DB.subjects.find(s=>s.id===subId)?.name||'subject'}!`,'s')
}
window.confirmAssignFaculty=confirmAssignFaculty

function deleteSubject(subId){
  const sub=DB.subjects.find(s=>s.id===subId)
  openModal(`
    <h3 style="color:var(--danger)">Delete Subject</h3>
    <p style="color:var(--muted);font-size:14px;margin-bottom:12px">Delete "<strong>${safe(sub.name)}</strong>"? All attendance records removed.</p>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDeleteSubject('${subId}')"><i class="ti ti-trash"></i>Delete</button>
    </div>`)
}
window.deleteSubject=deleteSubject

async function confirmDeleteSubject(subId){
  showLoad('Deleting…')
  await supabase.from('attendance').delete().eq('subject_id',subId)
  await supabase.from('faculty_subjects').delete().eq('subject_id',subId)
  await supabase.from('class_schedule').delete().eq('subject_id',subId)
  await supabase.from('attendance_locks').delete().eq('subject_id',subId)
  await supabase.from('subjects').delete().eq('id',subId)
  DB.subjects=DB.subjects.filter(s=>s.id!==subId)
  hideLoad(); closeModal(); renderAdminSubjects(); toast('Subject deleted.','s')
}
window.confirmDeleteSubject=confirmDeleteSubject

// ═══════════════════════════════════════════════════════════
//  HOLIDAYS
// ═══════════════════════════════════════════════════════════
async function renderHolidays(){
  const cnt=$('holiday-cnt'); if(cnt) cnt.textContent=DB.holidays.length
  $('holiday-tbody').innerHTML=DB.holidays.map(h=>`
    <tr>
      <td>${fmtDate(h.date)}</td>
      <td style="font-weight:700">${safe(h.name)}</td>
      <td><span class="badge bi" style="font-size:10px">${safe(h.holiday_type||'national')}</span></td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteHoliday('${h.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>`
  ).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--subtle);padding:20px">No holidays added yet.</td></tr>'
}

async function addHoliday(){
  const date=$('h-date').value, name=$('h-name').value.trim(), type=$('h-type').value
  if(!date||!name){toast('Date and name required.','e');return}
  if(DB.holidays.find(h=>h.date===date)){toast('Holiday exists for this date.','e');return}
  showLoad('Adding…')
  const{data,error}=await supabase.from('holidays').insert({date,name,holiday_type:type,session_id:DB.curSession?.id,created_by:CU.id}).select().single()
  hideLoad()
  if(error){toast('Failed: '+error.message,'e');return}
  DB.holidays.push(data); DB.holidays.sort((a,b)=>a.date.localeCompare(b.date))
  $('h-date').value=''; $('h-name').value=''
  renderHolidays(); toast(`Holiday "${name}" added!`,'s')
}
window.addHoliday=addHoliday

async function deleteHoliday(id){
  showLoad('Removing…')
  await supabase.from('holidays').delete().eq('id',id)
  DB.holidays=DB.holidays.filter(h=>h.id!==id)
  hideLoad(); renderHolidays(); toast('Holiday removed.','s')
}
window.deleteHoliday=deleteHoliday

// ═══════════════════════════════════════════════════════════
//  PROMOTE
// ═══════════════════════════════════════════════════════════
async function renderPromotePage(){
  if($('cur-acy-label')) $('cur-acy-label').textContent=DB.settings.academic_year||'—'
  if($('new-acy')) $('new-acy').value=''
  const batches=['BDS-1','BDS-2','BDS-3','BDS-4']
  const nextMap={'BDS-1':'BDS-2','BDS-2':'BDS-3','BDS-3':'BDS-4','BDS-4':'Alumni'}
  $('promote-grid').innerHTML=batches.map(b=>{
    const sts=DB.students.filter(s=>s.batch===b)
    const next=nextMap[b]
    return `<div class="card">
      <div class="ch"><h3>${b}</h3><span class="badge bi">${sts.length}</span></div>
      <div class="cb">
        <p style="font-size:13px;color:var(--muted);margin-bottom:10px">→ <strong>${next}</strong></p>
        <button class="btn ${next==='Alumni'?'btn-warn':'btn-success'} btn-sm" onclick="showPromoteModal('${b}')">
          <i class="ti ti-arrow-up"></i>Select &amp; Promote
        </button>
      </div>
    </div>`
  }).join('')
  renderAlumni()
}

function showPromoteModal(batch){
  const sts=DB.students.filter(s=>s.batch===batch)
  const next={'BDS-1':'BDS-2','BDS-2':'BDS-3','BDS-3':'BDS-4','BDS-4':'Alumni'}[batch]
  openModal(`
    <h3><i class="ti ti-arrow-up-circle" style="font-size:15px;vertical-align:-2px;margin-right:6px;color:var(--success)"></i>Promote ${batch} → ${next}</h3>
    <div class="banner banner-blue"><i class="ti ti-info-circle"></i>Select students to promote. Unselected stay in ${batch}.</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn btn-sm" onclick="selAllProm(true)"><i class="ti ti-checks"></i>All</button>
      <button class="btn btn-sm" onclick="selAllProm(false)"><i class="ti ti-x"></i>None</button>
    </div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:9px;margin-bottom:12px">
      ${sts.map(s=>{
        const oa=getOverall(s.id)
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);cursor:pointer">
          <input type="checkbox" class="promote-chk" value="${s.id}" checked style="width:16px;height:16px"/>
          <span class="roll-b" style="flex-shrink:0">${safe(s.roll)}</span>
          <span style="font-weight:700;flex:1;font-size:13px">${safe(s.name)}</span>
          <span style="font-size:12px;font-weight:800;color:${pctColor(oa)};flex-shrink:0">${oa}%</span>
        </label>`
      }).join('')}
    </div>
    ${next==='Alumni'?'<div class="banner banner-amber"><i class="ti ti-alert-triangle"></i>BDS-4 students moved to Alumni permanently.</div>':''}
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" onclick="doPromote('${batch}','${next}')"><i class="ti ti-check"></i>Confirm</button>
    </div>`)
}
window.showPromoteModal=showPromoteModal
function selAllProm(c){document.querySelectorAll('.promote-chk').forEach(cb=>cb.checked=c)}
window.selAllProm=selAllProm

async function doPromote(batch,next){
  const selected=[...document.querySelectorAll('.promote-chk:checked')].map(cb=>cb.value)
  if(!selected.length){toast('No students selected.','i');return}
  showLoad(`Promoting ${selected.length}…`)
  const toPromote=DB.students.filter(s=>selected.includes(s.id))
  if(next==='Alumni'){
    await supabase.from('alumni').insert(toPromote.map(s=>({roll:s.roll,name:s.name,email:s.email,phone:s.phone,graduated_batch:batch,session_label:DB.settings.academic_year,graduated_on:todayStr()})))
    await supabase.from('students').update({is_active:false}).in('id',selected)
    DB.alumni.push(...toPromote.map(s=>({...s,graduated_batch:batch,session_label:DB.settings.academic_year})))
    DB.students=DB.students.filter(s=>!selected.includes(s.id))
  } else {
    const newYr=parseInt(next.split('-')[1])
    for(const s of toPromote){
      const newRoll=s.roll.replace(batch,next)
      await supabase.from('students').update({batch:next,year:newYr,roll:newRoll}).eq('id',s.id)
      s.batch=next; s.year=newYr; s.roll=newRoll
    }
  }
  hideLoad(); closeModal(); await renderPromotePage(); toast(`${selected.length} promoted to ${next}!`,'s')
}
window.doPromote=doPromote

function renderAlumni(){
  if(!$('alumni-cnt')) return
  $('alumni-cnt').textContent=DB.alumni.length
  $('alumni-tbody').innerHTML=DB.alumni.length
    ?DB.alumni.map(s=>`<tr>
        <td><span class="roll-b">${safe(s.roll)}</span></td>
        <td style="font-weight:700">${safe(s.name)}</td>
        <td>${safe(s.graduated_batch||'BDS-4')}</td>
        <td>${safe(s.session_label||'—')}</td>
        <td>${s.graduated_on||'—'}</td>
      </tr>`).join('')
    :'<tr><td colspan="5" style="text-align:center;color:var(--subtle);padding:16px">No alumni yet.</td></tr>'
}

async function startNewSession(){
  const newAcy=$('new-acy').value.trim()
  if(!newAcy){toast('Enter new academic year.','e');return}
  openModal(`
    <h3>Start New Session</h3>
    <div class="banner banner-green"><i class="ti ti-info-circle"></i>New session: <strong>${safe(newAcy)}</strong></div>
    <div class="banner banner-amber"><i class="ti ti-alert-triangle"></i>Current session archived. Viewable in Past Sessions.</div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" onclick="confirmNewSession('${newAcy}')"><i class="ti ti-check"></i>Start</button>
    </div>`)
}
window.startNewSession=startNewSession

async function confirmNewSession(newAcy){
  showLoad('Starting…')
  if(DB.curSession) await supabase.from('academic_sessions').update({is_current:false}).eq('id',DB.curSession.id)
  const{data:ns}=await supabase.from('academic_sessions').insert({label:newAcy,is_current:true}).select().single()
  await supabase.from('settings').update({academic_year:newAcy}).eq('id','main')
  DB.settings.academic_year=newAcy; DB.curSession=ns; DB.sessions.unshift(ns)
  hideLoad(); closeModal()
  if($('hdr-acy')) $('hdr-acy').textContent=newAcy
  if($('set-acy')) $('set-acy').value=newAcy
  if($('cur-acy-label')) $('cur-acy-label').textContent=newAcy
  toast(`Session ${newAcy} started!`,'s'); renderPromotePage()
}
window.confirmNewSession=confirmNewSession

// ═══════════════════════════════════════════════════════════
//  EMAIL
// ═══════════════════════════════════════════════════════════
async function renderEmailPage(){
  const low=DB.students.filter(s=>{const oa=getOverall(s.id);return oa<70&&oa>0}).length
  const el=$('em-stat-low'); if(el) el.textContent=low
  const{count}=await supabase.from('email_log').select('*',{count:'exact',head:true})
  const es=$('em-stat-sent'); if(es) es.textContent=count||0
  const{data:logs}=await supabase.from('email_log').select('*').order('sent_at',{ascending:false}).limit(20)
  const logEl=$('email-log')
  if(logEl) logEl.innerHTML=logs?.length
    ?logs.map(e=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;font-size:13px">${safe(e.subject)}</div>
        <div style="font-size:11px;color:var(--muted)">${safe(e.to_email)}</div>
        <div style="font-size:11px;color:var(--subtle)">${new Date(e.sent_at).toLocaleString('en-IN')}</div>
      </div>`).join('')
    :'<p style="color:var(--subtle);font-size:13px;text-align:center;padding:16px 0">No emails yet.</p>'
}

async function logEmail(to,subject){
  if(!to) return
  await supabase.from('email_log').insert({to_email:to,subject,sent_by:CU.id,session_id:DB.curSession?.id})
}
async function sendEmails(){
  const val=$('em-to').value
  let targets=val==='all'?DB.students:DB.students.filter(s=>{const oa=getOverall(s.id);return oa<parseInt(val)&&oa>0})
  const subj=$('em-subj').value
  showLoad(`Logging ${targets.length}…`)
  await Promise.all(targets.map(s=>logEmail(s.email,subj)))
  hideLoad(); toast(`${targets.length} alerts logged!`,'s'); renderEmailPage()
}
window.sendEmails=sendEmails
async function emailOneStudent(id){
  const s=DB.students.find(st=>st.id===id); if(!s) return
  await logEmail(s.email,`Attendance Alert — ${s.name}`)
  toast(`Alert logged for ${s.email}`,'s')
}
window.emailOneStudent=emailOneStudent
async function bulkEmail(){
  const thresh=parseInt($('rp-thresh')?.value||70)
  const batch=$('rp-batch')?.value||''
  let list=batch?DB.students.filter(s=>s.batch===batch):DB.students
  const low=list.filter(s=>{const oa=getOverall(s.id);return oa<thresh&&oa>0})
  showLoad('Logging…')
  await Promise.all(low.map(s=>logEmail(s.email,`Attendance Alert — ${s.name}`)))
  hideLoad(); toast(`${low.length} alerts logged.`,'s')
}
window.bulkEmail=bulkEmail
function previewEmail(){
  const sample=DB.students.find(s=>getOverall(s.id)<75)||DB.students[0]
  if(!sample){toast('No students.','i');return}
  const body=($('em-body').value||'').replace('{name}',sample.name).replace('{roll}',sample.roll).replace('{batch}',sample.batch).replace('{pct}',getOverall(sample.id)+'')
  openModal(`
    <div style="display:flex;justify-content:space-between;margin-bottom:14px">
      <h3 style="margin:0">Email Preview</h3>
      <button class="btn btn-sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    <div style="background:#f8fafc;border-radius:10px;padding:14px;border:1px solid var(--border)">
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px">TO</div>
      <div style="font-size:13px;margin-bottom:10px">${safe(sample.email||'—')}</div>
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px">SUBJECT</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">${safe($('em-subj').value)}</div>
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:3px">MESSAGE</div>
      <div style="font-size:13px;line-height:1.7;white-space:pre-line">${safe(body)}</div>
    </div>`)
}
window.previewEmail=previewEmail

// ═══════════════════════════════════════════════════════════
//  SETTINGS & FACULTY
// ═══════════════════════════════════════════════════════════
async function renderSettings(){ renderFacultyList() }

function renderFacultyList(){
  const facs=DB.users.filter(u=>u.role==='faculty')
  $('faculty-list').innerHTML=facs.length?facs.map(f=>{
    const subNames=DB.subjects.filter(s=>(s.faculty_subjects||[]).some(fs=>fs.faculty_id===f.id)).map(s=>s.name).join(', ')||'None'
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div class="avatar-c" style="background:#e1f5ee;color:#0f6e56;width:34px;height:34px;font-size:11px;flex-shrink:0">${safe(f.initials)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${safe(f.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${safe(f.email)}</div>
        <div style="font-size:11px;color:var(--subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safe(subNames)}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteFaculty('${f.id}')"><i class="ti ti-trash"></i></button>
    </div>`
  }).join(''):'<p style="color:var(--subtle);font-size:13px">No faculty added yet.</p>'
}

function showAddFacultyModal(){
  openModal(`
    <h3>Add Faculty Member</h3>
    <div class="banner banner-blue"><i class="ti ti-info-circle"></i>Faculty will receive a login invitation. Assign subjects from Subjects page.</div>
    <div class="form-row">
      <div class="mg"><label>Full Name *</label><input id="nf-name" type="text" placeholder="Dr. Full Name"/></div>
      <div class="mg"><label>Initials *</label><input id="nf-ini" type="text" placeholder="DS" maxlength="2" style="width:70px"/></div>
    </div>
    <div class="mg"><label>Email *</label><input id="nf-email" type="email" placeholder="faculty@hids.ac.in"/></div>
    <div class="mg"><label>Temporary Password (min 8 chars) *</label><input id="nf-pass" type="text" placeholder="Min 8 characters"/></div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addFaculty()"><i class="ti ti-user-plus"></i>Add Faculty</button>
    </div>`)
}
window.showAddFacultyModal=showAddFacultyModal

async function addFaculty(){
  const name=$('nf-name').value.trim(), inits=($('nf-ini').value.trim()||ini(name)).toUpperCase()
  const email=$('nf-email').value.trim(), pass=$('nf-pass').value.trim()
  if(!name||!email||!pass){toast('All fields required.','e');return}
  if(pass.length<8){toast('Password min 8 chars.','e');return}
  showLoad('Creating…')
  const{data:authData,error:authErr}=await supabase.auth.signUp({email,password:pass})
  if(authErr){hideLoad();toast('Auth failed: '+authErr.message,'e');return}
  const authId=authData.user?.id
  const{data:profile,error:profErr}=await supabase.from('users').insert({id:authId,email,name,initials:inits,role:'faculty'}).select().single()
  if(profErr){hideLoad();toast('Profile failed: '+profErr.message,'e');return}
  DB.users.push({...profile,faculty_subjects:[]})
  hideLoad(); closeModal(); renderFacultyList(); toast(`${name} added!`,'s')
}
window.addFaculty=addFaculty

function deleteFaculty(facId){
  const fac=DB.users.find(u=>u.id===facId)
  openModal(`
    <h3 style="color:var(--danger)">Delete Faculty</h3>
    <p style="font-size:14px;color:var(--muted);margin-bottom:12px">Delete <strong>${safe(fac?.name)}</strong>? Subject assignments removed.</p>
    <div style="display:flex;justify-content:flex-end;gap:10px">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDeleteFaculty('${facId}')"><i class="ti ti-trash"></i>Delete</button>
    </div>`)
}
window.deleteFaculty=deleteFaculty

async function confirmDeleteFaculty(facId){
  showLoad('Deleting…')
  await supabase.from('faculty_subjects').delete().eq('faculty_id',facId)
  await supabase.from('users').delete().eq('id',facId)
  DB.users=DB.users.filter(u=>u.id!==facId)
  DB.subjects.forEach(s=>{s.faculty_subjects=(s.faculty_subjects||[]).filter(fs=>fs.faculty_id!==facId)})
  hideLoad(); closeModal(); renderFacultyList(); toast('Faculty deleted.','s')
}
window.confirmDeleteFaculty=confirmDeleteFaculty

async function saveSettings(){
  const acy=$('set-acy').value.trim(), college=$('set-college').value.trim()
  const minPct=parseInt($('set-min').value)||75, alertPct=parseInt($('set-thresh').value)||70
  showLoad('Saving…')
  await supabase.from('settings').update({academic_year:acy,college_name:college,min_attendance:minPct,alert_threshold:alertPct}).eq('id','main')
  DB.settings={...DB.settings,academic_year:acy,college_name:college,min_attendance:minPct,alert_threshold:alertPct}
  if($('hdr-acy')) $('hdr-acy').textContent=acy
  hideLoad(); toast('Settings saved!','s')
}
window.saveSettings=saveSettings

// ═══════════════════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════════════════
function exportCSV(){
  const type=$('rp-type')?.value||'overview'
  const batch=$('rp-batch')?.value||''
  const year=$('rp-year')?.value||''
  const thresh=parseInt($('rp-thresh')?.value||70)
  const subFilter=$('rp-sub-filter')?.value||''
  const dateFrom=$('rp-date-from')?.value||''
  const dateTo=$('rp-date-to')?.value||''
  let csv=''

  let students=DB.students
  if(batch) students=students.filter(s=>s.batch===batch)
  if(year)  students=students.filter(s=>String(s.year||'1')===year)

  if(type==='subject'){
    csv='Subject,Type,Code,Batch,Faculty,Classes Conducted,Avg %,Below Threshold\n'
    let subs=batch?DB.subjects.filter(s=>s.batch===batch):DB.subjects
    if(subFilter) subs=subs.filter(s=>s.id===subFilter)
    subs.forEach(sub=>{
      const sts=students.filter(s=>s.batch===sub.batch)
      let tp=0,bl=0; sts.forEach(s=>{const a=getAttStat(s.id,sub.id);tp+=a.pct;if(a.pct<thresh&&a.t>0) bl++})
      const av=sts.length?Math.round(tp/sts.length):0
      const conducted=(DB.classSchedule[sub.id]||[]).length
      csv+=`"${sub.name}",${sub.subject_type||'theory'},${sub.code},${sub.batch},"${getTeacherNames(sub.id)}",${conducted},${av}%,${bl}\n`
    })
  } else if(type==='datewise'){
    csv='Date,Subject,Batch,Topic Covered,Present,Absent,Total,Attendance %\n'
    // Build from class schedule in memory
    let subs=batch?DB.subjects.filter(s=>s.batch===batch):DB.subjects
    if(subFilter) subs=subs.filter(s=>s.id===subFilter)
    subs.forEach(sub=>{
      const topicMap=DB.classTopics?.[sub.id]||{}
      ;(DB.classSchedule[sub.id]||[]).sort().reverse().forEach(date=>{
        if(dateFrom&&date<dateFrom) return
        if(dateTo&&date>dateTo) return
        const sts=students.filter(s=>s.batch===sub.batch)
        const records=DB.attByStudentSubject
        let p=0,a=0
        sts.forEach(s=>{
          const recs=DB.attByStudentSubject?.[s.id]?.[sub.id]||[]
          const rec=recs.find(r=>r.date===date)
          if(rec){if(rec.status==='present')p++;else a++;}
        })
        const t=p+a, pct=t>0?Math.round(p/t*100):0
        csv+=`${date},"${sub.name}",${sub.batch},"${topicMap[date]||''}",${p},${a},${t},${t>0?pct+'%':'—'}\n`
      })
    })
  } else {
    csv='Roll No.,Name,Batch,Year,Prac Batch,Email,Overall %,Status\n'
    if(type==='low') students=students.filter(s=>{const oa=getOverall(s.id);return oa<thresh&&oa>0})
    students.forEach(s=>{
      const oa=getOverall(s.id)
      csv+=`${s.roll},"${s.name}",${s.batch},Year ${s.year||1},Batch ${s.prac_batch||'A'},${s.email||''},${oa}%,${oa>=75?'Good':'At Risk'}\n`
    })
  }
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=`HIDS_${type}_${todayStr()}.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  toast('CSV exported!','s')
}
window.exportCSV=exportCSV

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════
async function init(){
  const{data:{session}}=await supabase.auth.getSession()
  if(session){
    const{data:profile}=await supabase.from('users').select('*').eq('email',session.user.email).single()
    if(profile){ CU=profile; await bootstrapApp(); return }
  }
  if($('loader')) $('loader').style.display='none'
  if($('login-screen')) $('login-screen').style.display='flex'
}
init()
