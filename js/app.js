/* ══════════════════════════════════════
   DATA & CONSTANTS
══════════════════════════════════════ */
const SK = 'taskMasterPro_v8';
const SK_OLD = 'taskMasterPro_v7';
const HRS_PER_DAY = 8;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS7  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const P_CFG = {
  high:   {label:'High',   cls:'bh', bar:'linear-gradient(90deg,#EF4444,#F97316)', dot:'#EF4444', barSolid:'linear-gradient(90deg,#EF4444,#F97316)'},
  medium: {label:'Medium', cls:'bm', bar:'linear-gradient(90deg,#F59E0B,#EAB308)', dot:'#F59E0B', barSolid:'linear-gradient(90deg,#F59E0B,#EAB308)'},
  low:    {label:'Low',    cls:'bl', bar:'linear-gradient(90deg,#10B981,#06B6D4)', dot:'#10B981', barSolid:'linear-gradient(90deg,#10B981,#06B6D4)'}
};
const S_CFG = {
  todo:        {label:'To Do',       cls:'btd', cal:'#9CA3AF'},
  assigned:    {label:'Assigned',    cls:'bsa', cal:'#8B5CF6'},
  accepted:    {label:'Accepted',    cls:'bsac',cal:'#06B6D4'},
  in_progress: {label:'In Progress', cls:'bip', cal:'#3B82F6'},
  review:      {label:'In Review',   cls:'brv', cal:'#F59E0B'},
  done:        {label:'Done',        cls:'bdn', cal:'#10B981'}
};

// Empty seed — new users are guided through creating their first Goal → Project → Task
const SEED = { visions: [], projects: [], tasks: [] };

/* ══════════════════════════════════════
   WORKSPACE / MULTI-USER
══════════════════════════════════════ */
const WS_ROLES = ['Director','President','AVP','Senior Manager','Manager','Executive'];
const WS_KEY = 'tm_workspace';
const WS_MODE_KEY = 'tm_mode';
const WS_CUR_KEY = 'tm_cur_user';
let WS_MODE = localStorage.getItem(WS_MODE_KEY) || null;
let WS = (function(){ try{ const s=localStorage.getItem(WS_KEY); if(s) return JSON.parse(s); }catch(e){} return {orgName:'',users:[]}; })();
let WS_CUR_USER = (function(){ try{ const s=localStorage.getItem(WS_CUR_KEY); if(s) return JSON.parse(s); }catch(e){} return null; })();
function saveWorkspace(){ localStorage.setItem(WS_KEY, JSON.stringify(WS)); }
function saveCurrentUser(){ localStorage.setItem(WS_CUR_KEY, JSON.stringify(WS_CUR_USER)); }

let D = loadData();
let currentView = 'list';
let editingId   = null;
let calMonth    = new Date().getMonth();
let calYear     = new Date().getFullYear();
let quillInst    = null;
let quillNotes   = '';
let searchTerm   = '';

function loadData(){
  try {
    const s = localStorage.getItem(SK);
    if (s) return migrateData(JSON.parse(s));
    const old = localStorage.getItem(SK_OLD);
    if (old) {
      const m = migrateData(JSON.parse(old));
      localStorage.setItem(SK, JSON.stringify(m));
      return m;
    }
  } catch(e){ console.warn('loadData failed', e); }
  return JSON.parse(JSON.stringify(SEED));
}
function migrateData(d){
  d = d || {};
  d.visions  = (d.visions||[]).map(v => ({
    type:         'Short Term',
    durationMode: 'hours',
    totalHours:   0,
    targetDate:   '',
    startDate:    '',
    endDate:      '',
    ...v
  }));
  d.projects = (d.projects||[]).map(p => ({
    hoursAllocated: null,
    startDate:      '',
    endDate:        '',
    ...p
  }));
  d.tasks    = (d.tasks||[]).map(t => ({
    estHours:    0,
    actualHours: 0,
    completedAt: null,
    subtasks:    [],
    gcalEventId: null,
    startDate:   '',
    tags:        [],
    recurrence:  'none',
    blockedBy:   [],
    timerStart:  null,
    timerTotal:  0,
    // ── Multi-user / assignment fields (added Round 6) ──
    assignedTo:  null,   // Firebase UID of assigned member
    assignedBy:  null,   // Firebase UID of person who assigned the task
    assignedAt:  null,   // Timestamp when task was assigned
    createdBy:   null,   // Firebase UID of task creator
    acceptedAt:  null,   // Timestamp when assigned user accepted the task
    startedAt:   null,   // Timestamp when task moved to in_progress
    // ── Comments & notifications (added Round 7) ──
    comments:    [],     // [{id, uid, name, initials, text, ts}]
    readBy:      [],     // UIDs who have read/acknowledged this task notification
    ...t
  }));
  return d;
}
function save(){ localStorage.setItem(SK, JSON.stringify(D)); fbScheduleSync(); }
function newId(){ return Date.now() + Math.floor(Math.random()*999); }
// Local calendar date (YYYY-MM-DD). toISOString() is UTC, which made "today"
// lag a day behind until 05:30 for users in India.
function localDateStr(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function todayStr(){ return localDateStr(new Date()); }
function fmtDate(s){ return s ? s.split('T')[0].split('-').reverse().join('/') : ''; }
// Extract YYYY-MM-DD from either "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (datetime-local)
function deadlineDate(s){ return s ? s.split('T')[0] : ''; }
/* Human-readable distance from today, e.g. "Today", "in 3 days", "2 days ago". */
function relDue(dateStr, todayStr_){
  if(!dateStr) return '';
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date((todayStr_ || todayStr()) + 'T00:00:00');
  const days = Math.round((a - b) / 864e5);
  if(days === 0)  return 'Today';
  if(days === 1)  return 'Tomorrow';
  if(days === -1) return 'Yesterday';
  if(days > 0)    return days < 7 ? `in ${days} days` : `in ${Math.round(days/7)} wk`;
  const ago = Math.abs(days);
  return ago < 7 ? `${ago} days ago` : `${Math.round(ago/7)} wk ago`;
}
// Human-readable datetime — shows time only when a time component is present
function fmtDateTime(s){
  if(!s) return '';
  const [datePart, timePart] = s.split('T');
  const d = datePart.split('-').reverse().join('/');
  return timePart ? `${d} ${timePart}` : d;
}
/* Rich-text notes are shared between workspace members and rendered as HTML.
   Strip anything executable so a note can't run script in someone else's session. */
function sanitizeHTML(html){
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math').forEach(n => n.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase(), v = a.value.replace(/[\s\u0000-\u001f]/g,'').toLowerCase();
      if(n.startsWith('on') || n === 'srcdoc' ||
         (['href','src','action','formaction','xlink:href'].includes(n) && /^(javascript|vbscript|data:text)/.test(v)))
        el.removeAttribute(a.name);
    });
  });
  return tpl.innerHTML;
}
function esc(s){ const d=document.createElement('div');d.textContent=s||'';return d.innerHTML; }

/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
function toast(msg, type='success'){
  const colors = {success:'linear-gradient(135deg,#10B981,#06B6D4)', error:'linear-gradient(135deg,#EF4444,#F97316)', info:'linear-gradient(135deg,#5B6EF5,#7C3AED)'};
  const icons  = {success:'', error:'', info:''};
  const el = document.createElement('div');
  el.className = 'tw';
  el.style.background = colors[type] || colors.info;
  el.innerHTML = icons[type]+' '+esc(msg);
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}

/* ══════════════════════════════════════
   CONFIRM DIALOG
══════════════════════════════════════ */
let _confirmCb = null;
function confirmAction(msg, cb){
  document.getElementById('confirm-msg').textContent = msg;
  _confirmCb = cb;
  document.getElementById('confirm-overlay').classList.add('show');
}
function closeConfirm(){ document.getElementById('confirm-overlay').classList.remove('show'); _confirmCb = null; }
document.getElementById('confirm-ok').onclick = function(){ if(_confirmCb) _confirmCb(); closeConfirm(); };

/* ══════════════════════════════════════
   PAGE NAV
══════════════════════════════════════ */
/* ── Mobile drawer nav ── */
function toggleNav(){
  const open = document.body.classList.toggle('nav-open');
  document.getElementById('sdb-backdrop')?.classList.toggle('show', open);
}
function closeNav(){
  document.body.classList.remove('nav-open');
  document.getElementById('sdb-backdrop')?.classList.remove('show');
}

function showPage(id){
  closeNav(); // collapse the mobile drawer on navigation
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nbtn').forEach(b => b.classList.remove('act'));
  const pg = document.getElementById('page-'+id);
  if(pg) pg.classList.add('active');
  const nb = document.querySelector('.nbtn[data-page="'+id+'"]');
  if(nb) nb.classList.add('act');
  renderDashboard();
  renderVisionsPage();
  renderTasks();
  renderCalendar();
  renderSettings();
  renderMyDay();
  if(id === 'profile')       renderProfilePage();
  if(id === 'mytasks')       renderMyTasks();
  if(id === 'notifications') renderNotifications();
  if(id === 'admin'){
    renderAdmin();                          // immediate render from cached state
    if(WS_MODE === 'company') fbRefreshAdminData(); // async refresh from Firestore
  }
}

/* ══════════════════════════════════════
   ADMIN DATA REFRESH (async Firestore)
══════════════════════════════════════ */
/** Reload members, positions and invites from Firestore then re-render admin page. */
async function fbRefreshAdminData(){
  if(!_fbFS || !_fbUser || !WS.wsId) return;
  try {
    await Promise.all([fbLoadMembers(), fbLoadPositions()]);
    const me = _wsMembers.find(m => m.uid === _fbUser.uid);
    if(me && me.isAdmin) await fbLoadInvites();
    renderAdmin();
  } catch(e){ console.warn('Admin refresh failed:', e); }
}

/* ══════════════════════════════════════
   TIME BUDGET HELPERS
══════════════════════════════════════ */
function goalTotalHours(v){
  if(!v) return 0;
  if(v.durationMode==='days' && v.targetDate){
    const d = new Date(v.targetDate+'T23:59:59');
    const days = Math.max(0, Math.ceil((d - new Date())/864e5));
    return days * HRS_PER_DAY;
  }
  return +v.totalHours || 0;
}
function goalDurationLabel(v){
  if(!v) return '';
  if(v.durationMode==='days' && v.targetDate){
    const d = new Date(v.targetDate+'T23:59:59');
    const days = Math.max(0, Math.ceil((d - new Date())/864e5));
    return `${days}d ≈ ${days*HRS_PER_DAY}h`;
  }
  return `${+v.totalHours||0}h`;
}
function projectHours(p, allProjects, goalHours){
  if(p.hoursAllocated!=null && p.hoursAllocated!=='') return +p.hoursAllocated;
  const sib = (allProjects||D.projects).filter(x=>x.visionId==p.visionId);
  const explicit = sib.filter(x=>x.hoursAllocated!=null && x.hoursAllocated!=='').reduce((s,x)=>s+ +x.hoursAllocated,0);
  const unalloc  = sib.filter(x=>x.hoursAllocated==null || x.hoursAllocated==='').length || 1;
  return Math.max(0,(goalHours-explicit)/unalloc);
}
function projectDoneHours(p){
  return D.tasks.filter(t=>t.projectId==p.id && t.status==='done').reduce((s,t)=>s+(+t.estHours||0),0);
}
function visionAllocated(v){
  return D.projects.filter(p=>p.visionId==v.id && p.hoursAllocated!=null && p.hoursAllocated!=='').reduce((s,p)=>s+ +p.hoursAllocated,0);
}

/* ══════════════════════════════════════
   QUILL INIT
══════════════════════════════════════ */
let quillFallback = false;
function initQuill(){
  if (quillInst || quillFallback) return;
  const el = document.getElementById('t-editor');
  if (!el) return;
  if (typeof Quill === 'undefined') {
    // Quill CDN failed → swap to plain textarea
    quillFallback = true;
    const ta = document.createElement('textarea');
    ta.id = 't-editor-fallback';
    ta.className = 'fc';
    ta.rows = 5;
    ta.placeholder = 'Notes (rich-text disabled — CDN blocked)';
    ta.style.resize = 'vertical';
    el.replaceWith(ta);
    ta.addEventListener('input', () => { quillNotes = ta.value; });
    console.warn('Quill unavailable — using plain textarea fallback.');
    return;
  }
  try {
    quillInst = new Quill('#t-editor', {
      theme: 'snow',
      modules: { toolbar: [['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['clean']] }
    });
    quillInst.on('text-change', ()=>{
      const h = quillInst.root.innerHTML;
      quillNotes = (h === '<p><br></p>') ? '' : h;
    });
  } catch(e){
    console.warn('Quill init failed', e);
    quillFallback = true;
  }
}

/* ══════════════════════════════════════
   RENDER ALL
══════════════════════════════════════ */
function renderAll(){
  renderDashboard();
  renderVisionsPage();
  renderTasks();
  renderCalendar();
  renderSettings();
  renderMyDay();
  renderMyTasks();
  renderNotifications();
  checkDueNotifications();
  // First-run guide on visions page when data is empty
  renderFirstRunGuide('frg-visions');
}

/* ══════════════════════════════════════
   DASHBOARD
══════════════════════════════════════ */
function renderDashboard(){
  const total   = D.tasks.length;
  const done    = D.tasks.filter(t => t.status === 'done').length;
  const today   = todayStr();
  const overdue = D.tasks.filter(t => t.status !== 'done' && t.deadline && deadlineDate(t.deadline) < today).length;
  const dueToday= D.tasks.filter(t => t.status !== 'done' && t.deadline && deadlineDate(t.deadline) === today).length;
  const inProg  = D.tasks.filter(t => t.status === 'in_progress').length;
  const prog    = total ? Math.round((done/total)*100) : 0;
  // Today snapshot
  const tsd = document.getElementById('today-snap-d');
  const tss = document.getElementById('today-snap-s');
  if(tsd){
    const d = new Date();
    const hr = d.getHours();
    const greeting = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
    tsd.textContent = `${greeting}, ${(PROF&&PROF.name?PROF.name.split(' ')[0]:'there')} · ${d.toLocaleDateString('en-IN',{weekday:'long', day:'numeric', month:'long'})}`;
    const parts = [];
    if(overdue)  parts.push(`${overdue} overdue`);
    if(dueToday) parts.push(`${dueToday} due today`);
    if(inProg)   parts.push(`${inProg} in progress`);
    tss.textContent = parts.length ? parts.join(' · ') : 'No pressing deadlines today.';
  }

  // ── KPI tiles ──
  const active   = total - done;
  const weekEnd  = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndS = localDateStr(weekEnd);
  const dueWeek  = D.tasks.filter(t => t.status !== 'done' && t.deadline &&
                     deadlineDate(t.deadline) >= today && deadlineDate(t.deadline) <= weekEndS).length;

  const setTxt = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  const setHtml = (id, v) => { const e = document.getElementById(id); if(e) e.innerHTML = v; };

  setTxt('st-total', total);
  setHtml('st-total-sub', total ? `<b>${active}</b> still open` : 'Nothing yet');
  setTxt('st-done', done);
  setHtml('st-done-sub', `<b>${prog}%</b> of all tasks`);
  const dbar = document.getElementById('st-done-bar');
  if(dbar) dbar.style.width = prog + '%';
  setTxt('st-ovr', overdue);
  setHtml('st-ovr-sub', overdue ? 'Needs attention' : 'All on schedule');
  setTxt('st-week', dueWeek);
  setHtml('st-week-sub', dueToday ? `<b>${dueToday}</b> due today` : 'Next 7 days');

  // ── Priority distribution (horizontal bars, ordinal heat ramp) ──
  const pc = {high:0,medium:0,low:0};
  D.tasks.forEach(t => { if(pc[t.priority]!==undefined) pc[t.priority]++; });
  const priRows = [
    {k:'high',   label:'High',   color:'var(--pri3)'},
    {k:'medium', label:'Medium', color:'var(--pri2)'},
    {k:'low',    label:'Low',    color:'var(--pri1)'}
  ];
  const priMax = Math.max(1, ...priRows.map(r => pc[r.k]));
  const priEl  = document.getElementById('pri-chart');
  if(priEl){
    priEl.innerHTML = !total
      ? '<div class="chart-empty">No tasks yet — add one to see the breakdown.</div>'
      : priRows.map(r => {
          const n = pc[r.k];
          return `<div class="hbar-row">
            <span class="hbar-lbl"><span class="hbar-dot" style="background:${r.color}"></span>${r.label}</span>
            <span class="hbar-track"><span class="hbar-fill" style="width:${(n/priMax)*100}%;background:${r.color}"></span></span>
            <span class="hbar-val">${n}</span>
          </div>`;
        }).join('');
  }

  // ── Workflow pipeline (stacked bar + legend) ──
  // Covers every status in S_CFG, so assigned/accepted tasks are no longer
  // silently dropped from the chart the way the old 4-slice donut dropped them.
  const pipeOrder = ['todo','assigned','accepted','in_progress','review','done'];
  const pipeVars  = ['--pl1','--pl2','--pl3','--pl4','--pl5','--pl6'];
  const counts    = {};
  pipeOrder.forEach(s => counts[s] = 0);
  D.tasks.forEach(t => { if(counts[t.status] !== undefined) counts[t.status]++; });
  const pipeTotal = pipeOrder.reduce((a,s) => a + counts[s], 0);
  const pipeEl = document.getElementById('pipe-chart');
  if(pipeEl){
    if(!pipeTotal){
      pipeEl.innerHTML = '<div class="chart-empty">No tasks yet — your workflow will appear here.</div>';
    } else {
      const segs = pipeOrder.filter(s => counts[s] > 0).map(s => {
        const i = pipeOrder.indexOf(s);
        return `<span class="pipe-seg" style="width:${(counts[s]/pipeTotal)*100}%;background:var(${pipeVars[i]})" title="${esc(S_CFG[s].label)}: ${counts[s]}"></span>`;
      }).join('');
      const keys = pipeOrder.map((s,i) =>
        `<span class="pipe-key"><span class="pipe-sw" style="background:var(${pipeVars[i]})"></span>${esc(S_CFG[s].label)} <b>${counts[s]}</b></span>`
      ).join('');
      pipeEl.innerHTML = `<div class="pipe">${segs}</div><div class="pipe-lg">${keys}</div>`;
    }
  }

  // Upcoming
  const upcoming = [...D.tasks].filter(t => t.status !== 'done')
    .sort((a,b) => (a.deadline||'9999') > (b.deadline||'9999') ? 1 : -1)
    .slice(0, 5);
  const ul = document.getElementById('upcoming-list');
  if(!upcoming.length){
    ul.innerHTML = '<div class="emp" style="padding:22px"><div class="empi">🎉</div><div class="empt">All Clear!</div><div class="emps">No pending tasks right now.</div></div>';
  } else {
    ul.innerHTML = upcoming.map(t => {
      const pc = P_CFG[t.priority]||P_CFG.medium;
      const sc = S_CFG[t.status]||S_CFG.todo;
      const proj = D.projects.find(p => p.id == t.projectId);
      const ovr  = t.deadline && deadlineDate(t.deadline) < today;
      const meta = [pc.label + ' priority', proj ? proj.title : null].filter(Boolean).join(' · ');
      return `<div class="uprow" onclick="viewNotes(${t.id})" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:9px;min-width:0">
          <div style="width:7px;height:7px;border-radius:50%;background:${pc.dot};flex-shrink:0"></div>
          <div style="min-width:0"><div class="uptit">${esc(t.title)}</div><div class="upsub">${esc(meta)}</div></div>
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
          <span class="bdg ${sc.cls}">${sc.label}</span>
          ${t.deadline?`<span class="bdg ${ovr?'bh':'btd'}" title="${esc(fmtDateTime(t.deadline))}">${ovr?'⚠️ ':''}${esc(relDue(deadlineDate(t.deadline), today))}</span>`:''}
        </div>
      </div>`;
    }).join('');
  }
}

/* ══════════════════════════════════════
   VISIONS & PROJECTS
══════════════════════════════════════ */
function paceText(totalHours, targetDate){
  if(!totalHours) return '';
  if(!targetDate) return `⏱ ${totalHours}h total`;
  const days = Math.max(1, Math.ceil((new Date(targetDate+'T23:59:59') - new Date())/864e5));
  const perDay = (totalHours/days).toFixed(1);
  return `⏱ ${totalHours}h over ${days} day${days!==1?'s':''} · ≈ ${perDay} h/day pace`;
}
function updateVisionPreview(){
  const h = +document.getElementById('vHours').value || 0;
  const t = document.getElementById('vTarget').value;
  document.getElementById('vPreview').textContent = paceText(h, t);
}
function addVision(){
  const t   = document.getElementById('vTitle').value.trim();
  const ty  = document.getElementById('vType').value;
  const hrs = +document.getElementById('vHours').value || 0;
  const tgt = document.getElementById('vTarget').value;
  if(!t){ toast('Goal title required.','error'); return; }
  // Clean simple model: hours is the canonical budget; targetDate is for pace tracking
  D.visions.push({id:newId(), title:t, type:ty, durationMode:'hours', totalHours:hrs, targetDate:tgt});
  document.getElementById('vTitle').value = '';
  document.getElementById('vHours').value = '';
  document.getElementById('vTarget').value = '';
  document.getElementById('vPreview').textContent = '';
  save(); renderAll(); toast('Goal added!');
}

/* ── EDIT VISION ── */
let _editingVisionId = null;
function openVisionModal(id){
  const v = D.visions.find(x => x.id === id);
  if(!v) return;
  _editingVisionId = id;
  document.getElementById('ev-title').value  = v.title;
  document.getElementById('ev-type').value   = v.type || 'Short Term';
  document.getElementById('ev-hours').value  = v.totalHours || '';
  document.getElementById('ev-target').value = v.targetDate || '';
  document.getElementById('ev-start').value  = v.startDate || '';
  document.getElementById('ev-end').value    = v.endDate || '';
  updateEvPace();
  ['ev-hours','ev-target'].forEach(id => document.getElementById(id).oninput = updateEvPace);
  document.getElementById('vision-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('ev-title').focus(), 60);
}
function closeVisionModal(){ document.getElementById('vision-modal').style.display = 'none'; _editingVisionId = null; }
function updateEvPace(){
  const h = +document.getElementById('ev-hours').value || 0;
  const t = document.getElementById('ev-target').value;
  document.getElementById('ev-pace').textContent = paceText(h, t);
}
function saveVisionEdit(){
  if(!_editingVisionId) return;
  const v = D.visions.find(x => x.id === _editingVisionId);
  if(!v) return;
  const t = document.getElementById('ev-title').value.trim();
  if(!t){ toast('Title required.','error'); return; }
  v.title       = t;
  v.type        = document.getElementById('ev-type').value;
  v.totalHours  = +document.getElementById('ev-hours').value || 0;
  v.targetDate  = document.getElementById('ev-target').value;
  v.durationMode = 'hours';
  v.startDate   = document.getElementById('ev-start').value;
  v.endDate     = document.getElementById('ev-end').value;
  save(); renderAll(); closeVisionModal(); toast('Goal updated!');
}

/* ── EDIT PROJECT ── */
let _editingProjectId = null;
function openProjectModal(id){
  const p = D.projects.find(x => x.id === id);
  if(!p) return;
  _editingProjectId = id;
  document.getElementById('ep-title').value  = p.title;
  document.getElementById('ep-hours').value  = p.hoursAllocated==null ? '' : p.hoursAllocated;
  document.getElementById('ep-start').value  = p.startDate || '';
  document.getElementById('ep-end').value    = p.endDate || '';
  // Populate vision dropdown
  const vsel = document.getElementById('ep-vision');
  vsel.innerHTML = '<option value="">— Unlinked —</option>' +
    D.visions.map(v => `<option value="${v.id}"${v.id==p.visionId?' selected':''}>${esc(v.title)}</option>`).join('');
  updateEpBudget();
  ['ep-vision','ep-hours'].forEach(id => document.getElementById(id).oninput = updateEpBudget);
  document.getElementById('ep-vision').onchange = updateEpBudget;
  document.getElementById('project-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('ep-title').focus(), 60);
}
function closeProjectModal(){ document.getElementById('project-modal').style.display = 'none'; _editingProjectId = null; }
function updateEpBudget(){
  const vid = document.getElementById('ep-vision').value;
  const v   = D.visions.find(x => x.id == vid);
  const info = document.getElementById('ep-budget-info');
  if(!v){ info.textContent = ''; return; }
  const goalH = goalTotalHours(v);
  const others = D.projects.filter(p => p.visionId==v.id && p.id!==_editingProjectId && p.hoursAllocated!=null && p.hoursAllocated!=='').reduce((s,p)=>s+ +p.hoursAllocated,0);
  const remaining = Math.max(0, goalH - others);
  info.textContent = `Goal budget: ${goalH}h · Others use ${others}h · ${remaining}h available for this project`;
}
function saveProjectEdit(){
  if(!_editingProjectId) return;
  const p = D.projects.find(x => x.id === _editingProjectId);
  if(!p) return;
  const t = document.getElementById('ep-title').value.trim();
  if(!t){ toast('Title required.','error'); return; }
  const vid  = document.getElementById('ep-vision').value;
  const hraw = document.getElementById('ep-hours').value.trim();
  p.title          = t;
  p.visionId       = vid ? parseInt(vid) : null;
  p.hoursAllocated = hraw === '' ? null : (+hraw||0);
  p.startDate      = document.getElementById('ep-start').value;
  p.endDate        = document.getElementById('ep-end').value;
  save(); renderAll(); closeProjectModal(); toast('Project updated!');
}
function delVision(id){
  confirmAction('Delete goal? Linked projects will be unlinked.', ()=>{
    D.visions = D.visions.filter(v => v.id !== id);
    D.projects.forEach(p => { if(p.visionId == id) p.visionId = null; });
    save(); renderAll(); toast('Goal deleted.','info');
  });
}
function addProject(){
  const t  = document.getElementById('pTitle').value.trim();
  const vi = document.getElementById('pVision').value;
  const hraw = document.getElementById('pHours').value.trim();
  const hrs  = hraw === '' ? null : (+hraw||0);
  if(!t || !vi){ toast('Title and goal required.','error'); return; }
  D.projects.push({id:newId(), visionId:parseInt(vi), title:t, hoursAllocated:hrs});
  document.getElementById('pTitle').value = '';
  document.getElementById('pHours').value = '';
  // Validate budget
  const v = D.visions.find(x=>x.id==vi);
  if(v){
    const goalH = goalTotalHours(v);
    const used  = visionAllocated(v);
    if(goalH && used > goalH) toast(`⚠ Allocated ${used}h exceeds goal ${goalH}h`,'error');
  }
  save(); renderAll(); toast('Project added!');
}
function delProject(id){
  confirmAction('Delete project? Linked tasks will be unlinked.', ()=>{
    D.projects = D.projects.filter(p => p.id !== id);
    D.tasks.forEach(t => { if(t.projectId == id) t.projectId = null; });
    save(); renderAll(); toast('Project deleted.','info');
  });
}
function renderVisionsPage(){
  // First-run guide (clears automatically once data exists)
  renderFirstRunGuide('frg-visions');
  // Vision dropdown in project form
  const pVis = document.getElementById('pVision');
  if(pVis){
    const cur = pVis.value;
    pVis.innerHTML = '<option value="">— Link to Goal —</option>' +
      D.visions.map(v => `<option value="${v.id}"${v.id==cur?' selected':''}>${esc(v.title)}</option>`).join('');
  }
  // Project dropdowns in task modal
  const tp = document.getElementById('t-project');
  if(tp){
    const cur2 = tp.value;
    tp.innerHTML = '<option value="">— No Project —</option>' +
      D.projects.map(p => `<option value="${p.id}"${p.id==cur2?' selected':''}>${esc(p.title)}</option>`).join('');
  }
  // Project filter
  const pf = document.getElementById('projectFilter');
  if(pf){
    const cur3 = pf.value;
    pf.innerHTML = '<option value="all">All Projects</option>' +
      D.projects.map(p => `<option value="${p.id}"${p.id==cur3?' selected':''}>${esc(p.title)}</option>`).join('');
  }
  // Tag filter
  const tgf = document.getElementById('tagFilter');
  if(tgf){
    const curTag = tgf.value;
    const allTags = [...new Set(D.tasks.flatMap(t => t.tags||[]))].sort();
    tgf.innerHTML = '<option value="all">All Tags</option>' +
      allTags.map(tg => `<option value="${esc(tg)}"${tg===curTag?' selected':''}>#${esc(tg)}</option>`).join('');
  }

  const vl = document.getElementById('visions-list');
  if(vl){
    if(!D.visions.length){
      vl.innerHTML = '<div class="emp" style="padding:18px"><div class="empi">🎯</div><div class="empt">No Goals Yet</div><div class="emps">Add your first goal above.</div></div>';
    } else {
      vl.innerHTML = D.visions.map(v => {
        const tc      = D.projects.filter(p=>p.visionId==v.id).length;
        const goalH   = goalTotalHours(v);
        const used    = visionAllocated(v);
        const auto    = D.projects.filter(p=>p.visionId==v.id && (p.hoursAllocated==null||p.hoursAllocated==='')).length;
        const pct     = goalH ? Math.min(100, (used/goalH)*100) : 0;
        const overCap = used > goalH && goalH>0;
        return `<div class="li" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div class="lin">${esc(v.title)}</div>
              <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap">
                <span class="bdg ${v.type==='Long Term'?'bip':v.type==='Medium Term'?'brv':'bdn'}">${esc(v.type||'Short Term')}</span>
                <span class="bdg btd">${tc} project${tc!==1?'s':''}</span>
                <span class="bdg bhr">⏱ ${goalDurationLabel(v)}</span>
                ${(v.startDate||v.endDate)?`<span class="bdg brv">📅 ${v.startDate&&v.endDate?`${fmtDate(v.startDate)} – ${fmtDate(v.endDate)}`:v.startDate?`from ${fmtDate(v.startDate)}`:`until ${fmtDate(v.endDate)}`}</span>`:''}
              </div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0">
              <button class="bic" onclick="openVisionModal(${v.id})" title="Edit Goal"><svg class="i" aria-hidden="true"><use href="#i-edit"/></svg></button>
              <button class="bic bic-red" onclick="delVision(${v.id})" title="Delete"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>
            </div>
          </div>
          ${goalH?`
          <div class="cap-bar ${overCap?'over':''}"><div style="width:${pct}%"></div></div>
          <div class="cap-meta">${used}h allocated / ${goalH}h ${auto?`· ${auto} project${auto!==1?'s':''} auto-balancing ${Math.max(0,goalH-used)}h`:''}${v.targetDate?` · 🎯 by ${fmtDate(v.targetDate)}`:''}</div>
          `:''}
        </div>`;
      }).join('');
    }
  }

  const pl = document.getElementById('projects-list');
  if(pl){
    if(!D.projects.length){
      pl.innerHTML = '<div class="emp" style="padding:18px"><div class="empi">🗂️</div><div class="empt">No Projects Yet</div><div class="emps">Add a vision first, then link projects.</div></div>';
    } else {
      pl.innerHTML = D.projects.map(p => {
        const v       = D.visions.find(x => x.id == p.visionId);
        const tc      = D.tasks.filter(t=>t.projectId==p.id).length;
        const goalH   = v ? goalTotalHours(v) : 0;
        const allotH  = projectHours(p, D.projects, goalH);
        const doneH   = projectDoneHours(p);
        const pct     = allotH ? Math.min(100, (doneH/allotH)*100) : 0;
        const auto    = (p.hoursAllocated==null||p.hoursAllocated==='');
        return `<div class="li" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div class="lin">${esc(p.title)}</div>
              <div class="lis">🎯 ${esc(v?.title||'Unlinked')} · ${tc} task${tc!==1?'s':''} · <span class="bdg bhr" style="padding:1px 6px;font-size:.65rem">⏱ ${allotH.toFixed(1)}h${auto?' (auto)':''}</span>${(p.startDate||p.endDate)?` <span class="bdg brv" style="padding:1px 6px;font-size:.65rem">📅 ${p.startDate?fmtDate(p.startDate):'?'} – ${p.endDate?fmtDate(p.endDate):'?'}</span>`:''}</div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0">
              <button class="bic" onclick="openProjectModal(${p.id})" title="Edit Project"><svg class="i" aria-hidden="true"><use href="#i-edit"/></svg></button>
              <button class="bic bic-red" onclick="delProject(${p.id})" title="Delete"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>
            </div>
          </div>
          ${allotH?`<div class="cap-bar"><div style="width:${pct}%"></div></div><div class="cap-meta">${doneH}h done / ${allotH.toFixed(1)}h budget</div>`:''}
        </div>`;
      }).join('');
    }
  }
}

/* ══════════════════════════════════════
   TASKS
══════════════════════════════════════ */
function getFiltered(){
  const sf = document.getElementById('statusFilter')?.value  || 'all';
  const pf = document.getElementById('projectFilter')?.value || 'all';
  const tf = document.getElementById('tagFilter')?.value     || 'all';
  return D.tasks.filter(t => {
    if(sf !== 'all' && t.status !== sf) return false;
    if(pf !== 'all' && String(t.projectId) !== pf) return false;
    if(tf !== 'all' && !(t.tags||[]).includes(tf)) return false;
    if(searchTerm && !t.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });
}
function setView(v){
  currentView = v;
  document.getElementById('vt-list').classList.toggle('act', v==='list');
  document.getElementById('vt-kanban').classList.toggle('act', v==='kanban');
  document.getElementById('list-view').style.display   = v==='list'   ? '' : 'none';
  document.getElementById('kanban-view').style.display = v==='kanban' ? '' : 'none';
  renderTasks();
}
function renderTasks(){
  renderVisionsPage(); // keep dropdowns in sync
  const filtered = getFiltered();
  const tc = document.getElementById('task-count');
  if(tc) tc.textContent = filtered.length+' task'+(filtered.length!==1?'s':'')+' found';

  if(currentView === 'list'){
    const g = document.getElementById('tasks-grid');
    if(!g) return;
    if(!filtered.length){
      g.innerHTML = '<div class="emp" style="grid-column:1/-1"><div class="empi">🔍</div><div class="empt">No Tasks Found</div><div class="emps">Try adjusting filters or add a task.</div></div>';
      return;
    }
    const groupBy = document.getElementById('groupBy')?.value || 'project';
    if(groupBy === 'none'){
      g.style.display = 'grid';
      g.innerHTML = filtered.map(t => buildTaskCard(t)).join('');
    } else {
      g.style.display = 'block';
      const groups = {};
      filtered.forEach(t => {
        let key, label;
        if(groupBy==='project'){
          const p = D.projects.find(x=>x.id==t.projectId);
          key = p?p.id:'_none'; label = p?p.title:'No Project';
        } else {
          key = t.status; label = (S_CFG[t.status]||S_CFG.todo).label;
        }
        (groups[key] = groups[key] || {label, items:[]}).items.push(t);
      });
      g.innerHTML = Object.entries(groups).map(([k,grp]) => {
        const done = grp.items.filter(t=>t.status==='done').length;
        const totH = grp.items.reduce((s,t)=>s+(+t.estHours||0),0);
        const pct  = grp.items.length ? (done/grp.items.length)*100 : 0;
        return `<div class="sec" data-sec="${k}">
          <div class="sec-h" onclick="this.parentElement.classList.toggle('col')">
            <span class="sec-caret">▼</span>
            <span>${esc(grp.label)}</span>
            <span class="sec-meta">
              <span class="sec-bar"><div style="width:${pct}%"></div></span>
              <span>${done}/${grp.items.length} done · Σ${totH}h</span>
            </span>
          </div>
          <div class="sec-body tgrd" style="display:grid">${grp.items.map(t=>buildTaskCard(t)).join('')}</div>
        </div>`;
      }).join('');
    }
  } else {
    const cols = {todo:'kb-todo',in_progress:'kb-ip',review:'kb-rv',done:'kb-dn'};
    const cnts = {todo:'kc-todo',in_progress:'kc-ip',review:'kc-rv',done:'kc-dn'};
    Object.entries(cols).forEach(([st, colId]) => {
      const col = document.getElementById(colId);
      if(!col) return;
      const tasks = filtered.filter(t => t.status === st);
      const cnt = document.getElementById(cnts[st]);
      if(cnt) cnt.textContent = tasks.length;
      if(!tasks.length){
        col.innerHTML = '<div class="kdrop-hint">Drop tasks here</div>';
      } else {
        col.innerHTML = tasks.map(t => buildKanbanCard(t)).join('');
      }
    });
  }
}
function buildTaskCard(t){
  const pc   = P_CFG[t.priority]  || P_CFG.medium;
  const sc   = S_CFG[t.status]    || S_CFG.todo;
  const proj = D.projects.find(p  => p.id == t.projectId);
  const ovr  = t.status !== 'done' && t.deadline && deadlineDate(t.deadline) < todayStr();
  const isDn = t.status === 'done';
  const subTotal = (t.subtasks||[]).length;
  const subDone   = (t.subtasks||[]).filter(s=>s.done).length;
  const hourOver  = (+t.actualHours||0) > (+t.estHours||0) && +t.estHours>0;
  const isBlocked = (t.blockedBy||[]).some(bid => { const bt=D.tasks.find(x=>x.id===bid); return bt && bt.status!=='done'; });
  const timerRunning = !!t.timerStart;
  const elapsed   = timerRunning ? fmtElapsed(Date.now() - t.timerStart + (t.timerTotal||0)*3600000) : '';
  const cmtCount  = (t.comments||[]).length;
  return `<div class="tcd ${isDn?'done':''}">
    <div class="tbar" style="background:${pc.bar}"></div>
    <div class="tin">
      <div class="ttop">
        <button class="tcheck ${isDn?'dn':''}" onclick="toggleComplete(${t.id})" title="${isDn?'Mark as To Do':'Mark complete'}">${isDn?'✓':''}</button>
        <div class="tnm" ondblclick="inlineEditTitle(this,${t.id})">${esc(t.title)}</div>
        <span class="tic-grp">
          <button class="bic" onclick="openTaskModal(${t.id})" title="Edit"><svg class="i" aria-hidden="true"><use href="#i-edit"/></svg></button>
          <button class="bic bic-red" onclick="deleteTask(${t.id})" title="Delete"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>
        </span>
      </div>
      <div class="tmeta">
        <span class="bdg ${pc.cls}">● ${pc.label}</span>
        ${isBlocked?`<span class="blocked-badge">🔒 Blocked</span>`:''}
        ${t.recurrence&&t.recurrence!=='none'?`<span class="rec-badge">🔁 ${t.recurrence}</span>`:''}
        ${proj?`<span class="bdg btd">${esc(proj.title)}</span>`:''}
        ${t.deadline?`<span class="bdg ${ovr?'bh':'btd'}" title="${esc(fmtDateTime(t.deadline))}">${ovr?'⚠️ ':''}${esc(relDue(deadlineDate(t.deadline)))}</span>`:''}
        <span class="bdg ${sc.cls}">${sc.label}</span>
        ${(+t.estHours||+t.actualHours)?`<span class="bdg bhr ${hourOver?'over':''}">⏱ ${(+t.actualHours||0)}/${(+t.estHours||0)}h</span>`:''}
        ${subTotal?`<span class="bdg btd">☑ ${subDone}/${subTotal}</span>`:''}
        ${cmtCount?`<span class="bdg btd">💬 ${cmtCount}</span>`:''}
        ${(t.tags||[]).map(tg=>`<span class="tag">#${esc(tg)}</span>`).join('')}
        ${(()=>{
          if(!t.assignedTo || WS_MODE!=='company') return '';
          const m = _wsMembers.find(x=>x.uid===t.assignedTo) || (WS.users||[]).find(x=>x.id===t.assignedTo);
          if(!m) return '';
          const initials = (m.initials || (m.name||'?').slice(0,2)).toUpperCase();
          const bg = m.avatarColor||'linear-gradient(135deg,#5B6EF5,#7C3AED)';
          return `<span class="user-av-sm" style="background:${bg}" title="Assigned: ${esc(m.name)}">${esc(initials)}</span>`;
        })()}
      </div>
      <div class="tact">
        ${(()=>{
          // Show Accept button only for the assigned user when status = 'assigned'
          if(t.status==='assigned' && _fbUser && t.assignedTo===_fbUser.uid){
            return `<button class="btn bp bsm" onclick="acceptTask(${t.id})" style="background:linear-gradient(135deg,#10B981,#06B6D4)">🤝 Accept Task</button>`;
          }
          return '';
        })()}
        <button class="timer-btn ${timerRunning?'running':''}" onclick="toggleTimer(${t.id})">${timerRunning?''+elapsed:'Start timer'}</button>
        <button class="btn bo bsm" onclick="viewNotes(${t.id})">Details</button>
        <select class="tss" onchange="updateStatus(${t.id},this.value)">
          <option value="todo"        ${t.status==='todo'       ?'selected':''}>To Do</option>
          <option value="assigned"    ${t.status==='assigned'   ?'selected':''}>Assigned</option>
          <option value="accepted"    ${t.status==='accepted'   ?'selected':''}>Accepted</option>
          <option value="in_progress" ${t.status==='in_progress'?'selected':''}>In Progress</option>
          <option value="review"      ${t.status==='review'     ?'selected':''}>In Review</option>
          <option value="done"        ${t.status==='done'       ?'selected':''}>Done</option>
        </select>
      </div>
    </div>
  </div>`;
}
function buildKanbanCard(t){
  const pc   = P_CFG[t.priority] || P_CFG.medium;
  const proj = D.projects.find(p => p.id == t.projectId);
  const ovr  = t.status !== 'done' && t.deadline && deadlineDate(t.deadline) < todayStr();
  return `<div class="kt" draggable="true" ondragstart="drag(event,${t.id})" onclick="viewNotes(${t.id})">
    <div class="ktbar" style="background:${pc.bar}"></div>
    <div class="ktt">${esc(t.title)}</div>
    <div class="ktm">
      <span style="display:flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:${pc.dot};display:inline-block"></span>${esc(proj?.title||'—')}</span>
      ${t.deadline?`<span style="color:${ovr?'var(--err)':'inherit'}">${ovr?'⚠️ ':''}${fmtDateTime(t.deadline)}</span>`:''}
    </div>
    <div style="margin-top:6px;display:flex;justify-content:flex-end" onclick="event.stopPropagation()">
      <button class="bic" style="font-size:.72rem;padding:4px 8px" onclick="openTaskModal(${t.id})"><svg class="i" aria-hidden="true"><use href="#i-edit"/></svg></button>
    </div>
  </div>`;
}
function updateStatus(id, status){
  const t = D.tasks.find(x => x.id === id);
  if(!t) return;
  t.status = status;
  if(status === 'done' && !t.completedAt) t.completedAt = new Date().toISOString();
  if(status !== 'done') t.completedAt = null;
  // Record when work actually starts
  if(status === 'in_progress' && !t.startedAt) t.startedAt = Date.now();
  save(); renderTasks(); renderDashboard(); renderMyDay(); renderVisionsPage();
  renderMyTasks(); renderNotifications(); checkDueNotifications();
}
function toggleComplete(id){
  const t = D.tasks.find(x => x.id === id);
  if(!t) return;
  const wasDone = t.status === 'done';
  updateStatus(id, wasDone ? 'todo' : 'done');
  if(!wasDone && t.recurrence && t.recurrence !== 'none') spawnRecurring(t);
  toast(wasDone ? 'Reopened' : '✅ Task complete!');
}
const _CYCLE = ['todo','in_progress','review','done'];
function cycleStatus(id){
  const t = D.tasks.find(x => x.id === id);
  if(!t) return;
  const i = _CYCLE.indexOf(t.status);
  updateStatus(id, _CYCLE[(i+1) % _CYCLE.length]);
}
function inlineEditTitle(el, id){
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = (commit) => {
    el.contentEditable = 'false';
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    if(commit){
      const v = el.textContent.trim();
      const t = D.tasks.find(x => x.id === id);
      if(t && v && v !== t.title){ t.title = v; save(); renderTasks(); renderMyDay(); toast('Title updated'); }
      else renderTasks();
    } else { renderTasks(); }
  };
  const onBlur = () => finish(true);
  const onKey  = (e) => { if(e.key==='Enter'){ e.preventDefault(); el.blur(); } if(e.key==='Escape'){ finish(false); } };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
}
function deleteTask(id){
  confirmAction('Permanently delete this task?', ()=>{
    D.tasks = D.tasks.filter(t => t.id !== id);
    save(); renderAll(); toast('Task deleted.','info');
  });
}

/* ══════════════════════════════════════
   DRAG & DROP (Kanban board)
══════════════════════════════════════ */
let dragId = null;
function drag(e, id){ dragId = id; e.dataTransfer.effectAllowed = 'move'; }
function allowDrop(e){ e.preventDefault(); e.currentTarget.classList.add('dov'); }
function dragLeave(e){ e.currentTarget.classList.remove('dov'); }
function handleDrop(e, status){
  e.preventDefault(); e.currentTarget.classList.remove('dov');
  if(dragId){ updateStatus(dragId, status); dragId = null; }
}

/* ══════════════════════════════════════
   TASK MODAL
══════════════════════════════════════ */
function openTaskModal(taskId=null, presetDate=null){
  editingId = taskId;
  initQuill();
  const modal = document.getElementById('task-modal');
  const errEl = document.getElementById('modal-err');
  errEl.style.display = 'none';

  // Populate project dropdown
  const tp = document.getElementById('t-project');
  tp.innerHTML = '<option value="">— No Project —</option>' +
    D.projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');

  // Populate assign-to dropdown (company mode only)
  // Uses an inner helper so it can be called twice:
  //   1. Immediately with cached _wsMembers (modal opens with no delay)
  //   2. After a background fbLoadMembers() refresh so newly-joined invitees appear
  const at = document.getElementById('t-assignedto');
  const atWrap = document.getElementById('t-assignto-wrap');

  const populateAssignDropdown = (preserveVal) => {
    // Show ALL members (admin can self-assign; non-admins can be assigned too)
    const firestoreMembers = _wsMembers;
    const localMembers     = (WS.users||[]);
    const myUid = _fbUser?.uid || null;

    if(WS_MODE === 'personal' || WS_MODE === null){
      // Personal / no-workspace mode — still show Self Assign option
      atWrap.style.display = '';
      at.innerHTML = '<option value="">— Unassigned —</option>' +
        (myUid ? `<option value="${myUid}">🙋 Me (Self)</option>` : '');
      if(preserveVal != null) at.value = preserveVal;
      return;
    }
    if(firestoreMembers.length){
      atWrap.style.display = '';
      at.innerHTML = '<option value="">— Unassigned —</option>' +
        firestoreMembers.map(m => {
          const isSelf = m.uid === myUid;
          return `<option value="${m.uid}">${isSelf ? '🙋 ' : ''}${esc(m.name)}${isSelf ? ' (Me)' : ''} — ${esc(m.position||m.role||'Member')}</option>`;
        }).join('');
    } else if(localMembers.length){
      atWrap.style.display = '';
      at.innerHTML = '<option value="">— Unassigned —</option>' +
        localMembers.map(u => {
          const isSelf = u.id === myUid || u.uid === myUid;
          return `<option value="${u.id||u.uid}">${isSelf ? '🙋 ' : ''}${esc(u.name)}${isSelf ? ' (Me)' : ''} — ${esc(u.role||'Member')}</option>`;
        }).join('');
    } else {
      // Company mode but no members loaded yet — show just Self
      atWrap.style.display = '';
      at.innerHTML = '<option value="">— Unassigned —</option>' +
        (myUid ? `<option value="${myUid}">🙋 Me (Self)</option>` : '');
    }
    // Restore any previously-selected assignee after rebuild
    if(preserveVal != null) at.value = preserveVal;
  };

  // First pass — instant render from cache
  populateAssignDropdown(null);

  const fb = document.getElementById('t-editor-fallback');
  if(taskId){
    const t = D.tasks.find(x => x.id === taskId);
    if(!t) return;
    document.getElementById('modal-title').textContent = 'Edit task';
    document.getElementById('t-title').value    = t.title;
    document.getElementById('t-priority').value = t.priority;
    document.getElementById('t-status').value   = t.status || 'todo';
    document.getElementById('t-start').value      = t.startDate || '';
    document.getElementById('t-deadline').value   = t.deadline || '';
    document.getElementById('t-est').value        = t.estHours || '';
    document.getElementById('t-act').value        = t.actualHours || '';
    document.getElementById('t-recurrence').value = t.recurrence || 'none';
    document.getElementById('t-blocked').value    = (t.blockedBy||[]).join(', ');
    tp.value = t.projectId ? String(t.projectId) : '';
    quillNotes = t.notes || '';
    if(quillInst) quillInst.root.innerHTML = sanitizeHTML(t.notes);
    if(fb) fb.value = (t.notes||'').replace(/<[^>]+>/g,'');
    renderTagWrap(t.tags||[]);
    if(at) at.value = t.assignedTo || '';
  } else {
    document.getElementById('modal-title').textContent = '✨ New Task';
    document.getElementById('t-title').value      = '';
    document.getElementById('t-priority').value   = 'medium';
    document.getElementById('t-status').value     = 'todo';
    document.getElementById('t-start').value      = '';
    document.getElementById('t-deadline').value   = presetDate || '';
    document.getElementById('t-est').value        = '';
    document.getElementById('t-act').value        = '';
    document.getElementById('t-recurrence').value = 'none';
    document.getElementById('t-blocked').value    = '';
    tp.value = '';
    quillNotes = '';
    if(quillInst){ quillInst.setContents([]); }
    if(fb) fb.value = '';
    renderTagWrap([]);
  }
  modal.style.display = 'flex';
  setTimeout(()=>document.getElementById('t-title').focus(), 60);

  // Background member refresh — fires AFTER modal is open so there is no perceived delay.
  // When fbLoadMembers() resolves the dropdown is rebuilt with the latest Firestore data,
  // picking up any invitees who joined since the admin last logged in.
  if(WS_MODE === 'company' && _fbFS && WS.wsId){
    const savedAssignee = taskId
      ? (D.tasks.find(x => x.id === taskId)?.assignedTo || '')
      : '';
    fbLoadMembers()
      .then(() => populateAssignDropdown(savedAssignee))
      .catch(e => console.warn('openTaskModal member refresh:', e));
  }
}
function closeTaskModal(){
  document.getElementById('task-modal').style.display = 'none';
  editingId = null;
}
/* Pasted screenshots are stored inline as base64, and Firestore rejects any
   document over 1 MB — which silently stopped the task from syncing. Shrink
   large images and refuse to save a task that would still be too big. */
const MAX_DOC_BYTES = 900 * 1024;
function downscaleDataUrl(src, maxSide, quality){
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * sc));
      c.height = Math.max(1, Math.round(im.height * sc));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const out = c.toDataURL('image/jpeg', quality);
      resolve(out.length < src.length ? out : src);
    };
    im.onerror = () => resolve(src);
    im.src = src;
  });
}
async function shrinkNoteImages(html){
  if(!html || html.indexOf('data:image') < 0) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for(const img of tpl.content.querySelectorAll('img[src^="data:image"]')){
    const src = img.getAttribute('src');
    if(src.length > 120 * 1024) img.setAttribute('src', await downscaleDataUrl(src, 1280, 0.75));
  }
  return tpl.innerHTML;
}
function docBytes(d){ return new Blob([JSON.stringify(d)]).size; }

let _savingTask = false;  // a double-click while images shrink must not add the task twice
async function saveTask(){
  if(_savingTask) return;
  _savingTask = true;
  try { await saveTaskInner(); } finally { _savingTask = false; }
}
async function saveTaskInner(){
  const editId  = editingId;   // captured: image shrinking below is async
  const titleEl = document.getElementById('t-title');
  const title   = titleEl.value.trim();
  const projId  = document.getElementById('t-project').value;
  const prio    = document.getElementById('t-priority').value;
  const status  = document.getElementById('t-status').value;
  const startDate  = document.getElementById('t-start').value;
  const ddl        = document.getElementById('t-deadline').value;
  const est        = +document.getElementById('t-est').value || 0;
  const act        = +document.getElementById('t-act').value || 0;
  const recurrence = document.getElementById('t-recurrence').value;
  const blockedBy  = document.getElementById('t-blocked').value.split(',').map(s=>+s.trim()).filter(Boolean);
  const assignedTo = document.getElementById('t-assignedto').value || null;
  const tags       = _editTags.slice();
  const errEl   = document.getElementById('modal-err');
  const box     = document.querySelector('#task-modal .mbox');

  if(!title){
    errEl.textContent = 'Task title is required.';
    errEl.style.display = 'block';
    titleEl.focus();
    if(box){ box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
    return;
  }
  // Read notes from whichever editor is active
  let notes = quillNotes;
  if(quillFallback){
    const fb = document.getElementById('t-editor-fallback');
    if(fb) notes = fb.value;
  }
  notes = await shrinkNoteImages(notes);
  if(editId !== editingId) return;  // modal was closed/reopened meanwhile
  const completedAt = status==='done' ? (new Date().toISOString()) : null;
  const actorUid    = _fbUser?.uid || null;
  const tooBig = (task) => {
    if(docBytes(task) <= MAX_DOC_BYTES) return false;
    errEl.textContent = 'This task is too large to sync (' + Math.round(docBytes(task)/1024) + ' KB, limit ' + Math.round(MAX_DOC_BYTES/1024) + ' KB). Remove some images from the notes.';
    errEl.style.display = 'block';
    return true;
  };
  if(editingId){
    const idx = D.tasks.findIndex(t => t.id === editingId);
    if(idx >= 0){
      const prev = D.tasks[idx];
      // Detect assignment change — update assignedBy / assignedAt when assignedTo changes
      const assignmentChanged = assignedTo !== (prev.assignedTo||null);
      const newAssignedBy = assignmentChanged ? (assignedTo ? actorUid : null) : (prev.assignedBy||null);
      const newAssignedAt = assignmentChanged ? (assignedTo ? Date.now() : null) : (prev.assignedAt||null);
      const updated = {
        ...prev,
        title, projectId:projId?parseInt(projId):null, priority:prio, status,
        startDate, deadline:ddl, notes, estHours:est, actualHours:act,
        recurrence, blockedBy, tags,
        assignedTo,  assignedBy: newAssignedBy, assignedAt: newAssignedAt,
        createdBy:   prev.createdBy || actorUid,   // preserve original creator
        acceptedAt:  status === 'assigned' ? null : (prev.acceptedAt||null), // clear if re-assigned
        startedAt:   status === 'in_progress' && !prev.startedAt ? Date.now() : (prev.startedAt||null),
        completedAt: status==='done' ? (prev.completedAt||completedAt) : null
      };
      if(tooBig(updated)) return;
      D.tasks[idx] = updated;
    }
    toast('Task updated!');
  } else {
    const created = {
      id:newId(), title, projectId:projId?parseInt(projId):null, priority:prio,
      startDate, deadline:ddl, notes, status,
      estHours:est, actualHours:act, recurrence, blockedBy, tags,
      assignedTo,
      assignedBy: assignedTo ? actorUid : null,  // who assigned it
      assignedAt: assignedTo ? Date.now() : null, // when it was assigned
      createdBy:  actorUid,                        // who created it
      acceptedAt: null, startedAt: null,
      completedAt, subtasks:[], gcalEventId:null, timerStart:null, timerTotal:0
    };
    if(tooBig(created)) return;
    D.tasks.push(created);
    toast('Task added!');
  }
  save(); closeTaskModal(); renderAll();
}

/* ══════════════════════════════════════
   VIEW NOTES MODAL
══════════════════════════════════════ */
let _viewingId = null;
function viewNotes(id){
  const t = D.tasks.find(x => x.id === id);
  if(!t) return;
  _viewingId = id;
  const pc = P_CFG[t.priority] || P_CFG.medium;
  const sc = S_CFG[t.status]   || S_CFG.todo;
  document.getElementById('vm-title').textContent = t.title;
  document.getElementById('vm-badges').innerHTML =
    `<span class="bdg ${pc.cls}">● ${pc.label}</span>
     <span class="bdg ${sc.cls}">${sc.label}</span>
     ${t.deadline?`<span class="bdg btd">📅 ${fmtDateTime(t.deadline)}</span>`:''}
     ${(+t.estHours||+t.actualHours)?`<span class="bdg bhr">⏱ ${(+t.actualHours||0)}/${(+t.estHours||0)}h</span>`:''}`;
  document.getElementById('vm-content').innerHTML = t.notes
    ? `<div class="ql-editor" style="background:var(--surf2);border:1px solid var(--bd);border-radius:var(--r);min-height:70px;padding:12px 14px">${sanitizeHTML(t.notes)}</div>`
    : `<div class="emp" style="padding:22px"><div class="empi">📝</div><div class="empt">No Notes</div><div class="emps">Nothing stored for this task.</div></div>`;
  renderSubtasks();
  renderComments();
  // GCal button only enabled if deadline exists
  const gb = document.getElementById('vm-gcal-btn');
  if(gb){ gb.disabled = !t.deadline; gb.style.opacity = t.deadline ? '1' : '.5'; }
  document.getElementById('view-modal').style.display = 'flex';
  setTimeout(()=>{ const i = document.getElementById('vm-subt-input'); if(i) i.focus(); }, 80);
}
function renderComments(){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  const cmts = t.comments || [];
  const el = document.getElementById('vm-comments-list');
  if(!el) return;
  if(!cmts.length){
    el.innerHTML = '<div style="font-size:.77rem;color:var(--lt);font-style:italic;margin-bottom:6px">No comments yet — add one below.</div>';
    return;
  }
  el.innerHTML = cmts.map(c => {
    const bg = c.avatarColor || 'linear-gradient(135deg,#5B6EF5,#7C3AED)';
    const dt = c.ts ? new Date(c.ts).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="cmt-item">
      <div class="cmt-av" style="background:${bg}">${esc(c.initials||'?')}</div>
      <div class="cmt-body">
        <span class="cmt-author">${esc(c.name||'Unknown')}</span><span class="cmt-ts">${dt}</span>
        <div class="cmt-text">${esc(c.text)}</div>
      </div>
    </div>`;
  }).join('');
}
function addTaskComment(){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  const inp = document.getElementById('vm-cmt-input');
  const text = inp.value.trim();
  if(!text) return;
  // Get commenter info from current user
  const me = _wsMembers.find(m => m.uid === _fbUser?.uid) || _fbProfile || {};
  const name     = me.name     || WS_CUR_USER?.name     || 'You';
  const initials = me.initials || WS_CUR_USER?.initials || name.slice(0,2).toUpperCase();
  const avatarColor = me.avatarColor || 'linear-gradient(135deg,#5B6EF5,#7C3AED)';
  (t.comments = t.comments||[]).push({
    id: newId(),
    uid: _fbUser?.uid || WS_CUR_USER?.id || null,
    name, initials, avatarColor, text,
    ts: Date.now()
  });
  inp.value = '';
  save();
  renderComments();
  renderTasks();        // refresh comment badge count on task card
  renderNotifications(); // update notifications page if open
  checkDueNotifications();
  toast('💬 Comment added', 'success');
}
function renderSubtasks(){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  const subs = t.subtasks || (t.subtasks = []);
  const total = subs.length;
  const done  = subs.filter(s=>s.done).length;
  document.getElementById('vm-subt-count').textContent = total ? `${done}/${total} done` : '';
  document.getElementById('vm-subt-prog').style.width = total ? (done/total*100)+'%' : '0%';
  const list = document.getElementById('vm-subt-list');
  list.innerHTML = subs.length
    ? subs.map(s => `<div class="subt-row ${s.done?'dn':''}">
        <input type="checkbox" ${s.done?'checked':''} onchange="toggleSubtask(${s.id})">
        <span class="subt-tx">${esc(s.title)}</span>
        <button class="bic bic-red" style="padding:3px 6px;font-size:.7rem" onclick="delSubtask(${s.id})">✕</button>
      </div>`).join('')
    : '<div style="font-size:.78rem;color:var(--lt);font-style:italic;padding:4px 0">No subtasks yet — break the work down ↓</div>';
}
function addSubtask(){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  const input = document.getElementById('vm-subt-input');
  const v = input.value.trim();
  if(!v) return;
  (t.subtasks = t.subtasks||[]).push({id:newId(), title:v, done:false});
  input.value = '';
  save(); renderSubtasks(); renderTasks();
}
function toggleSubtask(sid){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  const s = (t.subtasks||[]).find(x => x.id === sid);
  if(s){ s.done = !s.done; save(); renderSubtasks(); renderTasks(); }
}
function delSubtask(sid){
  const t = D.tasks.find(x => x.id === _viewingId);
  if(!t) return;
  t.subtasks = (t.subtasks||[]).filter(x => x.id !== sid);
  save(); renderSubtasks(); renderTasks();
}
function editFromView(){
  const id = _viewingId;
  closeViewModal();
  if(id) openTaskModal(id);
}
function openGCalLink(){
  if(_viewingId) window.open(gcalDeepLink(_viewingId),'_blank');
}
function closeViewModal(){ document.getElementById('view-modal').style.display = 'none'; _viewingId = null; }

/* ══════════════════════════════════════
   CALENDAR
══════════════════════════════════════ */
function renderCalendar(){
  const el = document.getElementById('cal-grid');
  if(!el) return;
  document.getElementById('cal-title').textContent = MONTHS[calMonth]+' '+calYear;
  const firstDay  = new Date(calYear, calMonth, 1).getDay();
  const daysInMon = new Date(calYear, calMonth+1, 0).getDate();
  const today     = new Date();
  const ts        = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let html2 = DAYS7.map(d => `<div class="caldh">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html2 += `<div class="calday emp"></div>`;
  for(let d=1;d<=daysInMon;d++){
    const ds   = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isTd = ds === ts;
    const dts  = D.tasks.filter(t => deadlineDate(t.deadline) === ds);
    const load = dts.reduce((s,t) => s + (+t.estHours||0), 0);
    const loadCls = load > 6 ? 'load-hi' : load > 3 ? 'load-md' : load > 0 ? 'load-lo' : '';
    const pills = dts.map(t => {
      const bg = t.status==='done' ? '#10B981' : (P_CFG[t.priority]?.dot || '#5B6EF5');
      return `<div class="cpill" style="background:${bg}" onclick="event.stopPropagation();openTaskModal(${t.id})" title="${esc(t.title)}">${esc(t.title)}</div>`;
    }).join('');
    html2 += `<div class="calday${isTd?' tod':''}" onclick="openTaskModal(null,'${ds}')">
      <div class="calnum">${isTd?`<div class="calnum-inner">${d}</div>`:d}</div>
      ${loadCls?`<div class="cal-load ${loadCls}" title="${load}h scheduled"></div>`:''}
      ${pills}
    </div>`;
  }
  el.innerHTML = html2;
}
function calMove(dir){
  calMonth += dir;
  if(calMonth < 0){ calMonth = 11; calYear--; }
  if(calMonth > 11){ calMonth = 0;  calYear++; }
  renderCalendar();
}
function calToday(){
  calMonth = new Date().getMonth();
  calYear  = new Date().getFullYear();
  renderCalendar();
}

/* ══════════════════════════════════════
   SETTINGS
══════════════════════════════════════ */
function renderSettings(){
  refreshGCalStatus();
  // ── Workspace config card ──
  const wsBody = document.getElementById('ws-config-body');
  if(wsBody){
    const isCompany = WS_MODE === 'company';
    const modePill  = isCompany
      ? `<span class="workspace-pill wp-company">🏢 Company / Team</span>`
      : WS_MODE === 'personal'
        ? `<span class="workspace-pill wp-personal">👤 Personal</span>`
        : `<span class="workspace-pill" style="background:rgba(239,68,68,.1);color:#dc2626;border:1px solid rgba(239,68,68,.3)">⚠️ Not configured</span>`;
    // Prefer Firestore member count; fall back to local WS.users
    const memberCount = _wsMembers.length || (WS.users||[]).length;
    wsBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        ${modePill}
        ${isCompany ? `<strong style="font-size:.88rem">${esc(WS.orgName||'')}</strong>` : ''}
        ${isCompany ? `<span style="font-size:.78rem;color:var(--muted)">${memberCount} member${memberCount!==1?'s':''}</span>` : ''}
      </div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:13px;line-height:1.6">
        ${isCompany
          ? `Company workspace — team members can be assigned tasks. <a href="#" onclick="showPage('admin');return false" style="color:var(--p);font-weight:700">Open Admin Console →</a>`
          : WS_MODE === 'personal'
            ? 'Personal mode — all tasks belong to you.'
            : 'Workspace not configured. Complete profile setup via the Admin Console.'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn bp bsm" onclick="showPage('admin')">Admin console</button>
      </div>`;
  }
  // ── Data overview ──
  const ov = document.getElementById('data-overview');
  if(!ov) return;
  const total = D.tasks.length;
  const done  = D.tasks.filter(t=>t.status==='done').length;
  const today_ = todayStr();
  const overdue = D.tasks.filter(t=>t.status!=='done'&&t.deadline&&deadlineDate(t.deadline)<today_).length;
  let bytes = 0; try{ bytes = new Blob([JSON.stringify(D)]).size; }catch(e){}
  const kb = bytes ? (bytes<1024 ? bytes+' B' : (bytes/1024).toFixed(1)+' KB') : '—';
  const rows  = [['Goals',D.visions.length],['Projects',D.projects.length],['Total tasks',total],['Completed',done],['Overdue',overdue],['Stored data',kb]];
  ov.innerHTML = rows.map(([l,v])=>`
    <div class="ov-row"><span class="ov-l">${l}</span><span class="ov-v">${v}</span></div>`).join('');
}
function exportData(){
  const a = document.createElement('a');
  a.href = 'data:text/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(D));
  a.download = `MiyeeTaskManagerPro_Backup_${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Backup downloaded!');
}
function importData(input){
  const file = input.files[0]; if(!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if(!parsed || !['visions','projects','tasks'].some(k => Array.isArray(parsed[k]))) throw new Error('shape');
      if(!canReplaceAllData()) return;
      D = migrateData(parsed); save(); renderAll(); toast('Data restored!');
    }
    catch { toast('Invalid file format.','error'); }
  };
  r.readAsText(file);
  input.value = '';
}
/* Import / factory reset replace every record, and those changes now reach the
   cloud. In a team workspace that would wipe everyone's data, so only admins may. */
function canReplaceAllData(){
  if(WS_MODE !== 'company') return true;
  const me = _wsMembers.find(m => m.uid === _fbUser?.uid);
  if(me && me.isAdmin) return true;
  toast('Only a workspace admin can restore or reset shared workspace data.','error');
  return false;
}
function resetData(){
  if(!canReplaceAllData()) return;
  D = JSON.parse(JSON.stringify({visions:[],projects:[],tasks:[]}));
  save(); renderAll();
  showPage('visions');     // take user straight to Goals page
  toast('App has been reset. Create your first Goal to get started! 🎯','info');
}

/* ══════════════════════════════════════
   FIRST-RUN GUIDE
   Shown on Dashboard + Visions page when workspace is empty
══════════════════════════════════════ */
function frgGoToStep(step){
  if(step === 1){ showPage('visions'); setTimeout(() => document.getElementById('vTitle')?.focus(), 100); }
  if(step === 2){ showPage('visions'); setTimeout(() => document.getElementById('pTitle')?.focus(), 100); }
  if(step === 3){ openTaskModal(); }
}
function renderFirstRunGuide(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  const hasGoals    = D.visions.length > 0;
  const hasProjects = D.projects.length > 0;
  const hasTasks    = D.tasks.length > 0;
  if(hasGoals && hasProjects && hasTasks){ el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="frg-wrap">
      <div class="frg-title">👋 Welcome! Let's set up your workspace</div>
      <div class="frg-sub">Complete these 3 steps to get started — takes under 2 minutes.</div>
      <div class="frg-steps">
        <div class="frg-step ${hasGoals?'done':''}" onclick="${hasGoals?'':'frgGoToStep(1)'}">
          <div class="frg-num">${hasGoals?'✓':'1'}</div>
          <span>Create your 1st Goal</span>
        </div>
        <div class="frg-step ${hasProjects?'done':''}" onclick="${hasProjects||!hasGoals?'':'frgGoToStep(2)'}">
          <div class="frg-num">${hasProjects?'✓':'2'}</div>
          <span>Create your 1st Project</span>
        </div>
        <div class="frg-step ${hasTasks?'done':''}" onclick="${hasTasks||!hasProjects?'':'frgGoToStep(3)'}">
          <div class="frg-num">${hasTasks?'✓':'3'}</div>
          <span>Create your 1st Task</span>
        </div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════
   MY TASKS PAGE
══════════════════════════════════════ */
function renderMyTasks(){
  const body = document.getElementById('mytasks-body');
  if(!body) return;
  const myUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;

  // Assigned TO me by someone else
  const assignedToMe = D.tasks.filter(t =>
    t.assignedTo && t.assignedTo === myUid && t.assignedBy !== myUid && t.status !== 'done'
  );
  // Self-assigned
  const selfAssigned = D.tasks.filter(t =>
    t.assignedTo && t.assignedTo === myUid && t.assignedBy === myUid && t.status !== 'done'
  );
  // Completed my tasks (done)
  const completedMine = D.tasks.filter(t =>
    t.assignedTo && t.assignedTo === myUid && t.status === 'done'
  );

  if(!myUid && !assignedToMe.length && !selfAssigned.length){
    body.innerHTML = `<div class="notif-empty"><div class="notif-empty-ic">📌</div><div style="font-weight:700;font-size:.95rem">No tasks assigned yet</div><div style="font-size:.82rem;color:var(--lt);margin-top:5px">Tasks assigned to you or self-assigned will appear here.</div></div>`;
    return;
  }

  const buildMtCard = (t) => {
    const sc    = S_CFG[t.status] || S_CFG.todo;
    const pc    = P_CFG[t.priority] || P_CFG.medium;
    const proj  = D.projects.find(p => p.id == t.projectId);
    const today = todayStr();
    const ovr   = t.deadline && deadlineDate(t.deadline) < today;
    const assigner = t.assignedBy && t.assignedBy !== myUid
      ? (_wsMembers.find(m => m.uid === t.assignedBy) || (WS.users||[]).find(u => u.id === t.assignedBy || u.uid === t.assignedBy))
      : null;
    const cmtCnt = (t.comments||[]).length;
    return `<div class="mt-card">
      <div class="mt-left">
        <div class="mt-title">${esc(t.title)}</div>
        <div class="mt-meta">
          <span class="bdg ${sc.cls}">${sc.label}</span>
          <span class="bdg ${pc.cls}">● ${pc.label}</span>
          ${proj?`<span class="bdg btd">${esc(proj.title)}</span>`:''}
          ${t.deadline?`<span class="bdg ${ovr?'bh':'btd'}">${ovr?'⚠️ ':''}${fmtDateTime(t.deadline)}</span>`:''}
          ${cmtCnt?`<span class="bdg btd">💬 ${cmtCnt}</span>`:''}
        </div>
        ${assigner?`<div class="mt-assigner">Assigned by ${esc(assigner.name)}</div>`:''}
      </div>
      <div class="mt-right">
        <select class="tss" onchange="updateStatus(${t.id},this.value)">
          ${Object.entries(S_CFG).map(([v,c])=>`<option value="${v}"${t.status===v?' selected':''}>${c.label}</option>`).join('')}
        </select>
        <button class="bic" onclick="viewNotes(${t.id})" title="Detail / Comment">📄</button>
        <button class="bic" onclick="openTaskModal(${t.id})" title="Edit"><svg class="i" aria-hidden="true"><use href="#i-edit"/></svg></button>
      </div>
    </div>`;
  };

  let html = '';

  if(assignedToMe.length){
    html += `<div class="mytask-sec">
      <div class="mytask-sec-title">📥 Assigned to Me <span class="cnt">${assignedToMe.length}</span></div>
      ${assignedToMe.map(buildMtCard).join('')}
    </div>`;
  }
  if(selfAssigned.length){
    html += `<div class="mytask-sec">
      <div class="mytask-sec-title">🙋 Self Assigned <span class="cnt">${selfAssigned.length}</span></div>
      ${selfAssigned.map(buildMtCard).join('')}
    </div>`;
  }
  if(completedMine.length){
    html += `<div class="mytask-sec">
      <div class="mytask-sec-title">✅ Completed <span class="cnt">${completedMine.length}</span></div>
      ${completedMine.map(buildMtCard).join('')}
    </div>`;
  }
  if(!html){
    html = `<div class="notif-empty"><div class="notif-empty-ic">🎉</div><div style="font-weight:700;font-size:.95rem">All clear!</div><div style="font-size:.82rem;color:var(--lt);margin-top:5px">No active tasks assigned to you right now.</div></div>`;
  }
  body.innerHTML = html;
}

/* ══════════════════════════════════════
   NOTIFICATIONS PAGE
══════════════════════════════════════ */
function renderNotifications(){
  const body = document.getElementById('notifications-body');
  if(!body) return;
  const today = todayStr();
  const myUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;

  const cards = [];

  // 1. Tasks assigned TO me (unread = not in readBy)
  D.tasks.filter(t => t.assignedTo === myUid && t.assignedBy !== myUid).forEach(t => {
    const assigner = t.assignedBy
      ? (_wsMembers.find(m=>m.uid===t.assignedBy) || (WS.users||[]).find(u=>u.id===t.assignedBy||u.uid===t.assignedBy))
      : null;
    const isRead = (t.readBy||[]).includes(myUid);
    const ovr  = t.deadline && deadlineDate(t.deadline) < today;
    cards.push({
      grp: 2,
      ts: t.assignedAt || 0,
      html: `<div class="notif-card ${isRead?'':'unread'}" id="ncard-${t.id}">
        <div class="notif-card-title">Assigned to you: <strong>${esc(t.title)}</strong></div>
        <div class="notif-card-sub">
          ${assigner?`By <strong>${esc(assigner.name)}</strong> · `:''}
          Status: <strong>${(S_CFG[t.status]||S_CFG.todo).label}</strong>
          ${t.deadline?` · Due: <strong style="color:${ovr?'var(--err)':'inherit'}">${ovr?'⚠️ ':''}${fmtDateTime(t.deadline)}</strong>`:''}
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn bp bsm" onclick="viewNotes(${t.id});markNotifRead(${t.id})">View &amp; comment</button>
          <button class="btn bo bsm" onclick="openTaskModal(${t.id})">Edit</button>
          ${!isRead?`<button class="btn bo bsm" onclick="markNotifRead(${t.id})">Mark read</button>`:''}
        </div>
        <div class="notif-card-ts">${t.assignedAt?new Date(t.assignedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>
      </div>`
    });
  });

  // 2. Tasks I assigned — show latest status update
  D.tasks.filter(t => t.assignedBy === myUid && t.assignedTo && t.assignedTo !== myUid).forEach(t => {
    const assignee = _wsMembers.find(m=>m.uid===t.assignedTo) || (WS.users||[]).find(u=>u.id===t.assignedTo||u.uid===t.assignedTo);
    const sc = S_CFG[t.status] || S_CFG.todo;
    const isDone = t.status === 'done';
    cards.push({
      grp: 4,
      ts: t.startedAt || t.acceptedAt || t.assignedAt || 0,
      html: `<div class="notif-card ${isDone?'success':'info'}">
        <div class="notif-card-title">You assigned: <strong>${esc(t.title)}</strong></div>
        <div class="notif-card-sub">
          ${assignee?`To <strong>${esc(assignee.name)}</strong> · `:''}
          Status: <span class="bdg ${sc.cls}" style="display:inline-flex">${sc.label}</span>
          ${t.completedAt?` · Completed ${new Date(t.completedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}` : ''}
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn bp bsm" onclick="viewNotes(${t.id})">View &amp; comment</button>
        </div>
        <div class="notif-card-ts">${t.assignedAt?new Date(t.assignedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>
      </div>`
    });
  });

  // 3. Overdue tasks
  D.tasks.filter(t => t.status!=='done' && t.deadline && deadlineDate(t.deadline) < today && (!myUid || t.assignedTo===myUid || t.createdBy===myUid || !t.assignedTo)).forEach(t => {
    cards.push({
      grp: 0,
      ts: new Date(deadlineDate(t.deadline)).getTime() || 0,
      html: `<div class="notif-card unread">
        <div class="notif-card-title">Overdue: <strong>${esc(t.title)}</strong></div>
        <div class="notif-card-sub">Due <strong style="color:var(--err)" title="${esc(fmtDateTime(t.deadline))}">${esc(relDue(deadlineDate(t.deadline)))}</strong> · Status: ${(S_CFG[t.status]||S_CFG.todo).label}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn bp bsm" onclick="toggleComplete(${t.id})">Complete</button>
          <button class="btn bo bsm" onclick="openTaskModal(${t.id})">Reschedule</button>
        </div>
      </div>`
    });

  // 3b. Due today / due in the next 3 days — a task manager should warn before
  // the deadline passes, not only after it has.
  const soonEnd = new Date(); soonEnd.setDate(soonEnd.getDate()+3);
  const soonEndS = localDateStr(soonEnd);
  D.tasks.filter(t => t.status!=='done' && t.deadline && deadlineDate(t.deadline) >= today && deadlineDate(t.deadline) <= soonEndS
                 && (!myUid || t.assignedTo===myUid || t.createdBy===myUid || !t.assignedTo)).forEach(t => {
    const dd = deadlineDate(t.deadline);
    const isToday = dd === today;
    cards.push({
      grp: isToday ? 1 : 3,
      ts: new Date(dd).getTime() || 0,
      html: `<div class="notif-card ${isToday?'unread':'info'}">
        <div class="notif-card-title">${isToday?'Due today':'Due soon'}: <strong>${esc(t.title)}</strong></div>
        <div class="notif-card-sub">Due <strong>${esc(relDue(dd))}</strong> · Status: ${(S_CFG[t.status]||S_CFG.todo).label}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button class="btn bp bsm" onclick="toggleComplete(${t.id})">Complete</button>
          <button class="btn bo bsm" onclick="viewNotes(${t.id})">Open</button>
        </div>
      </div>`
    });
  });
  });

  // 4. Recent comments on tasks I own or am assigned to
  D.tasks.filter(t => t.assignedTo === myUid || t.assignedBy === myUid || t.createdBy === myUid).forEach(t => {
    (t.comments||[]).filter(c => c.uid !== myUid).forEach(c => {
      cards.push({
        grp: 5,
        ts: c.ts || 0,
        html: `<div class="notif-card info">
          <div class="notif-card-title">Comment on: <strong>${esc(t.title)}</strong></div>
          <div class="notif-card-sub"><strong>${esc(c.name||'Someone')}</strong>: ${esc(c.text.length>80?c.text.slice(0,80)+'…':c.text)}</div>
          <div style="display:flex;gap:7px">
            <button class="btn bp bsm" onclick="viewNotes(${t.id})">View Thread</button>
          </div>
          <div class="notif-card-ts">${c.ts?new Date(c.ts).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''}</div>
        </div>`
      });
    });
  });

  if(!cards.length){
    body.innerHTML = `<div class="notif-empty"><div class="notif-empty-ic">🎉</div><div style="font-weight:700;font-size:1rem">You're all caught up!</div><div style="font-size:.82rem;color:var(--lt);margin-top:6px">Task assignments, status updates, and comments will appear here.</div></div>`;
    return;
  }
  // Most urgent group first, then newest within each group
  cards.sort((a,b) => (a.grp||0) - (b.grp||0) || b.ts - a.ts);
  const GRP = {0:'Overdue',1:'Due today',2:'Assigned to you',3:'Due soon',4:'Progress updates',5:'Comments'};
  let out = '', last = null;
  cards.forEach(c => {
    const g = c.grp||0;
    if(g !== last){
      const n = cards.filter(x => (x.grp||0) === g).length;
      out += `<div class="notif-grp">${GRP[g]||''}<span class="notif-grp-n">${n}</span></div>`;
      last = g;
    }
    out += c.html;
  });
  body.innerHTML = out;
}

function markNotifRead(taskId){
  const myUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;
  if(!myUid) return;
  const t = D.tasks.find(x => x.id === taskId);
  if(!t) return;
  (t.readBy = t.readBy||[]);
  if(!t.readBy.includes(myUid)) t.readBy.push(myUid);
  save();
  renderNotifications();
  checkDueNotifications();
}
function markAllNotifRead(){
  const myUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;
  if(!myUid) return;
  D.tasks.forEach(t => {
    if(t.assignedTo === myUid){
      (t.readBy = t.readBy||[]);
      if(!t.readBy.includes(myUid)) t.readBy.push(myUid);
    }
  });
  save(); renderNotifications(); checkDueNotifications();
  toast('All notifications marked as read', 'info');
}

/* ══════════════════════════════════════
   SELF ASSIGN
══════════════════════════════════════ */
function selfAssignTask(){
  const myUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;
  const at = document.getElementById('t-assignedto');
  if(!at) return;
  if(myUid){
    // Try to select the matching option
    const opt = [...at.options].find(o => o.value === myUid);
    if(opt){ at.value = myUid; toast('🙋 Self assigned!', 'success'); }
    else { toast('Your user not found in the list yet — loading…', 'info'); }
  } else {
    toast('No active user — log in first', 'error');
  }
}

/* ══════════════════════════════════════
   EXCEL EXPORT
══════════════════════════════════════ */
// SheetJS (~900 KB) is fetched only when someone exports, at a pinned version.
const XLSX_SRC = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
async function exportToExcel(){
  if(typeof XLSX === 'undefined'){
    try { await loadScript(XLSX_SRC); } catch(e){}
    if(typeof XLSX === 'undefined'){ toast('Excel library not loaded. Check internet connection.','error'); return; }
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──
  const today = todayStr();
  const done  = D.tasks.filter(t=>t.status==='done').length;
  const overdue = D.tasks.filter(t=>t.status!=='done'&&t.deadline&&deadlineDate(t.deadline)<today).length;
  const prog  = D.tasks.length ? Math.round((done/D.tasks.length)*100) : 0;
  const summaryData = [
    ['Miyee Task Manager Pro — Data Export'],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['Metric', 'Value'],
    ['Total Goals',    D.visions.length],
    ['Total Projects', D.projects.length],
    ['Total Tasks',    D.tasks.length],
    ['Completed Tasks',done],
    ['Overdue Tasks',  overdue],
    ['Overall Progress', prog + '%'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Summary');

  // ── Sheet 2: Goals ──
  const goalsHeader = ['ID','Goal Title','Type','Total Hours','Target Date','Start Date','End Date','Linked Projects'];
  const goalsRows   = D.visions.map(v => [
    v.id, v.title, v.type||'', v.totalHours||0, v.targetDate||'', v.startDate||'', v.endDate||'',
    D.projects.filter(p=>p.visionId==v.id).map(p=>p.title).join(', ')
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([goalsHeader,...goalsRows]), 'Goals');

  // ── Sheet 3: Projects ──
  const projHeader = ['ID','Project Title','Linked Goal','Hours Allocated','Done Hours','Progress %','Start Date','End Date','Task Count'];
  const projRows   = D.projects.map(p => {
    const v = D.visions.find(x=>x.id==p.visionId);
    const goalH = v ? (v.totalHours||0) : 0;
    const allotH = projectHours(p, D.projects, goalH);
    const doneH  = projectDoneHours(p);
    const pct    = allotH ? Math.round((doneH/allotH)*100) : 0;
    return [p.id, p.title, v?.title||'Unlinked', allotH.toFixed(1), doneH.toFixed(1), pct+'%',
            p.startDate||'', p.endDate||'', D.tasks.filter(t=>t.projectId==p.id).length];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([projHeader,...projRows]), 'Projects');

  // ── Sheet 4: Tasks ──
  const taskHeader = ['ID','Task Title','Goal','Project','Priority','Status','Start Date','Due Date','Due Time',
                      'Est Hours','Actual Hours','Progress %','Assigned To','Assigned By','Assigned At',
                      'Accepted At','Started At','Completed At','Tags','Comments Count','Notes (Plain)'];
  const taskRows = D.tasks.map(t => {
    const proj = D.projects.find(p=>p.id==t.projectId);
    const goal = proj ? D.visions.find(v=>v.id==proj.visionId) : null;
    const assignee  = t.assignedTo  ? (_wsMembers.find(m=>m.uid===t.assignedTo)||(WS.users||[]).find(u=>u.id===t.assignedTo))?.name||t.assignedTo  : '';
    const assigner  = t.assignedBy  ? (_wsMembers.find(m=>m.uid===t.assignedBy)||(WS.users||[]).find(u=>u.id===t.assignedBy))?.name||t.assignedBy  : '';
    const ddlDate   = deadlineDate(t.deadline);
    const ddlTime   = t.deadline?.includes('T') ? t.deadline.split('T')[1] : '';
    const estH = +t.estHours||0;
    const actH = +t.actualHours||0;
    const pct  = estH ? Math.min(100, Math.round((actH/estH)*100))+'%' : '';
    const notes = (t.notes||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    return [t.id, t.title, goal?.title||'', proj?.title||'', t.priority, t.status,
            t.startDate||'', ddlDate, ddlTime,
            estH, actH, pct,
            assignee, assigner,
            t.assignedAt  ? new Date(t.assignedAt).toLocaleString('en-IN')  : '',
            t.acceptedAt  ? new Date(t.acceptedAt).toLocaleString('en-IN')  : '',
            t.startedAt   ? new Date(t.startedAt).toLocaleString('en-IN')   : '',
            t.completedAt ? new Date(t.completedAt).toLocaleString('en-IN') : '',
            (t.tags||[]).join(', '), (t.comments||[]).length, notes];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([taskHeader,...taskRows]), 'Tasks');

  // ── Sheet 5: Comments ──
  const cmtHeader = ['Task ID','Task Title','Commenter','Comment Text','Timestamp'];
  const cmtRows = [];
  D.tasks.forEach(t => {
    (t.comments||[]).forEach(c => {
      cmtRows.push([t.id, t.title, c.name||'', c.text||'', c.ts?new Date(c.ts).toLocaleString('en-IN'):'']);
    });
  });
  if(cmtRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cmtHeader,...cmtRows]), 'Comments');

  const fname = `TaskManager_Export_${today}.xlsx`;
  XLSX.writeFile(wb, fname);
  toast(`📥 Exported to ${fname}`, 'success');
}

/* ══════════════════════════════════════
   SEARCH
══════════════════════════════════════ */
document.getElementById('searchInput').addEventListener('input', function(){
  searchTerm = this.value.trim();
  if(searchTerm) showPage('tasks');
  else renderTasks();
});

/* ══════════════════════════════════════
   KEYBOARD
══════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    closeTaskModal(); closeViewModal(); closeConfirm(); closeProfileModal(); closeProfileDrop();
  }
  if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
    const m = document.getElementById('task-modal');
    if(m.style.display !== 'none') saveTask();
    const pm = document.getElementById('profile-modal');
    if(pm.style.display !== 'none') saveProfile();
  }
  // Quick-add task: 'C' (when no input/modal focused)
  const isInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const anyModalOpen = ['task-modal','view-modal','profile-modal'].some(id => document.getElementById(id)?.style.display === 'flex');
  if(!isInput && !anyModalOpen){
    if(e.key === 'c' || e.key === 'C'){ e.preventDefault(); openTaskModal(); }
    if(e.key === '/'){ e.preventDefault(); document.getElementById('searchInput')?.focus(); }
  }
});

// Enter on task title saves; Enter on subtask input adds
document.getElementById('t-title').addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); saveTask(); } });
document.addEventListener('keydown', e => {
  if(e.key==='Enter' && document.activeElement?.id === 'vm-subt-input'){ e.preventDefault(); addSubtask(); }
  // Ctrl+Enter sends a comment
  if((e.ctrlKey||e.metaKey) && e.key==='Enter' && document.activeElement?.id === 'vm-cmt-input'){ e.preventDefault(); addTaskComment(); }
});

/* ══════════════════════════════════════
   ENTER KEY IN VISION / PROJECT INPUTS
══════════════════════════════════════ */
document.getElementById('vTitle').addEventListener('keydown', e => { if(e.key==='Enter') addVision(); });
document.getElementById('pTitle').addEventListener('keydown', e => { if(e.key==='Enter') addProject(); });

/* ══════════════════════════════════════
   PROFILE
══════════════════════════════════════ */
const DEFAULT_PROFILE = {
  name:'Elon', initials:'EL',
  email:'', phone:'', role:'Productivity Pro',
  org:'', loc:'', dob:'', web:'', bio:'',
  avatarGrad:'linear-gradient(135deg,#f093fb,#f5576c)',
  memberSince: new Date().getFullYear()
};
let PROF = loadProfile();

function loadProfile(){
  try { const s = localStorage.getItem('vtmp_profile'); if(s) return JSON.parse(s); } catch(e){}
  return {...DEFAULT_PROFILE};
}
function saveProfileData(){ localStorage.setItem('vtmp_profile', JSON.stringify(PROF)); }

let selectedGrad = '';

function renderProfilePage(){
  const total = D.tasks.length;
  const done  = D.tasks.filter(t=>t.status==='done').length;
  const prog  = total ? Math.round((done/total)*100) : 0;

  // Hero
  const av = document.getElementById('prof-av-big');
  if(av){ av.textContent = PROF.initials||'EX'; av.style.background = PROF.avatarGrad; }
  const nb = document.getElementById('prof-name-big');
  if(nb) nb.textContent = PROF.name || 'Your Name';
  const rb = document.getElementById('prof-role-big');
  if(rb) rb.textContent = (PROF.role||'Productivity Pro') + ' · Miyee Task Manager Pro';
  const tags = document.getElementById('prof-hero-tags');
  if(tags) tags.innerHTML = `
    <span class="prof-tag">📅 Member since ${PROF.memberSince||new Date().getFullYear()}</span>
    <span class="prof-tag">${total} Task${total!==1?'s':''}</span>
    <span class="prof-tag">${D.projects.length} Project${D.projects.length!==1?'s':''}</span>
    ${PROF.loc?`<span class="prof-tag">📍 ${esc(PROF.loc)}</span>`:''}
  `;

  // Stats
  const sv = document.getElementById('ps-total'); if(sv) sv.textContent = total;
  const sd = document.getElementById('ps-done');  if(sd) sd.textContent = done;
  const sp = document.getElementById('ps-prog');  if(sp) sp.textContent = prog+'%';

  // Fields
  const setF = (id, val) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(val){ el.textContent = val; el.classList.remove('empty'); }
    else   { el.textContent = '—'; el.classList.add('empty'); }
  };
  setF('pf-name',  PROF.name);
  setF('pf-email', PROF.email);
  setF('pf-phone', PROF.phone);
  setF('pf-dob',   PROF.dob ? new Date(PROF.dob+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : '');
  setF('pf-role',  PROF.role);
  setF('pf-org',   PROF.org);
  setF('pf-loc',   PROF.loc);
  setF('pf-web',   PROF.web ? `<a href="${esc(PROF.web)}" target="_blank" style="color:var(--p);text-decoration:none">${esc(PROF.web)}</a>` : '');
  if(PROF.web){ document.getElementById('pf-web').innerHTML = `<a href="${esc(PROF.web)}" target="_blank" style="color:var(--p);text-decoration:none;font-size:.87rem">${esc(PROF.web)}</a>`; }

  const bio = document.getElementById('pf-bio');
  if(bio){
    if(PROF.bio){ bio.textContent = PROF.bio; bio.style.fontStyle='normal'; bio.style.color='var(--text)'; }
    else        { bio.textContent = 'No bio added yet. Click "Edit Profile" to tell your story.'; bio.style.fontStyle='italic'; bio.style.color='var(--muted)'; }
  }
}

function updateHeaderProfile(){
  const hname = document.getElementById('hdr-name');
  if(hname) hname.textContent = PROF.name ? PROF.name.split(' ')[0] : 'Profile';
  const hav = document.getElementById('hdr-av');
  if(hav){ hav.textContent = PROF.initials||'EX'; hav.style.background = PROF.avatarGrad; }
  // dropdown
  const da = document.getElementById('pdrop-av');
  if(da){ da.textContent = PROF.initials||'EX'; da.style.background = PROF.avatarGrad; }
  const dn = document.getElementById('pdrop-name');
  if(dn) dn.textContent = PROF.name||'Example';
  const dr = document.getElementById('pdrop-role');
  if(dr) dr.textContent = PROF.role||'Productivity Pro';
  // dashboard greeting
  const dg = document.getElementById('dash-greeting');
  if(dg) dg.textContent = 'Welcome back, '+(PROF.name?PROF.name.split(' ')[0]:'there')+'! Here\'s your overview.';
}

function openProfileModal(){
  closeProfileDrop();
  selectedGrad = PROF.avatarGrad;
  document.getElementById('p-name').value  = PROF.name  ||'';
  document.getElementById('p-init').value  = PROF.initials||'';
  document.getElementById('p-email').value = PROF.email ||'';
  document.getElementById('p-phone').value = PROF.phone ||'';
  document.getElementById('p-role').value  = PROF.role  ||'';
  document.getElementById('p-org').value   = PROF.org   ||'';
  document.getElementById('p-loc').value   = PROF.loc   ||'';
  document.getElementById('p-dob').value   = PROF.dob   ||'';
  document.getElementById('p-web').value   = PROF.web   ||'';
  document.getElementById('p-bio').value   = PROF.bio   ||'';

  // Set avatar preview
  const prev = document.getElementById('prof-av-preview');
  prev.style.background = selectedGrad;
  prev.textContent = PROF.initials||'EX';

  // Mark selected color
  document.querySelectorAll('.av-color').forEach(c=>{
    c.classList.toggle('sel', c.dataset.grad === selectedGrad);
  });

  // Live preview on name/initials input
  document.getElementById('p-init').oninput = function(){
    document.getElementById('prof-av-preview').textContent = this.value.toUpperCase()||'?';
  };

  document.getElementById('profile-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('p-name').focus(), 60);
}
function closeProfileModal(){
  document.getElementById('profile-modal').style.display = 'none';
}
function pickColor(el){
  selectedGrad = el.dataset.grad;
  document.querySelectorAll('.av-color').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  const prev = document.getElementById('prof-av-preview');
  prev.style.background = selectedGrad;
}
function saveProfile(){
  const name = document.getElementById('p-name').value.trim();
  if(!name){ toast('Name is required.','error'); return; }
  const initials = (document.getElementById('p-init').value.trim().toUpperCase() || name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase());
  PROF = {
    name,
    initials,
    email:    document.getElementById('p-email').value.trim(),
    phone:    document.getElementById('p-phone').value.trim(),
    role:     document.getElementById('p-role').value.trim(),
    org:      document.getElementById('p-org').value.trim(),
    loc:      document.getElementById('p-loc').value.trim(),
    dob:      document.getElementById('p-dob').value,
    web:      document.getElementById('p-web').value.trim(),
    bio:      document.getElementById('p-bio').value.trim(),
    avatarGrad: selectedGrad || PROF.avatarGrad,
    memberSince: PROF.memberSince || new Date().getFullYear()
  };
  saveProfileData();
  updateHeaderProfile();
  renderProfilePage();
  closeProfileModal();
  toast('Profile saved!');
}

/* ── PROFILE DROPDOWN ── */
function toggleProfileDrop(e){
  e.stopPropagation();
  document.getElementById('prof-drop').classList.toggle('show');
}
function closeProfileDrop(){ document.getElementById('prof-drop').classList.remove('show'); }
document.addEventListener('click', e => {
  if(!document.getElementById('avbtn').contains(e.target)) closeProfileDrop();
});

/* ══════════════════════════════════════
   GOOGLE CALENDAR — ICS + DEEP LINK
══════════════════════════════════════ */
function stripHTML(h){ const d = document.createElement('div'); d.innerHTML = h||''; return (d.textContent||'').replace(/\s+/g,' ').trim(); }
function pad(n){ return String(n).padStart(2,'0'); }
function icsDateBasic(yyyymmdd){ return yyyymmdd ? yyyymmdd.replace(/-/g,'') : ''; }
function gcalDateRange(t){
  if(!t.deadline) return '';
  const start = t.deadline.replace(/-/g,'');
  const hrs   = Math.max(1, +t.estHours||1);
  const d2 = new Date(t.deadline+'T00:00:00');
  d2.setHours(d2.getHours()+hrs);
  // Use date-only format → all-day; for hour ranges use full dt format
  const startDt = `${start}T090000`;
  const endDt   = `${d2.getFullYear()}${pad(d2.getMonth()+1)}${pad(d2.getDate())}T${pad(d2.getHours())}${pad(d2.getMinutes())}00`;
  return `${startDt}/${endDt}`;
}
function gcalDeepLink(id){
  const t = D.tasks.find(x=>x.id===id);
  if(!t) return '#';
  const params = new URLSearchParams({
    action:'TEMPLATE',
    text: t.title || 'Task',
    details: stripHTML(t.notes) || '',
    dates: gcalDateRange(t) || ''
  });
  return 'https://calendar.google.com/calendar/render?'+params.toString();
}
function exportICS(){
  const dated = D.tasks.filter(t => t.deadline);
  if(!dated.length){ toast('No tasks with deadlines to export.','error'); return; }
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MiyeeTaskManager//Pro//EN','CALSCALE:GREGORIAN'];
  const dtstamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  dated.forEach(t => {
    const start = icsDateBasic(t.deadline);
    const hrs   = Math.max(1, +t.estHours||1);
    lines.push('BEGIN:VEVENT');
    lines.push('UID:'+t.id+'@vipintaskmanager');
    lines.push('DTSTAMP:'+dtstamp);
    lines.push('SUMMARY:'+(t.title||'Task').replace(/[\r\n,;]/g,' '));
    lines.push('DESCRIPTION:'+stripHTML(t.notes).replace(/[\r\n,;]/g,' '));
    lines.push('DTSTART;VALUE=DATE:'+start);
    lines.push('DURATION:PT'+hrs+'H');
    if(t.status==='done') lines.push('STATUS:COMPLETED');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], {type:'text/calendar'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'TaskMasterPro.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast(`📤 Exported ${dated.length} event${dated.length!==1?'s':''}`);
}

/* ══════════════════════════════════════
   GOOGLE CALENDAR — OAUTH SCAFFOLD
══════════════════════════════════════ */
let _gcalToken = null;
let _gcalUser  = '';
function getGCalClient(){ return localStorage.getItem('gcal_client_id')||''; }
function saveGCalClientId(){
  const v = document.getElementById('gcal-client').value.trim();
  if(!v){ toast('Paste a Client ID first.','error'); return; }
  localStorage.setItem('gcal_client_id', v);
  toast('Client ID saved.');
  refreshGCalStatus();
}
function loadScript(src){
  return new Promise((res, rej) => {
    if(document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Failed to load '+src));
    document.head.appendChild(s);
  });
}
async function gcalConnect(){
  const cid = getGCalClient();
  if(!cid){ toast('Save your OAuth Client ID first.','error'); return; }
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    if(!window.google || !google.accounts || !google.accounts.oauth2) throw new Error('Google Identity Services not available');
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: async (resp) => {
        if(resp.error){ toast('Auth failed: '+resp.error,'error'); return; }
        _gcalToken = resp.access_token;
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers:{Authorization:'Bearer '+_gcalToken} });
          const j = await r.json();
          _gcalUser = j.email || 'Connected';
        } catch(e){ _gcalUser = 'Connected'; }
        refreshGCalStatus();
        toast('Connected to Google Calendar');
      }
    });
    tokenClient.requestAccessToken({prompt:'consent'});
  } catch(e){
    console.warn(e);
    toast('Google sign-in unavailable: '+e.message,'error');
  }
}
function gcalDisconnect(){ _gcalToken = null; _gcalUser = ''; refreshGCalStatus(); toast('Disconnected','info'); }
function refreshGCalStatus(){
  const el = document.getElementById('gcal-status');
  if(!el) return;
  if(_gcalToken){ el.textContent = '🟢 Connected ('+_gcalUser+')'; el.classList.add('ok'); }
  else { el.textContent = '⚪ Not Connected'; el.classList.remove('ok'); }
  const cinp = document.getElementById('gcal-client');
  if(cinp && !cinp.value) cinp.value = getGCalClient();
}
async function gcalPushAll(){
  if(!_gcalToken){ toast('Connect Google Calendar first.','error'); return; }
  const queue = D.tasks.filter(t => t.deadline && !t.gcalEventId && t.status!=='done');
  if(!queue.length){ toast('Nothing to push — all dated tasks are already synced.','info'); return; }
  let ok = 0, fail = 0;
  for(const t of queue){
    try {
      const startDt = new Date(t.deadline+'T09:00:00');
      const endDt   = new Date(startDt); endDt.setHours(startDt.getHours()+Math.max(1,+t.estHours||1));
      const body = {
        summary: t.title,
        description: stripHTML(t.notes),
        start: { dateTime: startDt.toISOString() },
        end:   { dateTime: endDt.toISOString() }
      };
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method:'POST',
        headers:{ Authorization:'Bearer '+_gcalToken, 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      t.gcalEventId = j.id;
      ok++;
    } catch(e){ console.warn('Push failed for', t.id, e); fail++; }
  }
  save();
  toast(`Pushed ${ok}/${queue.length}${fail?` (${fail} failed)`:''}`, fail?'error':'success');
}

/* ══════════════════════════════════════
   MY DAY
══════════════════════════════════════ */
function renderMyDay(){
  const body = document.getElementById('myday-body');
  if(!body) return;
  const today = todayStr();
  const dateEl = document.getElementById('myday-date');
  if(dateEl){
    const d = new Date();
    dateEl.textContent = d.toLocaleDateString('en-IN',{weekday:'long', day:'numeric', month:'long', year:'numeric'});
  }
  const overdue  = D.tasks.filter(t => t.status !== 'done' && t.deadline && deadlineDate(t.deadline) < today)
                          .sort((a,b) => deadlineDate(a.deadline).localeCompare(deadlineDate(b.deadline)));
  const todoToday = D.tasks.filter(t => t.status !== 'done' && t.deadline && deadlineDate(t.deadline) === today);
  const inProg   = D.tasks.filter(t => t.status === 'in_progress' && deadlineDate(t.deadline) !== today && (!t.deadline || deadlineDate(t.deadline) >= today));

  document.getElementById('md-overdue-count').textContent  = overdue.length;
  document.getElementById('md-today-count').textContent    = todoToday.length;
  document.getElementById('md-progress-count').textContent = inProg.length;

  const sub = document.getElementById('myday-sub');
  if(sub){
    const total = overdue.length + todoToday.length + inProg.length;
    sub.textContent = total ? `${total} item${total!==1?'s':''} need${total===1?'s':''} attention — work top-down` : 'All clear — schedule something or take a breather.';
  }

  const buildSection = (title, badgeClass, items, emptyMsg) => {
    if(!items.length){
      return `<div class="sec"><div class="sec-h" style="cursor:default"><span class="sec-caret" style="opacity:0">▼</span><span>${title}</span><span class="sec-meta"><span style="color:var(--lt);font-style:italic">${emptyMsg}</span></span></div></div>`;
    }
    return `<div class="sec"><div class="sec-h" onclick="this.parentElement.classList.toggle('col')">
      <span class="sec-caret">▼</span><span>${title}</span>
      <span class="sec-meta"><span class="bdg ${badgeClass}">${items.length}</span></span>
    </div><div class="sec-body tlist">${items.map(t=>buildTaskCard(t)).join('')}</div></div>`;
  };

  body.innerHTML =
    buildSection('Overdue', 'bh', overdue,    'Nothing overdue — well done!') +
    buildSection('Due today',                  'bm', todoToday,  'Nothing scheduled for today.') +
    buildSection('In progress',                'bip', inProg,    'Nothing in motion right now.');
}

/* ══════════════════════════════════════
   DARK MODE
══════════════════════════════════════ */
function setThemeIcon(dark){
  const u = document.querySelector('#dm-btn use');
  if(u) u.setAttribute('href', dark ? '#i-sun' : '#i-moon');
}
function toggleDarkMode(){
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('tm_theme', isDark ? 'light' : 'dark');
  setThemeIcon(!isDark);
}
function initTheme(){
  const t = localStorage.getItem('tm_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  setThemeIcon(t==='dark');
}

/* ══════════════════════════════════════
   TAGS
══════════════════════════════════════ */
let _editTags = [];
function renderTagWrap(tags){
  _editTags = [...tags];
  const wrap = document.getElementById('tag-wrap');
  if(!wrap) return;
  const inp = document.getElementById('tag-input');
  wrap.innerHTML = '';
  _editTags.forEach((tg,i) => {
    const s = document.createElement('span');
    s.className = 'tag';
    s.innerHTML = `#${esc(tg)} <button class="tag-rm" onclick="_editTags.splice(${i},1);renderTagWrap(_editTags)">×</button>`;
    wrap.appendChild(s);
  });
  wrap.appendChild(inp);
  inp.value = '';
}
function handleTagInput(e){
  if(e.key === 'Enter' || e.key === ','){
    e.preventDefault();
    const v = e.target.value.trim().replace(/^#/,'').replace(/,/g,'');
    if(v && !_editTags.includes(v)){ _editTags.push(v); renderTagWrap(_editTags); }
    else e.target.value = '';
  }
}

/* ══════════════════════════════════════
   BROWSER NOTIFICATIONS
══════════════════════════════════════ */
function initNotifications(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default') Notification.requestPermission();
  setInterval(checkDueNotifications, 60000);
  checkDueNotifications();
}
function checkDueNotifications(){
  const today = todayStr();
  const myUid = _fbUser?.uid || null;
  // Overdue + assigned-to-me for badge
  const overdue  = D.tasks.filter(t => t.status!=='done' && t.deadline && deadlineDate(t.deadline) < today);
  const assigned = myUid ? D.tasks.filter(t => t.assignedTo === myUid && t.status !== 'done' && t.status !== 'accepted') : [];
  const dot = document.getElementById('notif-dot');
  const badge = document.getElementById('notif-count-badge');
  const total = overdue.length + assigned.length;
  if(dot) dot.classList.toggle('show', total > 0);
  if(badge){ badge.textContent = total > 99 ? '99+' : total; badge.style.display = total > 0 ? '' : 'none'; }
}
// Navigate to full Notifications page
function showNotifications(){ showPage('notifications'); }

/* ══════════════════════════════════════
   LIVE TIMER
══════════════════════════════════════ */
let _timerInterval = null;
function fmtElapsed(ms){
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function toggleTimer(id){
  const t = D.tasks.find(x => x.id === id);
  if(!t) return;
  if(t.timerStart){
    const elapsed = (Date.now() - t.timerStart) / 3600000;
    t.actualHours = Math.round(((+t.actualHours||0) + elapsed) * 100) / 100;
    t.timerStart  = null;
    toast(`⏱ Timer stopped — ${fmtElapsed(elapsed*3600000)} logged`);
  } else {
    t.timerStart = Date.now();
    toast('⏱ Timer started');
  }
  save(); renderTasks();
  clearInterval(_timerInterval);
  if(D.tasks.some(x => x.timerStart)){
    _timerInterval = setInterval(renderTasks, 30000);
  }
}

/* ══════════════════════════════════════
   RECURRING TASKS
══════════════════════════════════════ */
function spawnRecurring(t){
  if(!t.deadline) return;
  // Deadlines come from a datetime-local input ("YYYY-MM-DDTHH:mm"); appending
  // another "T00:00:00" produced an Invalid Date and toISOString() threw.
  const [datePart, timePart] = t.deadline.split('T');
  const d = new Date(datePart + 'T00:00:00');
  if(isNaN(d)) return;
  if(t.recurrence==='daily')   d.setDate(d.getDate()+1);
  if(t.recurrence==='weekly')  d.setDate(d.getDate()+7);
  if(t.recurrence==='monthly') d.setMonth(d.getMonth()+1);
  const nextDdl = localDateStr(d) + (timePart ? 'T' + timePart : '');
  D.tasks.push({...t, id:newId(), status:'todo', completedAt:null, deadline:nextDdl,
    timerStart:null, timerTotal:0, subtasks:[], gcalEventId:null,
    comments:[], readBy:[], acceptedAt:null, startedAt:null});
  save();
  toast(`🔁 Recurring task created for ${fmtDate(nextDdl)}`);
}

/* ══════════════════════════════════════
   FIREBASE — AUTH + FIRESTORE SYNC
══════════════════════════════════════ */
/* ── Firebase SDK handles (populated by fbInit) ── */
let _fbApp  = null;   // FirebaseApp instance
let _fbAuth = null;   // firebase.auth() handle
let _fbFS   = null;   // firebase.firestore() handle
let _fbUser = null;   // Currently authenticated firebase.User (null = signed out)

/* ── Auth / Sync state ── */
let _fbAuthMode = 'signin'; // legacy field — gate uses _gateMode; kept for fbDoAuth stub compat
let _fbSyncTimer = null;    // debounce timer for fbSyncNow

/* ── Workspace runtime cache (loaded from Firestore on login) ── */
let _wsMembers   = [];   // {uid, name, email, position, isAdmin, initials, avatarColor}
let _wsPositions = [];   // {id, name} — admin-created positions for this workspace
let _wsInvites   = [];   // {code, wsName, createdAt, active, usedBy:[]} — admin-only view
let _fbProfile   = null; // current user's Firestore profile doc data (users/{uid}/profile/main)
let _pendingInviteData = null; // invite doc data held during step-2b of profile wizard

// Called from save() — no-op if Firebase not active
function fbScheduleSync(){
  if(!_fbFS || !_fbUser || !_fbReady) return;
  clearTimeout(_fbSyncTimer);
  fbSetBadge('saving');
  _fbSyncTimer = setTimeout(fbSyncNow, 800);
}

function fbHasConfig(){
  return true; // config is hardcoded in FB_CONFIG — always available
}

/* ── Boot sequence (called once from window 'load' handler)
   ┌─ fbInit()
   │   └─ firebase.initializeApp(FB_CONFIG)
   │   └─ _fbAuth.onAuthStateChanged → fbHandleAuthChange(user)
   │       ├─ user == null  → show #login-gate (full-screen blocker)
   │       └─ user != null  → hide #login-gate → fbCheckProfile(user)
   │           ├─ profile exists  → fbLoadWorkspace() → renderAll()
   │           └─ profile missing → show #profile-wizard (step 1)
── */
function gateShowConnError(msg){
  // Surface a connection problem on the login gate with a Retry action so the
  // user is never left staring at a sign-in form whose button does nothing.
  bootSplash(false);
  const gate = document.getElementById('login-gate');
  if(gate) gate.style.display = 'flex';
  const err = document.getElementById('gate-err');
  if(err){
    err.innerHTML = esc(msg) +
      ' <button onclick="location.reload()" style="background:none;border:none;color:var(--p);font-weight:700;cursor:pointer;text-decoration:underline;font-size:.78rem">Retry</button>';
    err.style.display = '';
  }
  const btn = document.getElementById('gate-btn');
  if(btn){ btn.disabled = false; }
}

/** Show/hide the start-up splash. With a message, also offer Retry / Sign out. */
function bootSplash(show, msg){
  const el = document.getElementById('boot-splash');
  if(!el) return;
  el.style.display = show ? 'flex' : 'none';
  document.getElementById('boot-msg').textContent = msg || 'Loading your workspace…';
  document.getElementById('boot-actions').style.display = msg ? 'flex' : 'none';
}

function fbInit(){
  // Wait for SDK to be available (loaded asynchronously)
  let attempts = 0;
  const tryInit = () => {
    if(!window.firebase){
      if(++attempts < 40) return setTimeout(tryInit, 250); // ~10s grace for slow networks
      console.warn('Firebase SDK did not load.');
      gateShowConnError(
        navigator.onLine
          ? '⚠️ Couldn’t reach the sign-in service. A firewall, ad-blocker or slow connection may be blocking it.'
          : '📡 You appear to be offline. Reconnect to sign in.'
      );
      return;
    }
    try {
      if(!firebase.apps.length){
        _fbApp = firebase.initializeApp(FB_CONFIG);
      } else {
        _fbApp = firebase.apps[0];
      }
      _fbAuth = firebase.auth();
      _fbFS   = firebase.firestore();
      // Keep the session across reloads and browser restarts (explicit, so a
      // changed SDK default can never turn a refresh into a sign-out).
      _fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => console.warn('setPersistence:', e));
      // Offline cache: reads work without a connection and writes queue up.
      try { _fbFS.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('Firestore offline cache unavailable:', e.code || e)); }
      catch(e){ console.warn('enablePersistence:', e); }
      _fbAuth.onAuthStateChanged(fbHandleAuthChange);
    } catch(e){
      console.warn('Firebase init failed:', e);
      gateShowConnError('⚠️ Sign-in service failed to start: ' + (e.message||'unknown error') + '.');
    }
  };
  tryInit();
  // Re-attempt automatically when connectivity is restored.
  window.addEventListener('online', () => { if(!_fbAuth){ attempts = 0; tryInit(); } });
}

function fbHandleAuthChange(user){
  _fbUser = user;
  if(user){
    // ── Email whitelist check ─────────────────────────────────────────────
    if(FB_ALLOWED_EMAILS.length > 0 &&
       !FB_ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase())){
      firebase.auth().signOut();
      _fbUser = null;
      const err = document.getElementById('gate-err');
      if(err){ err.textContent = '⛔ Access denied — ' + user.email + ' is not authorised.'; err.style.display = ''; }
      bootSplash(false);
      document.getElementById('login-gate').style.display = 'flex';
      toast('⛔ Access denied: ' + user.email, 'error');
      return;
    }
    // ── Hide login gate; keep the splash up until the workspace is loaded ──
    document.getElementById('login-gate').style.display = 'none';
    bootSplash(true);
    // ── Check if profile exists in Firestore ─────────────────────────────
    fbCheckProfile(user);
    // ── Show synced badge ─────────────────────────────────────────────────
    if(!document.getElementById('fb-sync-badge')){
      const b = document.createElement('div');
      b.id = 'fb-sync-badge';
      b.title = 'Signed in as ' + user.email;
      b.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:99px;background:rgba(16,185,129,.15);color:#065f46;font-size:.7rem;font-weight:700;border:1px solid rgba(16,185,129,.3)';
      b.innerHTML = '☁️ Synced';
      const hdrR = document.querySelector('.hdr-r');
      if(hdrR) hdrR.prepend(b);
    }
    fbAddSignOutBtn();
  } else {
    // ── Not logged in — show full-screen login gate ───────────────────────
    _fbReady = false; _fbSynced = new Map();
    fbStopLive();
    clearTimeout(_fbSyncTimer);
    bootSplash(false);
    document.getElementById('login-gate').style.display = 'flex';
    document.getElementById('profile-wizard').style.display = 'none';
    document.getElementById('fb-sync-badge')?.remove();
    document.getElementById('fb-signout-btn')?.remove();
    _wsMembers = []; _wsPositions = []; _wsInvites = []; _fbProfile = null;
  }
}

function fbAddSignOutBtn(){
  if(document.getElementById('fb-signout-btn')) return;
  const sep = document.querySelector('.prof-drop-sep');
  if(!sep) return;
  const btn = document.createElement('button');
  btn.id = 'fb-signout-btn';
  btn.className = 'prof-drop-item';
  btn.innerHTML = '🔓 Sign Out';
  btn.onclick = () => { closeProfileDrop(); fbSignOut(); };
  sep.parentNode.insertBefore(btn, sep);
}

/** Sign out after flushing pending changes, then clear this account's task data
    from the device so the next person to sign in here never sees or uploads it. */
async function fbSignOut(){
  const doSignOut = async () => {
    _fbReady = false;
    fbStopLive();
    clearTimeout(_fbSyncTimer);
    const base = _fbUser ? fbGetBase() : null;
    if(base) localStorage.removeItem(fbSyncedKey(base));
    [SK, SK_OLD, SK_OWNER, WS_KEY, WS_CUR_KEY, WS_MODE_KEY].forEach(k => localStorage.removeItem(k));
    D = JSON.parse(JSON.stringify(SEED));
    WS = { orgName:'', users:[] }; WS_MODE = null; WS_CUR_USER = null; _fbSynced = new Map();
    try { renderAll(); } catch(e){}
    if(_fbAuth) await _fbAuth.signOut();
    else location.reload();
  };
  if(_fbReady){
    try { await fbSyncNow(); } catch(e){}
    if(fbPendingOps().size){
      confirmAction('Some changes have not reached the cloud yet (you may be offline). Sign out anyway and discard them?', doSignOut);
      return;
    }
  }
  doSignOut();
}

/* ══════════════════════════════════════
   PROFILE CHECK & WIZARD
══════════════════════════════════════ */
async function fbCheckProfile(user){
  if(!_fbFS || !user) return;
  try {
    const profileDoc = await _fbFS.doc('users/' + user.uid + '/profile/main').get();
    if(profileDoc.exists){
      _fbProfile = profileDoc.data();
      // Returning user — load their workspace data
      await fbLoadWorkspace(_fbProfile);
      bootSplash(false);
    } else {
      // New user — show profile wizard
      bootSplash(false);
      document.getElementById('profile-wizard').style.display = 'flex';
    }
  } catch(e){
    console.warn('Profile check failed:', e);
    // A network/permission error is NOT "no profile". Showing the set-up
    // wizard here made returning users look signed out and let them overwrite
    // their profile, so offer a retry instead.
    bootSplash(true, navigator.onLine
      ? '⚠️ Couldn’t load your profile (' + (e.code || e.message || 'error') + ').'
      : '📡 You appear to be offline. Reconnect and retry.');
  }
}

async function fbLoadWorkspace(profile){
  if(!profile) return;
  if(profile.wsMode === 'company' && profile.wsId){
    WS_MODE = 'company';
    WS.orgName = profile.wsName || '';
    WS.wsId    = profile.wsId;
    localStorage.setItem(WS_MODE_KEY, WS_MODE);
    saveWorkspace();
    await Promise.all([fbLoadMembers(), fbLoadPositions()]);
    // Find own member doc
    const me = _wsMembers.find(m => m.uid === _fbUser.uid);
    if(me) WS_CUR_USER = me;
  } else {
    WS_MODE = 'personal';
    localStorage.setItem(WS_MODE_KEY, WS_MODE);
  }
  await fbLoadData();
  renderAll();
  updateWorkspaceUI();
  updateHeaderProfile();
}

/* ── Workspace sub-collection loaders ──────────────────────────────────────
   All three require _fbFS, _fbUser and WS.wsId to be set.
   fbRefreshAdminData() calls them together when the Admin page opens.
── */
async function fbLoadMembers(){
  if(!_fbFS || !_fbUser || !WS.wsId) return;
  try {
    const snap = await _fbFS.collection('workspaces/' + WS.wsId + '/members').get();
    _wsMembers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch(e){ console.warn('Load members failed:', e); }
}

async function fbLoadPositions(){
  if(!_fbFS || !_fbUser || !WS.wsId) return;
  try {
    const snap = await _fbFS.collection('workspaces/' + WS.wsId + '/positions').get();
    _wsPositions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e){ console.warn('Load positions failed:', e); }
}

async function fbLoadInvites(){
  if(!_fbFS || !_fbUser || !WS.wsId) return;
  const me = _wsMembers.find(m => m.uid === _fbUser.uid);
  if(!me || !me.isAdmin) return;
  try {
    const snap = await _fbFS.collection('invites')
      .where('wsId','==',WS.wsId).get();
    _wsInvites = snap.docs.map(d => ({ code: d.id, ...d.data() }));
  } catch(e){ console.warn('Load invites failed:', e); }
}

/* ══════════════════════════════════════
   PROFILE WIZARD LOGIC
══════════════════════════════════════ */
let _pwMode = null; // 'personal' | 'create' | 'join'

function pwSelectMode(mode){
  _pwMode = mode;
  // Highlight selected card
  ['personal','create','join'].forEach(m => {
    const card = document.getElementById('pw-mc-'+m);
    if(card) card.classList.toggle('selected', m === mode);
  });
  // Auto-advance
  document.getElementById('pw-s1').style.display = 'none';
  document.getElementById('pw-s2-create').style.display = mode === 'create' ? '' : 'none';
  document.getElementById('pw-s2-join').style.display   = mode === 'join'   ? '' : 'none';
  if(mode === 'personal') pwFinishPersonal();
}

function pwBack(){
  _pwMode = null;
  _pendingInviteData = null;
  document.getElementById('pw-s1').style.display = '';
  document.getElementById('pw-s2-create').style.display = 'none';
  document.getElementById('pw-s2-join').style.display   = 'none';
  document.getElementById('pw-invite-info').style.display  = 'none';
  document.getElementById('pw-pos-wrap').style.display     = 'none';
  document.getElementById('pw-join-btn').style.display     = 'none';
  ['personal','create','join'].forEach(m => {
    const card = document.getElementById('pw-mc-'+m);
    if(card) card.classList.remove('selected');
  });
}

async function pwFinishPersonal(){
  const name = document.getElementById('pw-name').value.trim();
  if(!name){
    document.getElementById('pw-s1').style.display = '';
    document.getElementById('pw-s2-create').style.display = 'none';
    document.getElementById('pw-s2-join').style.display   = 'none';
    const err = document.getElementById('pw-s1-err');
    err.textContent = 'Please enter your name first.'; err.style.display = '';
    return;
  }
  const profile = {
    uid: _fbUser.uid, name,
    initials: name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'ME',
    email: _fbUser.email, wsMode: 'personal', createdAt: Date.now()
  };
  await _fbFS.doc('users/' + _fbUser.uid + '/profile/main').set(profile);
  _fbProfile = profile;
  WS_MODE = 'personal';
  localStorage.setItem(WS_MODE_KEY, WS_MODE);
  saveWorkspace();
  document.getElementById('profile-wizard').style.display = 'none';
  let p = JSON.parse(localStorage.getItem('tm_profile')||'{}');
  p.name = name; p.initials = profile.initials; p.email = _fbUser.email;
  localStorage.setItem('tm_profile', JSON.stringify(p));
  await fbLoadData();   // links this device's data to the account and starts syncing
  renderAll(); updateWorkspaceUI(); updateHeaderProfile(); renderProfilePage();
  toast('🚀 Welcome, ' + name + '!', 'success');
}

async function pwCreateCompany(){
  const name = document.getElementById('pw-name').value.trim();
  const org  = document.getElementById('pw-org').value.trim();
  const pos  = document.getElementById('pw-pos-create').value.trim();
  const errEl= document.getElementById('pw-s2c-err');
  if(!name){ errEl.textContent='Go back and enter your name first'; errEl.style.display=''; return; }
  if(!org){  errEl.textContent='Organization name is required'; errEl.style.display=''; return; }
  if(!pos){  errEl.textContent='Your position is required'; errEl.style.display=''; return; }
  errEl.style.display = 'none';
  const wsId = org.replace(/[^a-z0-9]/gi,'_').toLowerCase() + '_' + _fbUser.uid.slice(0,8);
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'AD';
  const adminMember = {
    uid: _fbUser.uid, name, email: _fbUser.email,
    position: pos, isAdmin: true, initials,
    avatarColor: 'linear-gradient(135deg,#5B6EF5,#7C3AED)',
    joinedAt: Date.now()
  };
  const profile = {
    uid: _fbUser.uid, name, initials, email: _fbUser.email,
    wsMode: 'company', wsId, wsName: org, position: pos, isAdmin: true, createdAt: Date.now()
  };
  try {
    // ── Step 1: Create workspace root + admin member + profile (atomic batch) ──
    // The position is NOT included here because Firestore evaluates rules against
    // the PRE-COMMIT state.  At rule-evaluation time the member doc doesn't exist
    // yet, so isWorkspaceAdmin() would return false and the position write would
    // be rejected.  We write the position in Step 2 after the member doc exists.
    const batch = _fbFS.batch();
    batch.set(_fbFS.doc('workspaces/' + wsId), { orgName: org, createdBy: _fbUser.uid, wsId, createdAt: Date.now() });
    batch.set(_fbFS.doc('workspaces/' + wsId + '/members/' + _fbUser.uid), adminMember);
    batch.set(_fbFS.doc('users/' + _fbUser.uid + '/profile/main'), profile);
    await batch.commit();

    // ── Step 2: Seed initial position — member doc is now committed ──────────
    // isWorkspaceAdmin() now resolves correctly in Firestore rules.
    const posId = 'pos_' + Date.now();
    await _fbFS.doc('workspaces/' + wsId + '/positions/' + posId)
      .set({ name: pos, createdBy: _fbUser.uid, createdAt: Date.now() });

    _fbProfile = profile;
    _wsMembers = [adminMember];
    _wsPositions = [{ id: posId, name: pos }];
    WS_MODE = 'company'; WS = { orgName: org, wsId, users: [] };
    WS_CUR_USER = { ...adminMember, id: _fbUser.uid };
    localStorage.setItem(WS_MODE_KEY, WS_MODE);
    saveWorkspace(); saveCurrentUser();
    let p = JSON.parse(localStorage.getItem('tm_profile')||'{}');
    p.name = name; p.initials = initials; p.email = _fbUser.email; p.org = org;
    localStorage.setItem('tm_profile', JSON.stringify(p));
    document.getElementById('profile-wizard').style.display = 'none';
    await fbLoadData();
    renderAll(); updateWorkspaceUI(); updateHeaderProfile(); renderProfilePage();
    toast('🏢 Workspace "' + org + '" created! You\'re the Admin.', 'success');
  } catch(e){
    errEl.textContent = 'Error creating workspace: ' + e.message; errEl.style.display = '';
  }
}

async function pwValidateInvite(){
  const code = document.getElementById('pw-invite-code').value.trim().toUpperCase();
  const errEl = document.getElementById('pw-s2j-err');
  errEl.style.display = 'none';
  document.getElementById('pw-invite-info').style.display = 'none';
  document.getElementById('pw-pos-wrap').style.display = 'none';
  document.getElementById('pw-join-btn').style.display = 'none';
  if(!code){ errEl.textContent = 'Please enter an invite code'; errEl.style.display = ''; return; }
  try {
    const doc = await _fbFS.doc('invites/' + code).get();
    if(!doc.exists){
      errEl.textContent = '❌ Invalid invite code — please check with your admin'; errEl.style.display = ''; return;
    }
    const invData = doc.data();
    if(!invData.active){
      // Distinguish "already used" from "manually revoked" for a clearer message
      if((invData.usedBy||[]).length > 0){
        errEl.textContent = '❌ This invite code has already been used and is no longer valid';
      } else {
        errEl.textContent = '❌ This invite code has been revoked — please ask your admin for a new one';
      }
      errEl.style.display = ''; return;
    }
    const inv = invData; // already fetched above — reuse, no second .data() call
    _pendingInviteData = { code, ...inv };
    document.getElementById('pw-invite-info').style.display = '';
    document.getElementById('pw-invite-company').textContent = inv.wsName;
    // Load positions for this workspace
    const posSnap = await _fbFS.collection('workspaces/' + inv.wsId + '/positions').get();
    const positions = posSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const sel = document.getElementById('pw-pos-join');
    if(positions.length){
      sel.innerHTML = positions.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
      document.getElementById('pw-pos-wrap').style.display = '';
    } else {
      sel.innerHTML = '<option value="">— No positions defined —</option>';
      document.getElementById('pw-pos-wrap').style.display = '';
    }
    document.getElementById('pw-join-btn').style.display = '';
    toast('✅ Invite valid for ' + inv.wsName, 'success');
  } catch(e){
    errEl.textContent = 'Validation error: ' + e.message; errEl.style.display = '';
  }
}

async function pwJoinCompany(){
  if(!_pendingInviteData){ toast('Please validate an invite code first','error'); return; }
  const name  = document.getElementById('pw-name').value.trim();
  const pos   = document.getElementById('pw-pos-join').value;
  const errEl = document.getElementById('pw-s2j-err');
  if(!name){ errEl.textContent = 'Go back and enter your name first'; errEl.style.display = ''; return; }
  if(!pos){  errEl.textContent = 'Please select a position'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  const { wsId, wsName, code } = _pendingInviteData;
  const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'ME';
  const colors = ['linear-gradient(135deg,#10B981,#06B6D4)','linear-gradient(135deg,#F59E0B,#F97316)',
    'linear-gradient(135deg,#8B5CF6,#EC4899)','linear-gradient(135deg,#EF4444,#F97316)'];
  const memberData = {
    uid: _fbUser.uid, name, email: _fbUser.email,
    position: pos, isAdmin: false, initials,
    avatarColor: colors[Math.floor(Math.random()*colors.length)],
    joinedAt: Date.now(),
    inviteCode: code   // lets the Firestore rules verify the join was invited
  };
  const profile = {
    uid: _fbUser.uid, name, initials, email: _fbUser.email,
    wsMode: 'company', wsId, wsName, position: pos, isAdmin: false, createdAt: Date.now()
  };
  try {
    const batch = _fbFS.batch();
    batch.set(_fbFS.doc('workspaces/' + wsId + '/members/' + _fbUser.uid), memberData);
    batch.set(_fbFS.doc('users/' + _fbUser.uid + '/profile/main'), profile);
    // Mark invite as used — single-use: deactivate immediately so no one else can reuse it
    batch.update(_fbFS.doc('invites/' + code), {
      usedBy:  firebase.firestore.FieldValue.arrayUnion(_fbUser.uid),
      active:  false,
      usedAt:  Date.now(),
      usedByName: name   // human-readable label for admin UI
    });
    await batch.commit();
    _fbProfile = profile;
    WS_MODE = 'company'; WS = { orgName: wsName, wsId, users: [] };
    WS_CUR_USER = { ...memberData, id: _fbUser.uid };
    localStorage.setItem(WS_MODE_KEY, WS_MODE);
    saveWorkspace(); saveCurrentUser();
    let p = JSON.parse(localStorage.getItem('tm_profile')||'{}');
    p.name = name; p.initials = initials; p.email = _fbUser.email; p.org = wsName;
    localStorage.setItem('tm_profile', JSON.stringify(p));
    document.getElementById('profile-wizard').style.display = 'none';
    _pendingInviteData = null;
    await Promise.all([fbLoadMembers(), fbLoadPositions(), fbLoadData()]);
    renderAll(); updateWorkspaceUI(); updateHeaderProfile(); renderProfilePage();
    toast('🎉 You joined ' + wsName + ' as ' + pos + '!', 'success');
  } catch(e){
    errEl.textContent = 'Error joining workspace: ' + e.message; errEl.style.display = '';
  }
}

/* ══════════════════════════════════════
   LOGIN GATE AUTH
══════════════════════════════════════ */
let _gateMode = 'signin';
async function gateDoAuth(){
  const email = document.getElementById('gate-email').value.trim();
  const pass  = document.getElementById('gate-pass').value;
  const errEl = document.getElementById('gate-err');
  const btn   = document.getElementById('gate-btn');
  errEl.style.display = 'none';
  if(!_fbAuth){
    gateShowConnError(navigator.onLine
      ? '⚠️ Still connecting to the sign-in service. Please wait a moment or'
      : '📡 You appear to be offline. Reconnect, then');
    return;
  }
  if(!email || !pass){ errEl.textContent='Email and password are required'; errEl.style.display=''; return; }
  btn.textContent = '⏳ Please wait…'; btn.disabled = true;
  try {
    if(_gateMode === 'signin'){
      await _fbAuth.signInWithEmailAndPassword(email, pass);
    } else {
      await _fbAuth.createUserWithEmailAndPassword(email, pass);
    }
    document.getElementById('gate-pass').value = '';
  } catch(e){
    errEl.textContent = fbAuthErrMsg(e.code);
    errEl.style.display = '';
    btn.textContent = _gateMode === 'signin' ? 'Sign In →' : 'Create Account →';
    btn.disabled = false;
  }
}
function gateToggleMode(){
  _gateMode = _gateMode === 'signin' ? 'signup' : 'signin';
  const isSignin = _gateMode === 'signin';
  document.getElementById('gate-title').textContent   = isSignin ? 'Sign In' : 'Create Account';
  document.getElementById('gate-btn').textContent     = isSignin ? 'Sign In →' : 'Create Account →';
  document.getElementById('gate-btn').disabled        = false;
  document.getElementById('gate-mode-msg').textContent= isSignin ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('gate-toggle').textContent  = isSignin ? 'Sign Up' : 'Sign In';
  document.getElementById('gate-err').style.display   = 'none';
}
async function gateForgotPassword(){
  const email = document.getElementById('gate-email').value.trim();
  if(!email){ const e=document.getElementById('gate-err'); e.textContent='Enter your email first'; e.style.display=''; return; }
  try {
    await _fbAuth.sendPasswordResetEmail(email);
    toast('📧 Password reset email sent to ' + email, 'success');
  } catch(e){
    const errEl = document.getElementById('gate-err');
    errEl.textContent = fbAuthErrMsg(e.code); errEl.style.display = '';
  }
}

/* ══════════════════════════════════════
   ADMIN: POSITIONS MANAGER
══════════════════════════════════════ */
async function adminAddPosition(){
  const input = document.getElementById('new-pos-input');
  const name = (input.value||'').trim();
  if(!name) return;
  if(!WS.wsId){ toast('No company workspace active','error'); return; }
  const posId = 'pos_' + Date.now();
  try {
    await _fbFS.doc('workspaces/' + WS.wsId + '/positions/' + posId)
      .set({ name, createdBy: _fbUser.uid, createdAt: Date.now() });
    _wsPositions.push({ id: posId, name });
    input.value = '';
    renderAdminPositions();
    toast('✅ Position "' + name + '" added', 'success');
  } catch(e){ toast('Error: ' + e.message, 'error'); }
}

async function adminDeletePosition(posId){
  if(!WS.wsId) return;
  confirmAction('Delete this position?', async () => {
    try {
      await _fbFS.doc('workspaces/' + WS.wsId + '/positions/' + posId).delete();
      _wsPositions = _wsPositions.filter(p => p.id !== posId);
      renderAdminPositions();
      toast('Position deleted', 'info');
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });
}

function renderAdminPositions(){
  const list  = document.getElementById('positions-list');
  const badge = document.getElementById('pos-count-badge');
  const wrap  = document.getElementById('add-pos-wrap');
  const isAdmin = _wsMembers.find(m=>m.uid===(_fbUser&&_fbUser.uid))?.isAdmin || false;
  if(badge) badge.textContent = _wsPositions.length + ' total';
  if(wrap) wrap.style.display = isAdmin ? 'flex' : 'none';
  if(!list) return;
  if(!_wsPositions.length){
    list.innerHTML = `<div style="color:var(--muted);font-size:.8rem;padding:10px 0">No positions yet. ${isAdmin?'Add one below.':''}</div>`;
    return;
  }
  list.innerHTML = _wsPositions.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surf2);border-radius:var(--r);border:1px solid var(--bd);margin-bottom:6px">
      <span style="font-size:.84rem;font-weight:600">📋 ${esc(p.name)}</span>
      ${isAdmin ? `<button class="bic bic-red" onclick="adminDeletePosition('${p.id}')" title="Delete position"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>` : ''}
    </div>`).join('');
}

/* ══════════════════════════════════════
   ADMIN: INVITE CODES
══════════════════════════════════════ */
async function adminGenerateInvite(){
  if(!WS.wsId){ toast('No company workspace active','error'); return; }
  // Cryptographically random, 8 chars from an unambiguous alphabet (no 0/O/1/I).
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ABC[b % ABC.length]).join('');
  const invite = { wsId: WS.wsId, wsName: WS.orgName, createdBy: _fbUser.uid, createdAt: Date.now(), active: true, usedBy: [] };
  try {
    await _fbFS.doc('invites/' + code).set(invite);
    _wsInvites.push({ code, ...invite });
    renderAdminInvites();
    toast('🔗 Invite code created: ' + code, 'success');
  } catch(e){ toast('Error: ' + e.message, 'error'); }
}

async function adminDeleteInvite(code){
  confirmAction('Deactivate invite code ' + code + '?', async () => {
    try {
      await _fbFS.doc('invites/' + code).update({ active: false });
      _wsInvites = _wsInvites.filter(i => i.code !== code);
      renderAdminInvites();
      toast('Invite code deactivated', 'info');
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });
}

function copyInviteCode(code){
  navigator.clipboard.writeText(code).then(()=>toast('📋 Code copied: ' + code, 'success')).catch(()=>{
    prompt('Copy this invite code:', code);
  });
}

function renderAdminInvites(){
  const list = document.getElementById('invites-list');
  if(!list) return;
  if(!_wsInvites.length){
    list.innerHTML = `<div style="color:var(--muted);font-size:.8rem;padding:6px 0">No invite codes yet. Click "Generate" to create one.</div>`;
    return;
  }

  // Sort: active first, then used (most-recently-used first), then revoked
  const sorted = [..._wsInvites].sort((a,b) => {
    const rankA = a.active ? 0 : (a.usedBy||[]).length ? 1 : 2;
    const rankB = b.active ? 0 : (b.usedBy||[]).length ? 1 : 2;
    if(rankA !== rankB) return rankA - rankB;
    return (b.usedAt||b.createdAt||0) - (a.usedAt||a.createdAt||0);
  });

  list.innerHTML = sorted.map(i => {
    const isUsed    = !i.active && (i.usedBy||[]).length > 0;
    const isRevoked = !i.active && (i.usedBy||[]).length === 0;

    if(i.active){
      // ── Active: can still be used ──
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(91,110,245,.06);border:1px solid rgba(91,110,245,.2);border-radius:var(--r);margin-bottom:7px;flex-wrap:wrap;gap:8px">
          <div>
            <span style="font-family:monospace;font-size:1.1rem;font-weight:800;letter-spacing:.12em;color:var(--p)">${esc(i.code)}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;font-size:.69rem;font-weight:700;background:rgba(16,185,129,.12);color:#059669;border:1px solid rgba(16,185,129,.3);border-radius:99px;padding:1px 7px;margin-left:7px">🟢 Active</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn bo bsm" onclick="copyInviteCode('${i.code}')">📋 Copy</button>
            <button class="bic bic-red" onclick="adminDeleteInvite('${i.code}')" title="Revoke"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>
          </div>
        </div>`;
    } else if(isUsed){
      // ── Used: single-use consumed ──
      const usedByLabel = i.usedByName ? esc(i.usedByName) : (i.usedBy||[]).length + ' member';
      const usedDate    = i.usedAt ? new Date(i.usedAt).toLocaleDateString() : '';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(16,185,129,.04);border:1px solid rgba(16,185,129,.2);border-radius:var(--r);margin-bottom:7px;flex-wrap:wrap;gap:8px;opacity:.85">
          <div>
            <span style="font-family:monospace;font-size:1.1rem;font-weight:800;letter-spacing:.12em;color:var(--muted);text-decoration:line-through">${esc(i.code)}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;font-size:.69rem;font-weight:700;background:rgba(16,185,129,.12);color:#059669;border:1px solid rgba(16,185,129,.25);border-radius:99px;padding:1px 7px;margin-left:7px">✅ Used</span>
            <span style="font-size:.71rem;color:var(--muted);margin-left:5px">by ${usedByLabel}${usedDate ? ' · ' + usedDate : ''}</span>
          </div>
        </div>`;
    } else {
      // ── Revoked: manually deactivated by admin ──
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(239,68,68,.03);border:1px solid rgba(239,68,68,.15);border-radius:var(--r);margin-bottom:7px;flex-wrap:wrap;gap:8px;opacity:.7">
          <div>
            <span style="font-family:monospace;font-size:1.1rem;font-weight:800;letter-spacing:.12em;color:var(--muted);text-decoration:line-through">${esc(i.code)}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;font-size:.69rem;font-weight:700;background:rgba(239,68,68,.1);color:var(--err);border:1px solid rgba(239,68,68,.25);border-radius:99px;padding:1px 7px;margin-left:7px">🚫 Revoked</span>
          </div>
        </div>`;
    }
  }).join('');
}

/* ══════════════════════════════════════
   TASK: ACCEPT
══════════════════════════════════════ */
function acceptTask(taskId){
  const t = D.tasks.find(x => x.id === taskId);
  if(!t) return;
  if(!_fbUser || t.assignedTo !== _fbUser.uid){ toast('This task is not assigned to you','error'); return; }
  t.status = 'accepted';
  t.acceptedAt = Date.now();
  save();
  renderAll();
  toast('🤝 Task accepted! Start when ready.', 'success');
}

/* ══════════════════════════════════════
   FIREBASE — DATA SYNC
   Firestore path layout:
     Personal:  users/{uid}/{visions|projects|tasks}/{id}
     Company:   workspaces/{wsId}/{visions|projects|tasks}/{id}
   fbGetBase() returns the correct collection root.
   fbLoadData()  — pulls Firestore → D, re-applying unsynced local edits
   fbSyncNow()   — debounced write of changed documents, called from save()
══════════════════════════════════════ */
function fbGetBase(){
  if(!_fbUser) return null;
  if(WS_MODE === 'company' && (WS.wsId || WS.orgName)){
    if(!WS.wsId){
      WS.wsId = WS.orgName.replace(/[^a-z0-9]/gi,'_').toLowerCase() + '_' + _fbUser.uid.slice(0,8);
      saveWorkspace();
    }
    return 'workspaces/' + WS.wsId;
  }
  return 'users/' + _fbUser.uid;
}

/* ── Change tracking ───────────────────────────────────────────────────────
   _fbSynced maps 'collection/id' → hash of the version last known to be in
   Firestore. It is persisted per workspace so that edits which never reached
   the cloud (refresh inside the debounce window, offline, failed sync) are
   recognised on the next load and merged on top of the cloud copy instead of
   being overwritten by it. Only changed documents are written, so one device
   or teammate saving no longer rewrites everybody else's records. */
const SK_OWNER     = 'tm_data_owner';   // Firestore base path the local copy of D belongs to
const SYNC_COLS    = ['visions','projects','tasks'];
let _fbSynced      = new Map();
let _fbReady       = false;   // true once D has been reconciled with Firestore for this session
let _fbSyncing     = false;
let _fbSyncAgain   = false;
let _fbMetaHash    = null;
let _fbUnsubs      = [];      // live Firestore listeners for the active workspace
let _fbRenderTimer = null;

function stableStr(o){
  return JSON.stringify(o, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((a, key) => (a[key] = v[key], a), {})
      : v);
}
function hashStr(s){ // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < s.length; i++){
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function docHash(d){ return hashStr(stableStr(d)); }
function fbSyncedKey(base){ return 'tm_synced::' + base; }
function fbReadSynced(base){
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(fbSyncedKey(base)) || 'null') || {})); }
  catch(e){ return new Map(); }
}
function fbWriteSynced(){
  const base = fbGetBase();
  if(!base) return;
  try { localStorage.setItem(fbSyncedKey(base), JSON.stringify(Object.fromEntries(_fbSynced))); }
  catch(e){ console.warn('Could not persist sync state:', e); }
}
function fbLocalDocs(data){
  const m = new Map();
  SYNC_COLS.forEach(c => (data[c] || []).forEach(d => { if(d && d.id != null) m.set(c + '/' + d.id, d); }));
  return m;
}
/** Local changes not yet in Firestore: Map key → doc (set) or null (delete). */
function fbPendingOps(){
  const ops = new Map();
  const local = fbLocalDocs(D);
  local.forEach((d, k) => { if(_fbSynced.get(k) !== docHash(d)) ops.set(k, d); });
  _fbSynced.forEach((_, k) => { if(!local.has(k)) ops.set(k, null); });
  return ops;
}
function fbSetBadge(state){
  const b = document.getElementById('fb-sync-badge');
  if(!b) return;
  const S = {
    synced: ['☁️ Synced',      'rgba(16,185,129,.15)', '#065f46', 'rgba(16,185,129,.3)'],
    saving: ['⏳ Saving…',      'rgba(59,130,246,.12)', '#1e40af', 'rgba(59,130,246,.3)'],
    failed: ['⚠️ Not synced',  'rgba(239,68,68,.12)',  '#991b1b', 'rgba(239,68,68,.3)']
  }[state];
  if(!S) return;
  b.innerHTML = S[0]; b.style.background = S[1]; b.style.color = S[2]; b.style.borderColor = S[3];
  b.dataset.state = state;
}

async function fbLoadData(){
  if(!_fbFS || !_fbUser) return;
  const base = fbGetBase();
  if(!base) return;
  _fbReady = false;
  fbStopLive();
  try {
    const [vsSnap, prSnap, tkSnap] = await Promise.all([
      _fbFS.collection(base + '/visions').get(),
      _fbFS.collection(base + '/projects').get(),
      _fbFS.collection(base + '/tasks').get()
    ]);
    const cloud = migrateData({
      visions:  vsSnap.docs.map(d => d.data()),
      projects: prSnap.docs.map(d => d.data()),
      tasks:    tkSnap.docs.map(d => d.data())
    });
    const cloudDocs = fbLocalDocs(cloud);
    // Read local state only now — after the awaits — so edits made while the
    // request was in flight are included.
    const owner     = localStorage.getItem(SK_OWNER);
    const prevSync  = owner === base ? fbReadSynced(base) : new Map();
    const localDocs = owner === base ? fbLocalDocs(D) : new Map();
    const cloudSync = new Map();
    cloudDocs.forEach((d, k) => cloudSync.set(k, docHash(d)));

    if(!cloudDocs.size && !owner && (D.visions.length || D.projects.length || D.tasks.length)){
      // One-time migration of data created before this device was linked to
      // an account: keep it; it is uploaded below as pending changes.
      _fbSynced = new Map();
    } else {
      // Start from the cloud copy and re-apply local edits that never synced.
      const merged = { visions: [...cloud.visions], projects: [...cloud.projects], tasks: [...cloud.tasks] };
      if(prevSync.size){
        localDocs.forEach((d, k) => {
          if(prevSync.get(k) === docHash(d)) return;           // unchanged locally
          const [c] = k.split('/');
          const i = merged[c].findIndex(x => c + '/' + x.id === k);
          if(i >= 0) merged[c][i] = d; else merged[c].push(d);
        });
        prevSync.forEach((_, k) => {
          if(localDocs.has(k)) return;                         // deleted locally
          const [c] = k.split('/');
          merged[c] = merged[c].filter(x => c + '/' + x.id !== k);
        });
      }
      D = migrateData(merged);
      _fbSynced = cloudSync;
    }
    localStorage.setItem(SK, JSON.stringify(D));
    localStorage.setItem(SK_OWNER, base);
    fbWriteSynced();
    _fbReady = true;
    fbStartLive(base);
    // Load workspace meta
    try {
      const wsMeta = await _fbFS.doc(base + '/meta/workspace').get();
      if(wsMeta.exists){
        const wd = wsMeta.data();
        if(wd.users)   WS.users   = wd.users;
        if(wd.orgName) WS.orgName = wd.orgName;
        saveWorkspace();
      }
    } catch(e){ /* meta not set yet — fine */ }
    _fbMetaHash = docHash(WS);
    if(fbPendingOps().size) fbSyncNow(); else fbSetBadge('synced');
  } catch(e){
    console.warn('Firestore load error:', e);
    fbSetBadge('failed');
    toast('Could not load your cloud data: ' + e.message, 'error');
  }
}

/* ── Real-time updates ─────────────────────────────────────────────────────
   After the initial reconcile, listen for changes made on other devices or by
   teammates and apply them to D as they happen. A document with unsynced
   local edits keeps the local version (it is pushed right after); the user is
   told when someone else changed the same record in the meantime. */
function fbStopLive(){
  _fbUnsubs.forEach(u => { try { u(); } catch(e){} });
  _fbUnsubs = [];
}
function fbStartLive(base){
  fbStopLive();
  SYNC_COLS.forEach(col => {
    const unsub = _fbFS.collection(base + '/' + col).onSnapshot(snap => {
      if(fbGetBase() !== base) return;
      fbApplyRemote(col, snap.docChanges());
    }, e => console.warn('Live updates for ' + col + ' stopped:', e));
    _fbUnsubs.push(unsub);
  });
}
function fbApplyRemote(col, changes){
  let changed = false;
  const conflicts = [];
  changes.forEach(ch => {
    if(ch.doc.metadata && ch.doc.metadata.hasPendingWrites) return; // echo of our own write
    const k     = col + '/' + ch.doc.id;
    const i     = D[col].findIndex(x => String(x.id) === ch.doc.id);
    const local = i >= 0 ? D[col][i] : null;
    const dirty = local ? _fbSynced.get(k) !== docHash(local) : _fbSynced.has(k);
    if(ch.type === 'removed'){
      _fbSynced.delete(k);
      if(local && !dirty){ D[col].splice(i, 1); changed = true; }
      return;
    }
    const remote = migrateData({ [col]: [ch.doc.data()] })[col][0];
    const h = docHash(remote);
    const wasSynced = _fbSynced.get(k);
    _fbSynced.set(k, h);
    if(local && docHash(local) === h) return;                    // already have it
    if(dirty){
      if(wasSynced !== h) conflicts.push(remote.title || 'an item');
      fbScheduleSync();                                          // our version wins; push it
      return;
    }
    if(i >= 0) D[col][i] = remote; else D[col].push(remote);
    changed = true;
  });
  fbWriteSynced();
  if(conflicts.length) toast('“' + conflicts[0] + '” was also changed elsewhere — your version was kept.', 'info');
  if(!changed) return;
  localStorage.setItem(SK, JSON.stringify(D));
  // Coalesce bursts; don't re-render under someone typing an inline title.
  clearTimeout(_fbRenderTimer);
  _fbRenderTimer = setTimeout(function rerender(){
    if(document.activeElement && document.activeElement.isContentEditable){ _fbRenderTimer = setTimeout(rerender, 1000); return; }
    renderAll();
    if(_viewingId && document.getElementById('view-modal').style.display !== 'none'){ renderComments(); renderSubtasks(); }
  }, 150);
}

/** Write pending local changes (only the documents that changed) to Firestore. */
async function fbSyncNow(){
  if(!_fbFS || !_fbUser || !_fbReady) return;
  const base = fbGetBase();
  if(!base) return;
  clearTimeout(_fbSyncTimer);
  if(_fbSyncing){ _fbSyncAgain = true; return; }
  _fbSyncing = true;
  try {
    const ops = [...fbPendingOps()];
    if(ops.length) fbSetBadge('saving');
    for(let i = 0; i < ops.length; i += 400){ // Firestore allows 500 writes per batch
      const batch = _fbFS.batch();
      const done  = [];
      ops.slice(i, i + 400).forEach(([k, d]) => {
        const ref = _fbFS.doc(base + '/' + k);
        if(d){
          const clean = JSON.parse(JSON.stringify(d)); // Firestore rejects `undefined`
          batch.set(ref, clean);
          done.push([k, docHash(d)]);
        } else {
          batch.delete(ref);
          done.push([k, null]);
        }
      });
      await batch.commit();
      done.forEach(([k, h]) => h ? _fbSynced.set(k, h) : _fbSynced.delete(k));
      fbWriteSynced();
    }
    // Workspace meta only when it actually changed. Members may not be allowed
    // to write it, so a failure here must not mark the task data as unsynced.
    const metaHash = docHash(WS);
    if(metaHash !== _fbMetaHash){
      try {
        await _fbFS.doc(base + '/meta/workspace').set(JSON.parse(JSON.stringify({ ...WS, mode: WS_MODE, updatedAt: Date.now() })));
        _fbMetaHash = metaHash;
      } catch(e){ console.warn('Workspace meta sync skipped:', e); _fbMetaHash = metaHash; }
    }
    fbSetBadge(fbPendingOps().size ? 'saving' : 'synced');
  } catch(e){
    console.warn('Firestore sync error:', e);
    fbSetBadge('failed');
    // Changes stay pending (and survive a reload); try again shortly.
    clearTimeout(_fbSyncTimer);
    _fbSyncTimer = setTimeout(fbSyncNow, 15000);
  } finally {
    _fbSyncing = false;
    if(_fbSyncAgain){ _fbSyncAgain = false; fbScheduleSync(); }
  }
}

/* Flush pending writes when the tab is hidden or closed, and keep several open
   tabs in step. */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') fbSyncNow();
});
window.addEventListener('pagehide', () => { fbSyncNow(); });
window.addEventListener('online',   () => { fbScheduleSync(); });
window.addEventListener('storage', e => {
  if(e.key === SK && e.newValue){
    try { D = migrateData(JSON.parse(e.newValue)); renderAll(); } catch(_){}
  } else if(_fbUser && e.key === fbSyncedKey(fbGetBase())){
    _fbSynced = fbReadSynced(fbGetBase());
  }
});

/* ── Auth UI (legacy stubs — old modal removed, replaced by login-gate) ── */
// These functions previously drove a modal overlay (#fb-email, #fb-auth-btn, etc.)
// that no longer exists in the DOM.  They now delegate to the full-screen gate
// equivalents so any stale call-sites still work without throwing errors.
function fbDoAuth()         { gateDoAuth(); }
function fbToggleAuthMode() { gateToggleMode(); }
async function fbForgotPassword() { await gateForgotPassword(); }
function fbOpenLoginModal(){ /* no-op — login gate is always visible when signed out */ }
function fbSkipLogin()      { /* no-op — login is mandatory */ }
function fbAuthErrMsg(code){
  return ({
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-credential':   'Incorrect email or password.',
    'auth/user-not-found':       'No account found with this email.',
    'auth/invalid-email':        'Invalid email address.',
    'auth/email-already-in-use': 'An account already exists with this email.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many failed attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  })[code] || ('Error: ' + code);
}

/* ══════════════════════════════════════
   ONBOARDING (legacy stubs — replaced by login gate + profile wizard)
══════════════════════════════════════ */
function checkOnboarding(){ /* handled by fbHandleAuthChange + profile wizard */ }
function skipOnboarding()  { /* no skip — login required */ }
function reopenOnboarding(){ /* profile wizard handles this */ }
function obSelectMode()    { /* legacy */ }
function obBack()          { /* legacy */ }
function finishOnboarding(){ /* legacy — replaced by profile wizard */ }
function updateWorkspaceUI(){
  const isCompany = WS_MODE === 'company';
  // Admin Console always visible — needed to configure workspace mode
  // Only hide user-switcher in personal mode (no team members to switch between)
  const swWrap = document.getElementById('user-switch-wrap');
  if(swWrap) swWrap.style.display = isCompany ? '' : 'none';
  if(isCompany) renderUserSwitcher();
}

/* ══════════════════════════════════════
   ADMIN CONSOLE
══════════════════════════════════════ */
function renderAdmin(){
  const isCompany = WS_MODE === 'company';
  // Use Firestore members if loaded, fallback to local WS.users
  const members = _wsMembers.length ? _wsMembers : (WS.users||[]).map(u=>({...u, uid:u.id||u.uid}));
  const isAdmin = !!members.find(m => m.uid===(_fbUser&&_fbUser.uid) && m.isAdmin);

  const sub = document.getElementById('admin-subtitle');
  if(sub) sub.textContent = isCompany
    ? `${WS.orgName} · Manage team & workspace`
    : 'Configure your workspace — use Company mode to enable team features';

  // Header buttons
  const phR = document.getElementById('admin-ph-r');
  if(phR) phR.innerHTML = isCompany && isAdmin
    ? `<button class="btn bp" onclick="adminGenerateInvite()">🔗 Generate Invite</button>`
    : '';

  // Show/hide company-only cards
  const posCard = document.getElementById('admin-positions-card');
  const invCard = document.getElementById('admin-invites-card');
  if(posCard) posCard.style.display = isCompany ? '' : 'none';
  if(invCard) invCard.style.display = (isCompany && isAdmin) ? '' : 'none';

  // Workspace info card
  const wsInfo = document.getElementById('admin-ws-info');
  if(wsInfo){
    const pill = isCompany
      ? `<span class="workspace-pill wp-company">🏢 Company / Team</span>`
      : `<span class="workspace-pill wp-personal">👤 Personal</span>`;
    const adminMember = members.find(u=>u.isAdmin);
    wsInfo.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        ${pill}<span style="font-weight:700;font-size:.88rem">${esc(isCompany ? WS.orgName : 'Personal Workspace')}</span>
      </div>
      ${isCompany
        ? `<div style="font-size:.78rem;color:var(--muted)">${members.length} member${members.length!==1?'s':''} · Admin: <strong>${esc((adminMember||{}).name||'—')}</strong></div>`
        : `<div style="font-size:.82rem;color:var(--muted);line-height:1.6">You are in <strong>Personal mode</strong>. Sign up or log in with Company setup to enable team features.</div>`
      }`;
  }

  // Team Members list
  const countBadge = document.getElementById('user-count-badge');
  if(countBadge){
    countBadge.textContent = isCompany ? members.length + ' member' + (members.length!==1?'s':'') : '';
    countBadge.style.display = countBadge.textContent ? '' : 'none'; // no empty pill in personal mode
  }

  const usersList = document.getElementById('users-list');
  if(usersList){
    if(!isCompany){
      usersList.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:8px">🏢</div>
        <div style="font-weight:700;margin-bottom:6px">Team features require Company mode</div>
        <div style="font-size:.8rem;line-height:1.5">Create a company workspace during sign-up to add members.</div></div>`;
    } else if(!members.length){
      usersList.innerHTML = `<div class="emp" style="padding:18px"><div class="empi">👥</div><div class="empt">No team members yet</div><div class="emps">Generate an invite code and share it with your team.</div></div>`;
    } else {
      usersList.innerHTML = members.map(m => `
        <div class="urow">
          <div class="urow-av" style="background:${m.avatarColor||'linear-gradient(135deg,#5B6EF5,#7C3AED)'}">${esc(m.initials||'?')}</div>
          <div class="urow-info">
            <div class="urow-name">${esc(m.name)}
              ${m.isAdmin?`<span class="role-badge admin-badge">Admin</span>`:''}
              ${_fbUser&&m.uid===_fbUser.uid?`<span class="role-badge you-badge">You</span>`:''}
            </div>
            <div class="urow-meta">${esc(m.email||'')} &nbsp;<span class="role-badge">${esc(m.position||m.role||'')}</span></div>
          </div>
          ${isAdmin && !m.isAdmin ? `<button class="bic bic-red" onclick="adminRemoveMember('${m.uid}')" title="Remove member"><svg class="i" aria-hidden="true"><use href="#i-trash"/></svg></button>` : ''}
        </div>`).join('');
    }
  }

  // Positions
  renderAdminPositions();
  // Invites (load from Firestore first if admin)
  if(isCompany && isAdmin && !_wsInvites.length){
    fbLoadInvites().then(renderAdminInvites);
  } else {
    renderAdminInvites();
  }
}

async function adminRemoveMember(uid){
  const m = _wsMembers.find(x=>x.uid===uid);
  if(!m) return;
  confirmAction('Remove ' + m.name + ' from the workspace?', async () => {
    try {
      await _fbFS.doc('workspaces/' + WS.wsId + '/members/' + uid).delete();
      _wsMembers = _wsMembers.filter(x=>x.uid!==uid);
      renderAdmin();
      toast(m.name + ' removed', 'info');
    } catch(e){ toast('Error: ' + e.message, 'error'); }
  });
}
function openAddUserModal(){
  document.getElementById('aum-title').textContent = '➕ Add Team Member';
  document.getElementById('aum-name').value  = '';
  document.getElementById('aum-email').value = '';
  document.getElementById('aum-role').value  = 'Manager';
  document.getElementById('aum-admin').value = 'false';
  document.getElementById('aum-err').style.display = 'none';
  document.getElementById('add-user-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('aum-name').focus(), 60);
}
function closeAddUserModal(){
  document.getElementById('add-user-modal').style.display = 'none';
}
function saveUser(){
  const name    = document.getElementById('aum-name').value.trim();
  const email   = document.getElementById('aum-email').value.trim();
  const role    = document.getElementById('aum-role').value;
  const isAdmin = document.getElementById('aum-admin').value === 'true';
  const errEl   = document.getElementById('aum-err');
  if(!name) { errEl.textContent='Name is required'; errEl.style.display=''; return; }
  if(!email){ errEl.textContent='Email is required'; errEl.style.display=''; return; }
  errEl.style.display = 'none';
  const colors = [
    'linear-gradient(135deg,#5B6EF5,#7C3AED)',
    'linear-gradient(135deg,#10B981,#06B6D4)',
    'linear-gradient(135deg,#F59E0B,#F97316)',
    'linear-gradient(135deg,#EF4444,#F97316)',
    'linear-gradient(135deg,#8B5CF6,#EC4899)',
    'linear-gradient(135deg,#06B6D4,#3B82F6)'
  ];
  WS.users.push({
    id: newId(), name, email, role, isAdmin,
    initials: name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??',
    avatarColor: colors[WS.users.length % colors.length]
  });
  saveWorkspace();
  closeAddUserModal();
  renderAdmin();
  renderUserSwitcher();
  toast(`✅ ${name} added to workspace`);
}
function deleteUser(id){
  const u = WS.users.find(x=>x.id===id);
  if(!u) return;
  confirmAction(`Remove ${u.name} from the workspace?`, () => {
    WS.users = WS.users.filter(x=>x.id!==id);
    if(WS_CUR_USER && WS_CUR_USER.id===id){
      WS_CUR_USER = WS.users[0] || null;
      saveCurrentUser();
    }
    saveWorkspace();
    renderAdmin();
    renderUserSwitcher();
    toast(`${u.name} removed`, 'info');
  });
}
function openSwitchModeModal(){
  const newMode = WS_MODE === 'company' ? 'personal' : 'company';
  confirmAction(`Switch to ${newMode} mode? Your data stays intact.`, async () => {
    WS_MODE = newMode;
    localStorage.setItem(WS_MODE_KEY, WS_MODE);
    // Persist mode change to Firestore profile so it survives next login
    if(_fbFS && _fbUser){
      try {
        await _fbFS.doc('users/' + _fbUser.uid + '/profile/main').update({ wsMode: newMode });
      } catch(e){ console.warn('Mode update in Firestore failed:', e); }
    }
    updateWorkspaceUI();
    renderAdmin();
    renderSettings();
    toast(`Switched to ${newMode} mode`, 'info');
  });
}

/* ══════════════════════════════════════
   USER SWITCHER (sidebar)
   In Firebase mode this widget is READ-ONLY — it shows who is on the team
   and highlights the currently authenticated user (_fbUser).
   WS.users is kept as a fallback if Firestore members haven't loaded yet.
══════════════════════════════════════ */
function renderUserSwitcher(){
  if(WS_MODE !== 'company') return;
  // Prefer Firestore members; fall back to local WS.users cache
  const members = _wsMembers.length
    ? _wsMembers
    : (WS.users||[]).map(u => ({ ...u, uid: u.uid || u.id }));
  // The "active" user is always the authenticated Firebase user
  const activeUid = _fbUser?.uid || WS_CUR_USER?.uid || WS_CUR_USER?.id || null;
  const cur = members.find(m => m.uid === activeUid) || members[0] || null;

  const av = document.getElementById('usr-sw-av');
  const nm = document.getElementById('usr-sw-name');
  if(av && cur){ av.style.background = cur.avatarColor||'linear-gradient(135deg,#5B6EF5,#7C3AED)'; av.textContent = cur.initials||'?'; }
  if(nm && cur){ nm.textContent = cur.name; }

  const list = document.getElementById('usr-sw-list');
  if(!list) return;
  if(!members.length){
    list.innerHTML = '<div style="padding:10px 12px;font-size:.78rem;color:var(--muted)">No team members yet.</div>';
    return;
  }
  list.innerHTML = members.map(u => {
    const isMe = u.uid === activeUid;
    return `<div class="user-sw-item ${isMe?'active':''}" style="cursor:default">
      <div class="user-av-sm" style="background:${u.avatarColor||'linear-gradient(135deg,#5B6EF5,#7C3AED)'}">${esc(u.initials||'?')}</div>
      <span>${esc(u.name)}</span>
      <span style="margin-left:auto;display:flex;gap:4px">
        ${u.isAdmin?`<span class="role-badge admin-badge" style="font-size:.6rem;padding:1px 5px">Admin</span>`:''}
        ${isMe?`<span class="role-badge you-badge" style="font-size:.6rem;padding:1px 5px">You</span>`:''}
      </span>
    </div>`;
  }).join('');
}
function toggleUserSwitcher(){
  document.getElementById('usr-sw-list').classList.toggle('open');
}
/** switchUser is kept for backward compat but is a no-op in Firebase mode —
 *  identity is always determined by _fbUser (Firebase Auth). */
function switchUser(id){
  // In Firebase mode the logged-in user cannot be switched client-side.
  // We simply close the panel and do nothing else.
  document.getElementById('usr-sw-list')?.classList.remove('open');
}

// Firebase config is hardcoded in FB_CONFIG — no modal needed

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
window.addEventListener('load', () => {
  const safe = (fn, name) => { try { fn(); } catch(e) { console.warn(name+' failed:', e); } };
  safe(initQuill,           'initQuill');
  safe(initTheme,           'initTheme');
  safe(updateHeaderProfile, 'updateHeaderProfile');
  safe(renderAll,           'renderAll');
  safe(renderProfilePage,   'renderProfilePage');
  safe(initNotifications,   'initNotifications');
  safe(fbInit,              'fbInit'); // login gate handles all onboarding

  // Register the service worker for offline support / installability.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed:', e));
  }

  // Reflect connectivity changes in the save badge.
  const syncBadge = () => {
    const b = document.querySelector('.sv-badge');
    if(!b) return;
    if(navigator.onLine){ b.textContent = '💾 Auto-Saved'; b.style.opacity = ''; }
    else { b.textContent = '📡 Offline'; b.style.opacity = '.7'; }
  };
  window.addEventListener('online',  syncBadge);
  window.addEventListener('offline', syncBadge);
  syncBadge();
});


