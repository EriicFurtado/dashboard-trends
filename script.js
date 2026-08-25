/* ============================================================================
 * Dashboard OS + Tarefas — Trends Automation
 * ============================================================================
 * Estrutura deste arquivo:
 *   1. Dados embutidos:      OS_DATA, TASK_DATA, LOC_DATA (arrays JSON)
 *   2. Config global do Chart.js (Chart.defaults)
 *   3. Utilitários gerais:   techColor, normalizeCat, fmtDate, countBy, etc.
 *   4. Painel OS:            initOS / applyOS / renderOS / renderOsTable
 *   5. Painel Tarefas:       initTasks / applyTasks / renderTasks / renderTTable
 *   6. Painel Serviços FAST: initFast / applyFast / renderFast / renderFTable
 *   7. Painel Projetos:      initProj / applyProj / renderProj / renderPTable
 *   8. Filtros, exportação XLSX e ranking de localidades (fim do arquivo)
 *
 * Depende de: Chart.js e SheetJS/XLSX (carregados via CDN no HTML) e dos elementos
 * DOM definidos no HTML. Estilos em styles.css.
 * ============================================================================ */

/* Estilo global estilo BI */
Chart.defaults.font.family = "'Segoe UI', Calibri, system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = '#546E7A';
Chart.defaults.borderColor = 'rgba(0,0,0,0.06)';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
Chart.defaults.plugins.legend.labels.padding = 12;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.94)';
Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.elements.line.tension = 0.35;
Chart.defaults.elements.point.hoverRadius = 6;
Chart.defaults.animation.duration = 650;
Chart.defaults.animation.easing = 'easeOutQuart';
const OS_DATA = [];
const TASK_DATA = [];
const OPEN_OS = ['Agendado','Em Serviço','Pendente','Pausado','Aguardando progresso de obra'];
const OPEN_TASK = ['Agendada','Em execução','Impedida','Planejando','Pausa'];
const TODAY = new Date();
TODAY.setHours(12, 0, 0, 0);
const BRAND = '#001098';
const MES_NOMES = {'01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez'};
const TEC_COLORS = ['#001098','#00897B','#E65100','#6A1B9A','#1565C0','#C62828','#F9A825','#5D4037'];
const TECH_COLOR_MAP = {
  'Eric Furtado': '#001098',
  'Felipe Santos': '#00897B',
  'Leandro Maia': '#E65100',
  'Rafael': '#6A1B9A',
  'Willyam': '#1565C0',
  'Souza': '#C62828'
};
function techColor(name, idx) {
  if (TECH_COLOR_MAP[name]) return TECH_COLOR_MAP[name];
  return TEC_COLORS[idx % TEC_COLORS.length];
}

// Categorias padronizadas
const CAT_MAP = {
  'AUT': 'Automação',
  'AUTO': 'Automação',
  'AAV': 'Áudio e Vídeo',
  'RED': 'Redes',
  'REDES': 'Redes',
  'SEG': 'Segurança Eletrônica',
  'VTE': 'Visita Técnica'
};
const CAT_ALLOWED = new Set(['AUT','AAV','RED','SEG','VTE']);
function normalizeCat(raw) {
  if (!raw) return '';
  const u = String(raw).trim().toUpperCase();
  // Já é código conhecido
  if (u === 'AUTO') return 'AUT';
  if (u === 'REDES') return 'RED';
  if (CAT_ALLOWED.has(u)) return u;
  return ''; // remove outras siglas (AAT, AAC, etc.)
}
function catLabel(code) {
  return CAT_MAP[code] || code;
}
function mesLabel(ym) { if (!ym||ym.length<7) return ym; const [y,m]=ym.split('-'); return (MES_NOMES[m]||m)+'/'+y; }

let currentPanel='os', osFiltered=[...OS_DATA], tFiltered=[...TASK_DATA];
let osView='all', tView='all', osSort={key:'os',asc:false}, tSort={key:'id',asc:false};
const charts = {};

function switchPanel(btn) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const id = 'panel-' + btn.dataset.panel;
  document.getElementById(id).classList.add('active');
  currentPanel = btn.dataset.panel;
}
function statusBadge(s) {
  const key=(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');
  const map={finalizado:'badge-finalizado',finalizada:'badge-finalizada',emservico:'badge-emservico',emexecucao:'badge-emexecucao',agendado:'badge-agendado',agendada:'badge-agendada',pendente:'badge-pendente',impedida:'badge-impedida',pausado:'badge-pausado',pausa:'badge-pausado',cancelado:'badge-cancelado',cancelada:'badge-cancelado',planejando:'badge-agendada',aguardandoprogressodeobra:'badge-aguardando'};
  return `<span class="badge ${map[key]||''}">${s}</span>`;
}
function prazoBadge(p) {
  const map={'Prazo crítico':'badge-critico','Prazo alto':'badge-alto','Prazo médio':'badge-medio'};
  return `<span class="badge ${map[p]||''}">${p}</span>`;
}
function fmtDate(d) { if(!d) return '—'; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}`; }
function countBy(arr,key) { const m={}; arr.forEach(d=>{const k=d[key]||'(vazio)'; m[k]=(m[k]||0)+1;}); return m; }
function fillSelect(id, items, labelFn) {
  const el=document.getElementById(id); const cur=el.value;
  el.innerHTML='<option value="">'+(id.includes('Cat')?'Todas':'Todos')+'</option>';
  [...new Set(items)].filter(Boolean).sort().forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=labelFn?labelFn(v):v; el.appendChild(o); });
  if([...el.options].some(o=>o.value===cur)) el.value=cur;
}

/* OS — same as before */

function updateOsRangeUI() {
  const months = window.osMonths || [];
  if (!months.length) return;
  let a = +document.getElementById('osDe').value, b = +document.getElementById('osAte').value;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  document.getElementById('osDeLabel').textContent = mesLabel(months[lo]);
  document.getElementById('osAteLabel').textContent = mesLabel(months[hi]);
  const max = Math.max(1, months.length - 1);
  const fill = document.getElementById('osTrackFill');
  fill.style.left = (lo / max * 100) + '%';
  fill.style.width = ((hi - lo) / max * 100) + '%';
}
function onOsRange() { updateOsRangeUI(); applyOS(); }

function updateTRangeUI() {
  const months = window.tMonths || [];
  if (!months.length) return;
  let a = +document.getElementById('tDe').value, b = +document.getElementById('tAte').value;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  document.getElementById('tDeLabel').textContent = mesLabel(months[lo]);
  document.getElementById('tAteLabel').textContent = mesLabel(months[hi]);
  const max = Math.max(1, months.length - 1);
  const fill = document.getElementById('tTrackFill');
  fill.style.left = (lo / max * 100) + '%';
  fill.style.width = ((hi - lo) / max * 100) + '%';
}
function onTRange() { updateTRangeUI(); applyTasks(); }


/* ========== SERVIÇOS FAST ========== */
const FAST_ALL = OS_DATA.filter(d => (d.tipoServico||'').toLowerCase() === 'serviço fast');
let fastFiltered = [...FAST_ALL];
let fView = 'all', fSort = {key:'os', asc:false};

function parseDiffMin(s) {
  if (!s || s === '0' || s === 'nan') return null;
  s = String(s).trim().toLowerCase();
  const neg = s.startsWith('-');
  const s2 = s.replace(/-/g, ' ');
  let h = 0, m = 0;
  const mh = s2.match(/([\d.]+)\s*h/);
  const mm = s2.match(/(\d+)\s*min/);
  if (mh) h = parseFloat(mh[1]);
  if (mm) m = parseFloat(mm[1]);
  if (!mh && !mm) return null;
  const total = h * 60 + m;
  return neg ? -total : total;
}
function taskDurationMin(t) {
  const d = parseDiffMin(t.diferenca);
  if (d !== null) return Math.abs(d);
  return null;
}
function fmtDuration(min) {
  if (min == null || isNaN(min)) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h <= 0) return m + 'min';
  return h + 'h' + (m ? String(m).padStart(2,'0') + 'min' : '');
}
function tasksForOs(osNum) {
  return TASK_DATA.filter(t => t.os === osNum);
}
function avgTaskMinForOs(osNum) {
  const ts = tasksForOs(osNum);
  const mins = ts.map(taskDurationMin).filter(x => x != null && x > 0);
  if (!mins.length) return null;
  return mins.reduce((a,b)=>a+b,0) / mins.length;
}

function updateFRangeUI() {
  const months = window.fMonths || [];
  if (!months.length) return;
  let a = +document.getElementById('fDe').value, b = +document.getElementById('fAte').value;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  document.getElementById('fDeLabel').textContent = mesLabel(months[lo]);
  document.getElementById('fAteLabel').textContent = mesLabel(months[hi]);
  const max = Math.max(1, months.length - 1);
  const fill = document.getElementById('fTrackFill');
  fill.style.left = (lo / max * 100) + '%';
  fill.style.width = ((hi - lo) / max * 100) + '%';
}
function onFRange() { updateFRangeUI(); applyFast(); }

function initFast() {
  fillSelect('fStatus', FAST_ALL.map(d => d.status));
  fillSelect('fPrazo', FAST_ALL.map(d => d.prazo));
  fillSelect('fCliente', FAST_ALL.map(d => d.cliente));
  window.fMonths = [...new Set(FAST_ALL.map(d => d.anoMes).filter(Boolean))].sort();
  const fDe = document.getElementById('fDe'), fAte = document.getElementById('fAte');
  fDe.min = 0; fDe.max = Math.max(0, window.fMonths.length - 1); fDe.value = 0;
  fAte.min = 0; fAte.max = Math.max(0, window.fMonths.length - 1); fAte.value = fAte.max;
  updateFRangeUI();
  document.getElementById('fTotal').textContent = FAST_ALL.length;
}
function applyFast() {
  const st = document.getElementById('fStatus').value;
  const pr = document.getElementById('fPrazo').value;
  const cl = document.getElementById('fCliente').value;
  const deIdx = +document.getElementById('fDe').value, ateIdx = +document.getElementById('fAte').value;
  const de = (window.fMonths && window.fMonths[Math.min(deIdx, ateIdx)]) || '';
  const ate = (window.fMonths && window.fMonths[Math.max(deIdx, ateIdx)]) || '';
  const se = document.getElementById('fSearch').value.trim().toLowerCase();
  fastFiltered = FAST_ALL.filter(d => {
    if (st && d.status !== st) return false;
    if (pr && d.prazo !== pr) return false;
    if (cl && d.cliente !== cl) return false;
    if (de && d.anoMes && d.anoMes < de) return false;
    if (ate && d.anoMes && d.anoMes > ate) return false;
    if (se && !String(d.cliente).toLowerCase().includes(se) && !String(d.os).includes(se)) return false;
    return true;
  });
  document.getElementById('fCount').textContent = fastFiltered.length;
  renderFast();
}
function renderFast() {
  const total = fastFiltered.length;
  const fin = fastFiltered.filter(d => d.status === 'Finalizado').length;
  const ab = fastFiltered.filter(d => OPEN_OS.includes(d.status)).length;
  const taxa = total ? (fin / total * 100) : 0;
  const cli = new Set(fastFiltered.map(d => d.cliente)).size;

  // tempos das tarefas vinculadas
  const osSet = new Set(fastFiltered.map(d => d.os));
  const linkedTasks = TASK_DATA.filter(t => osSet.has(t.os));
  const taskMins = linkedTasks.map(taskDurationMin).filter(x => x != null && x > 0);
  const avgTask = taskMins.length ? taskMins.reduce((a,b)=>a+b,0)/taskMins.length : null;
  const medianTask = taskMins.length ? [...taskMins].sort((a,b)=>a-b)[Math.floor(taskMins.length/2)] : null;
  const diasVals = fastFiltered.map(d => d.dias).filter(x => x >= 0).sort((a,b)=>a-b);
  const medDias = diasVals.length ? diasVals[Math.floor(diasVals.length/2)] : 0;

  document.getElementById('fKpis').innerHTML = `
    <div class="kpi"><div class="label">OS Serviço FAST</div><div class="value">${total}</div></div>
    <div class="kpi green"><div class="label">Finalizadas</div><div class="value">${fin}</div><div class="sub">${taxa.toFixed(1)}%</div></div>
    <div class="kpi orange"><div class="label">Em Aberto</div><div class="value">${ab}</div></div>
    <div class="kpi accent"><div class="label">Clientes</div><div class="value">${cli}</div></div>
    <div class="kpi purple"><div class="label">Tarefas vinculadas</div><div class="value">${linkedTasks.length}</div></div>
    <div class="kpi green"><div class="label">Tempo médio execução</div><div class="value" style="font-size:1.15rem">${fmtDuration(avgTask)}</div><div class="sub">média das tarefas</div></div>
    <div class="kpi"><div class="label">Tempo mediano tarefas</div><div class="value" style="font-size:1.15rem">${fmtDuration(medianTask)}</div></div>
    <div class="kpi"><div class="label">Dias OS (mediano)</div><div class="value">${medDias}<span style="font-size:.8rem">d</span></div></div>`;

  // Status chart
  const st = countBy(fastFiltered, 'status');
  const stL = Object.keys(st), stD = Object.values(st);
  const stC = {'Finalizado':'#1B7A4E','Em Serviço':'#1565C0','Agendado':'#6A1B9A','Pendente':'#C62828','Pausado':'#E65100','Cancelado':'#78909C'};
  if (charts.fastStatus) charts.fastStatus.destroy();
  charts.fastStatus = new Chart(document.getElementById('cFastStatus'), {
    type: 'doughnut',
    data: { labels: stL, datasets: [{ data: stD, backgroundColor: stL.map(l => stC[l]||'#999'), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, plugins: { legend: { position: 'right', labels: { boxWidth: 11, font: { size: 10 } } } } }
  });

  // Ocorrencias
  const oc = Object.entries(countBy(fastFiltered, 'ocorrencia')).sort((a,b)=>b[1]-a[1]);
  if (charts.fastOcorr) charts.fastOcorr.destroy();
  charts.fastOcorr = new Chart(document.getElementById('cFastOcorr'), {
    type: 'bar',
    data: { labels: oc.map(e => e[0].length>22?e[0].slice(0,20)+'…':e[0]), datasets: [{ data: oc.map(e=>e[1]), backgroundColor: BRAND, borderRadius: 3, label: 'OS' }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  // Temporal
  const tm = Object.entries(countBy(fastFiltered, 'anoMes')).sort((a,b)=>a[0].localeCompare(b[0]));
  if (charts.fastTmp) charts.fastTmp.destroy();
  charts.fastTmp = new Chart(document.getElementById('cFastTemporal'), {
    type: 'line',
    data: { labels: tm.map(e => mesLabel(e[0])), datasets: [{
      data: tm.map(e=>e[1]), borderColor: BRAND, backgroundColor: 'rgba(0,16,152,.18)',
      fill: true, tension: .4, pointRadius: 4, pointHoverRadius: 7,
      pointBackgroundColor: BRAND, pointBorderColor: '#fff', pointBorderWidth: 2,
      borderWidth: 2.5, label: 'OS FAST'
    }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false } },
        x: { grid: { display: false }, border: { display: false } }
      }
    }
  });

  // Distribuição de tempos de tarefas (buckets)
  const buckets = {'≤1h':0,'1–3h':0,'3–6h':0,'6–12h':0,'>12h':0};
  taskMins.forEach(m => {
    if (m <= 60) buckets['≤1h']++;
    else if (m <= 180) buckets['1–3h']++;
    else if (m <= 360) buckets['3–6h']++;
    else if (m <= 720) buckets['6–12h']++;
    else buckets['>12h']++;
  });
  if (charts.fastTempo) charts.fastTempo.destroy();
  charts.fastTempo = new Chart(document.getElementById('cFastTempo'), {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{ label: 'Tarefas', data: Object.values(buckets), backgroundColor: ['#1B7A4E','#00897B','#1565C0','#E65100','#C62828'], borderRadius: 4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });

  renderFTable();
  rankLocalidades('FAST', 'fLocBody');
}
function getFTableData() {
  let data = [...fastFiltered];
  if (fView === 'abertas') data = data.filter(d => OPEN_OS.includes(d.status));
  else if (fView === 'finalizadas') data = data.filter(d => d.status === 'Finalizado');
  data.sort((a,b) => {
    let va=a[fSort.key], vb=b[fSort.key];
    if (typeof va==='string') va=va.toLowerCase(); if (typeof vb==='string') vb=vb.toLowerCase();
    if (va<vb) return fSort.asc?-1:1; if (va>vb) return fSort.asc?1:-1; return 0;
  });
  return data;
}
function renderFTable() {
  const data = getFTableData();
  const tb = document.getElementById('fBody');
  if (!data.length) { tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#999">Nenhuma OS FAST</td></tr>'; return; }
  tb.innerHTML = data.map(d => {
    const ts = tasksForOs(d.os);
    const avg = avgTaskMinForOs(d.os);
    return `<tr>
      <td class="sticky-col" title="${d.cliente}"><strong>${d.cliente.length>26?d.cliente.slice(0,24)+'…':d.cliente}</strong></td>
      <td><strong>${d.os}</strong></td>
      <td>${statusBadge(d.status)}</td>
      <td>${prazoBadge(d.prazo)}</td>
      <td title="${d.ocorrencia}">${d.ocorrencia.length>22?d.ocorrencia.slice(0,20)+'…':d.ocorrencia}</td>
      <td>${fmtDate(d.cadastro)}</td>
      <td>${fmtDate(d.prevTermino)}</td>
      <td style="text-align:right;font-weight:600">${d.dias}</td>
      <td style="text-align:center">${ts.length}</td>
      <td>${fmtDuration(avg)}</td>
    </tr>`;
  }).join('');
}
function sortF(k) { if (fSort.key===k) fSort.asc=!fSort.asc; else { fSort.key=k; fSort.asc=true; } renderFTable(); }
function setFView(btn) {
  document.querySelectorAll('#panel-fast .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active'); fView = btn.dataset.view; renderFTable();
}



/* ========== PROJETOS (Projeto Padrão) ========== */
let PROJ_ALL = [];
let PROJECT_TASKS = [];
let PROJECT_TREE = [];
let projectLoadState = 'loading';
let projFiltered = [];
let pView = 'all', pSort = {key:'diasAte', asc:true};

function diasAteTermino(prevTermino) {
  if (!prevTermino) return null;
  try {
    const end = new Date(prevTermino.slice(0,10) + 'T12:00:00');
    const hoje = new Date();
    hoje.setHours(12,0,0,0);
    return Math.round((end - hoje) / 86400000);
  } catch(e) { return null; }
}
function sitFromDias(d) {
  if (d == null) return 'sem-data';
  if (d < 0) return 'atrasado';
  if (d === 0) return 'hoje';
  if (d <= 7) return '7';
  if (d <= 30) return '30';
  return 'ok';
}
function sitBadge(dias) {
  if (dias == null) return '<span class="badge" style="background:#eee;color:#666">Sem data</span>';
  if (dias < 0) return `<span class="badge badge-pendente">Atrasado</span>`;
  if (dias === 0) return `<span class="badge" style="background:#FFF3E0;color:#E65100">Vence hoje</span>`;
  if (dias <= 7) return `<span class="badge" style="background:#FFF8E1;color:#F9A825">${dias}d</span>`;
  if (dias <= 30) return `<span class="badge" style="background:#E3F2FD;color:#1565C0">${dias}d</span>`;
  return `<span class="badge badge-finalizado">${dias}d</span>`;
}
function tasksStatsOs(osNum) {
  const ts = PROJECT_TASKS.filter(t => t.serviceOrderExternalId === osNum);
  const fin = ts.filter(t => (t.status||'').toLowerCase() === 'finalizada').length;
  return { total: ts.length, fin, pct: ts.length ? (fin/ts.length*100) : null };
}

function updatePRangeUI() {
  const months = window.pMonths || [];
  if (!months.length) return;
  let a = +document.getElementById('pDe').value, b = +document.getElementById('pAte').value;
  const lo = Math.min(a,b), hi = Math.max(a,b);
  document.getElementById('pDeLabel').textContent = mesLabel(months[lo]);
  document.getElementById('pAteLabel').textContent = mesLabel(months[hi]);
  const max = Math.max(1, months.length - 1);
  const fill = document.getElementById('pTrackFill');
  fill.style.left = (lo / max * 100) + '%';
  fill.style.width = ((hi - lo) / max * 100) + '%';
}
function onPRange() { updatePRangeUI(); applyProj(); }

function initProj() {
  fillSelect('pStatus', PROJ_ALL.map(d => d.status));
  fillSelect('pPrazo', PROJ_ALL.map(d => d.prazo));
  fillSelect('pCliente', PROJ_ALL.map(d => d.cliente));
  window.pMonths = [...new Set(PROJ_ALL.map(d => d.anoMes).filter(Boolean))].sort();
  const pDe = document.getElementById('pDe'), pAte = document.getElementById('pAte');
  pDe.min = 0; pDe.max = Math.max(0, window.pMonths.length - 1); pDe.value = 0;
  pAte.min = 0; pAte.max = Math.max(0, window.pMonths.length - 1); pAte.value = pAte.max;
  updatePRangeUI();
  document.getElementById('pTotal').textContent = PROJ_ALL.length;
}

function projectDaysSince(date) {
  const parsed = ganttDate(date);
  if (!parsed) return 0;
  const today = new Date(); today.setHours(12,0,0,0);
  return Math.max(0, ganttDayDiff(parsed, today));
}

function projectOrderForDashboard(project) {
  return {
    databaseId: project.id,
    os: project.externalId,
    cliente: project.client,
    ocorrencia: project.occurrence,
    tipoServico: project.operationalServiceType,
    prazo: project.deadlineLevel,
    status: project.status,
    cadastro: project.registeredOn,
    prevInicio: project.plannedStartOn,
    prevTermino: project.plannedEndOn,
    anoMes: project.registeredOn ? project.registeredOn.slice(0, 7) : '',
    dias: projectDaysSince(project.registeredOn),
    diasAte: diasAteTermino(project.plannedEndOn)
  };
}

function renderProjectLoadState(state) {
  projectLoadState = state;
  const host = document.getElementById('projectGantt');
  if(!host) return;
  if(state === 'loading') {
    host.innerHTML = '<div class="gantt-empty" role="status">Carregando projetos...</div>';
  }
  else if(state === 'error') {
    host.innerHTML = '<div class="gantt-empty" role="alert">Não foi possível carregar os projetos.<br><button type="button" class="gantt-retry" onclick="loadProjectData()">Tente novamente</button></div>';
  }
}

function renderProjectSyncTime(updatedAt) {
  const target = document.getElementById('pDataSource');
  if(!target) return;
  if(!updatedAt) {
    target.hidden = true;
    return;
  }
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  target.textContent = `Última atualização: ${parsed.toLocaleString('pt-BR')}`;
}

async function loadProjectData() {
  renderProjectLoadState('loading');
  try {
    const client = getSupabaseClient();
    const snapshot = await ProjectData.loadProjects(client);
    PROJECT_TREE = snapshot.projects;
    PROJECT_TASKS = snapshot.tasks;
    PROJ_ALL = PROJECT_TREE.flatMap(clientProject => clientProject.projects).map(projectOrderForDashboard);
    projFiltered = [...PROJ_ALL];
    ganttOpenRows.clear();
    ganttInitialized = false;
    initProj();
    renderProjectSyncTime(snapshot.updatedAt);
    if (snapshot.unclassifiedTaskCount > 0 && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      console.info(`${snapshot.unclassifiedTaskCount} tarefas de Projeto Padrão não foram incluídas no Gantt por não possuírem tipo e etapa válidos.`);
    }
    projectLoadState = PROJ_ALL.length ? 'success' : 'empty';
    applyProj();
  } catch (error) {
    console.error('Falha ao carregar a aba Projetos pelo Supabase.', error);
    PROJ_ALL = [];
    PROJECT_TASKS = [];
    PROJECT_TREE = [];
    projFiltered = [];
    document.getElementById('pCount').textContent = '0';
    document.getElementById('pTotal').textContent = '0';
    renderProjectSyncTime(null);
    renderProjectLoadState('error');
  }
}
function applyProj() {
  const st = document.getElementById('pStatus').value;
  const pr = document.getElementById('pPrazo').value;
  const cl = document.getElementById('pCliente').value;
  const sit = document.getElementById('pSit').value;
  const deIdx = +document.getElementById('pDe').value, ateIdx = +document.getElementById('pAte').value;
  const de = (window.pMonths && window.pMonths[Math.min(deIdx, ateIdx)]) || '';
  const ate = (window.pMonths && window.pMonths[Math.max(deIdx, ateIdx)]) || '';
  const se = document.getElementById('pSearch').value.trim().toLowerCase();
  projFiltered = PROJ_ALL.filter(d => {
    if (st && d.status !== st) return false;
    if (pr && d.prazo !== pr) return false;
    if (cl && d.cliente !== cl) return false;
    if (de && d.anoMes && d.anoMes < de) return false;
    if (ate && d.anoMes && d.anoMes > ate) return false;
    if (sit) {
      const s = sitFromDias(d.diasAte);
      if (sit === 'atrasado' && s !== 'atrasado') return false;
      if (sit === 'hoje' && s !== 'hoje') return false;
      if (sit === '7' && !(d.diasAte != null && d.diasAte >= 0 && d.diasAte <= 7)) return false;
      if (sit === '30' && !(d.diasAte != null && d.diasAte > 7 && d.diasAte <= 30)) return false;
      if (sit === 'ok' && !(d.diasAte != null && d.diasAte > 30)) return false;
    }
    if (se && !String(d.cliente).toLowerCase().includes(se) && !String(d.os).includes(se)) return false;
    return true;
  });
  document.getElementById('pCount').textContent = projFiltered.length;
  renderProj();
}
function renderProj() {
  const total = projFiltered.length;
  const fin = projFiltered.filter(d => d.status === 'Finalizado').length;
  const ab = projFiltered.filter(d => OPEN_OS.includes(d.status)).length;
  const atras = projFiltered.filter(d => d.diasAte != null && d.diasAte < 0 && d.status !== 'Finalizado').length;
  const em7 = projFiltered.filter(d => d.diasAte != null && d.diasAte >= 0 && d.diasAte <= 7 && d.status !== 'Finalizado').length;
  const cli = new Set(projFiltered.map(d => d.cliente)).size;
  const osSet = new Set(projFiltered.map(d => d.os));
  const linked = PROJECT_TASKS.filter(t => osSet.has(t.serviceOrderExternalId));
  const linkedFin = linked.filter(t => (t.status||'').toLowerCase() === 'finalizada').length;
  const diasAbertos = projFiltered.filter(d => d.status !== 'Finalizado' && d.diasAte != null).map(d => d.diasAte);
  const medDiasAte = diasAbertos.length ? [...diasAbertos].sort((a,b)=>a-b)[Math.floor(diasAbertos.length/2)] : null;
  const avgDiasCad = total ? projFiltered.reduce((s,d)=>s+(d.dias||0),0)/total : 0;

  document.getElementById('pKpis').innerHTML = `
    <div class="kpi"><div class="label">Projetos (OS)</div><div class="value">${total}</div></div>
    <div class="kpi green"><div class="label">Finalizados</div><div class="value">${fin}</div><div class="sub">${total?(fin/total*100).toFixed(0):0}%</div></div>
    <div class="kpi orange"><div class="label">Em aberto</div><div class="value">${ab}</div></div>
    <div class="kpi" style="border-left-color:#C62828"><div class="label">Atrasados</div><div class="value" style="color:#C62828">${atras}</div><div class="sub">prev. já passou</div></div>
    <div class="kpi" style="border-left-color:#E65100"><div class="label">Vencem em 7 dias</div><div class="value" style="color:#E65100">${em7}</div></div>
    <div class="kpi accent"><div class="label">Clientes</div><div class="value">${cli}</div></div>
    <div class="kpi purple"><div class="label">Tarefas vinculadas</div><div class="value">${linked.length}</div><div class="sub">${linkedFin} finalizadas</div></div>
    <div class="kpi"><div class="label">Mediana dias até fim</div><div class="value" style="font-size:1.1rem">${medDiasAte==null?'—':(medDiasAte+'d')}</div><div class="sub">só em aberto</div></div>
    <div class="kpi"><div class="label">Média dias desde cadastro</div><div class="value" style="font-size:1.1rem">${avgDiasCad.toFixed(0)}d</div></div>`;

  renderProjectGantt();
  return;

  const statusColors = {'Finalizado':'#1B7A4E','Em Serviço':'#1565C0','Agendado':'#6A1B9A','Pendente':'#C62828','Pausado':'#E65100','Cancelado':'#78909C'};
  const statusMap = countBy(projFiltered, 'status');
  if (charts.projStatus) charts.projStatus.destroy();
  charts.projStatus = new Chart(document.getElementById('cProjStatus'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusMap),
      datasets: [{
        data: Object.values(statusMap),
        backgroundColor: Object.keys(statusMap).map(function(l){ return statusColors[l] || '#94A3B8'; }),
        borderWidth: 3, borderColor: '#fff', hoverOffset: 8
      }]
    },
    options: {
      responsive: true, cutout: '62%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 11, font: { size: 10 } } } }
    }
  });

  // Situação vs previsão — polarArea
  const sitCount = { 'Atrasado':0, 'Hoje':0, '≤7 dias':0, '8–30 dias':0, '>30 dias':0, 'Sem data':0 };
  projFiltered.filter(function(d){ return d.status !== 'Finalizado'; }).forEach(function(d) {
    var s = sitFromDias(d.diasAte);
    if (s==='atrasado') sitCount['Atrasado']++;
    else if (s==='hoje') sitCount['Hoje']++;
    else if (s==='7') sitCount['≤7 dias']++;
    else if (s==='30') sitCount['8–30 dias']++;
    else if (s==='ok') sitCount['>30 dias']++;
    else sitCount['Sem data']++;
  });
  if (charts.projSit) charts.projSit.destroy();
  charts.projSit = new Chart(document.getElementById('cProjSit'), {
    type: 'bar',
    data: {
      labels: Object.keys(sitCount),
      datasets: [{
        label: 'Projetos em aberto',
        data: Object.values(sitCount),
        backgroundColor: ['#C62828','#E65100','#F9A825','#1565C0','#1B7A4E','#9E9E9E'],
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 28
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: function(ctx) {
              var vals = Object.values(sitCount);
              var t = vals.reduce(function(a,b){return a+b;},0);
              return t ? ((ctx.raw/t)*100).toFixed(1)+'% dos em aberto' : '';
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false } },
        y: { grid: { display: false }, border: { display: false } }
      }
    }
  });

  // Prazo — doughnut
  const prazoMap = countBy(projFiltered, 'prazo');
  if (charts.projPrazo) charts.projPrazo.destroy();
  charts.projPrazo = new Chart(document.getElementById('cProjPrazo'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(prazoMap),
      datasets: [{
        data: Object.values(prazoMap),
        backgroundColor: ['#C62828','#E65100','#1565C0','#1B7A4E'],
        borderWidth: 3, borderColor: '#fff', hoverOffset: 6
      }]
    },
    options: {
      responsive: true, cutout: '55%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 11, font: { size: 10 } } } }
    }
  });

  // Tipo de serviço — polarArea
  const tipoColors = ['#001098','#1565C0','#00897B','#6A1B9A','#E65100','#C62828','#F9A825'];
  const tp = Object.entries(countBy(projFiltered, 'tipoServico')).filter(function(e){ return e[0]; }).sort(function(a,b){ return b[1]-a[1]; });
  if (charts.projTipo) charts.projTipo.destroy();
  charts.projTipo = new Chart(document.getElementById('cProjTipo'), {
    type: 'bar',
    data: {
      labels: tp.map(function(e){ return e[0].length > 28 ? e[0].slice(0,26)+'…' : e[0]; }),
      datasets: [{
        label: 'OS',
        data: tp.map(function(e){ return e[1]; }),
        backgroundColor: tp.map(function(_, i) {
          var palette = ['#001098','#1565C0','#00897B','#6A1B9A','#E65100','#C62828','#F9A825'];
          return palette[i % palette.length];
        }),
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 26
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterLabel: function(ctx) {
              var t = tp.reduce(function(s,e){return s+e[1];},0);
              return t ? ((ctx.raw/t)*100).toFixed(1)+'% do total' : '';
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false } },
        y: { grid: { display: false }, border: { display: false } }
      }
    }
  });

  // Cadastros por mês — area line
  const tm = Object.entries(countBy(projFiltered, 'anoMes')).sort(function(a,b){ return a[0].localeCompare(b[0]); });
  if (charts.projTmp) charts.projTmp.destroy();
  charts.projTmp = new Chart(document.getElementById('cProjTemporal'), {
    type: 'line',
    data: {
      labels: tm.map(function(e){ return mesLabel(e[0]); }),
      datasets: [{
        data: tm.map(function(e){ return e[1]; }),
        borderColor: '#001098',
        backgroundColor: 'rgba(0,16,152,.15)',
        fill: true, tension: 0.4,
        pointRadius: 4, pointHoverRadius: 6,
        pointBackgroundColor: '#001098', pointBorderColor: '#fff', pointBorderWidth: 2,
        borderWidth: 2.5, label: 'Projetos'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { grid: { display: false } }
      }
    }
  });

  // Distribuição por cliente — doughnut
  const clTop = Object.entries(countBy(projFiltered, 'cliente')).sort(function(a,b){ return b[1]-a[1]; }).slice(0,8);
  const cliPalette = ['#001098','#1565C0','#00897B','#6A1B9A','#E65100','#C62828','#F9A825','#455A64'];
  if (charts.projCli) charts.projCli.destroy();
  charts.projCli = new Chart(document.getElementById('cProjCli'), {
    type: 'doughnut',
    data: {
      labels: clTop.map(function(e){ return e[0].length > 18 ? e[0].slice(0,16)+'…' : e[0]; }),
      datasets: [{
        data: clTop.map(function(e){ return e[1]; }),
        backgroundColor: clTop.map(function(_,i){ return cliPalette[i % cliPalette.length]; }),
        borderWidth: 3, borderColor: '#fff', hoverOffset: 8
      }]
    },
    options: {
      responsive: true, cutout: '50%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 9 } } } }
    }
  });

  // Linha do tempo — dias até previsão
  const sortedDias = projFiltered.filter(function(d){ return d.diasAte != null; }).slice().sort(function(a,b){ return a.diasAte - b.diasAte; });
  const labelsD = sortedDias.map(function(d){
    var c = d.cliente.length > 12 ? d.cliente.slice(0,10)+'…' : d.cliente;
    return '#'+d.os+' '+c;
  });
  const pointColors = sortedDias.map(function(d){
    if (d.status === 'Finalizado') return '#90A4AE';
    if (d.diasAte < 0) return '#C62828';
    if (d.diasAte <= 7) return '#E65100';
    if (d.diasAte <= 30) return '#1565C0';
    return '#1B7A4E';
  });
  if (charts.projDias) charts.projDias.destroy();
  charts.projDias = new Chart(document.getElementById('cProjDias'), {
    type: 'line',
    data: {
      labels: labelsD,
      datasets: [{
        label: 'Dias até prev. término',
        data: sortedDias.map(function(d){ return d.diasAte; }),
        borderColor: 'rgba(0,16,152,.35)',
        backgroundColor: 'transparent',
        pointBackgroundColor: pointColors,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 7,
        pointHoverRadius: 10,
        borderWidth: 1.5,
        tension: 0.15,
        fill: false
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var d = sortedDias[ctx.dataIndex];
              var v = d.diasAte;
              if (v < 0) return 'Atrasado · ' + d.status;
              if (v === 0) return 'Vence hoje · ' + d.status;
              return v + ' dias restantes · ' + d.status;
            }
          }
        }
      },
      scales: {
        y: { title: { display: true, text: 'Dias (negativo = atrasado)', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 9 } }, grid: { display: false } }
      }
    }
  });

  // Tarefas finalizadas × técnico — area stacked
  var techColorFn = function(name){ return TECH_COLOR_MAP[name] || '#78909C'; };
  var meses = [];
  linked.filter(function(t){ return t.anoMes; }).forEach(function(t){ if (meses.indexOf(t.anoMes)<0) meses.push(t.anoMes); });
  meses.sort();
  var techs = [];
  linked.forEach(function(t){ if (t.tecnico && techs.indexOf(t.tecnico)<0) techs.push(t.tecnico); });
  var finByMesTech = {};
  linked.filter(function(t){ return (t.status||'').toLowerCase()==='finalizada'; }).forEach(function(t) {
    if (!t.anoMes || !t.tecnico) return;
    var k = t.tecnico + '|' + t.anoMes;
    finByMesTech[k] = (finByMesTech[k]||0)+1;
  });
  if (charts.projTasksMes) charts.projTasksMes.destroy();
  charts.projTasksMes = new Chart(document.getElementById('cProjTasksMes'), {
    type: 'line',
    data: {
      labels: meses.map(mesLabel),
      datasets: techs.map(function(tech) {
        var hex = techColorFn(tech);
        var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return {
          label: tech,
          data: meses.map(function(m){ return finByMesTech[tech+'|'+m] || 0; }),
          borderColor: hex,
          backgroundColor: 'rgba('+r+','+g+','+b+',0.18)',
          fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2
        };
      })
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } },
      scales: {
        y: { beginAtZero: true, stacked: true, ticks: { precision: 0 }, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { stacked: true, grid: { display: false } }
      }
    }
  });

  renderPTable();
  rankLocalidades('Projeto', 'pLocBody');
}

const GANTT_SERVICE_ICONS = { AUT:'⌁', AAV:'◉', RED:'⌘', SEG:'◆', FIN:'$', ONB:'↗', VTE:'◇' };
const ganttOpenRows = new Set();
let ganttInitialized = false;
let ganttScale = 'month';

function ganttEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}
function ganttDate(value) {
  if (!value) return null;
  const d = new Date(String(value).slice(0,10) + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}
function ganttDayDiff(a, b) { return Math.round((b - a) / 86400000); }
function ganttDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function ganttBrazilHoliday(date) {
  const holidays = {
    '01-01':'Confraternização Universal', '04-21':'Tiradentes',
    '05-01':'Dia Mundial do Trabalho', '09-07':'Independência do Brasil',
    '10-12':'Nossa Senhora Aparecida', '11-02':'Finados',
    '11-15':'Proclamação da República',
    '11-20':'Dia Nacional de Zumbi e da Consciência Negra', '12-25':'Natal'
  };
  return holidays[ganttDateKey(date).slice(5)] || '';
}
function ganttCalendarHighlights(timelineStart, totalDays, dayWidth) {
  const highlights = [];
  for (let offset = 0; offset < totalDays; offset++) {
    const date = new Date(timelineStart);
    date.setDate(date.getDate() + offset);
    const holiday = ganttBrazilHoliday(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    if (!holiday && !weekend) continue;
    const description = holiday || (date.getDay() === 6 ? 'Sábado' : 'Domingo');
    highlights.push(`<span class="gantt-calendar-highlight${holiday?' holiday':''}${weekend?' weekend':''}" style="left:${offset * dayWidth}px;width:${dayWidth}px" title="${ganttEscape(description + ' · ' + date.toLocaleDateString('pt-BR'))}"></span>`);
  }
  return highlights.join('');
}
function ganttCompletion(tasks) {
  if (!tasks || !tasks.length) return 0;
  const completed = tasks.filter(task => task.ganttStatus === 'Finalizado').length;
  return Math.round(completed / tasks.length * 100);
}
function ganttProgressTooltip() {
  let tooltip = document.getElementById('ganttProgressTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'ganttProgressTooltip';
    tooltip.className = 'gantt-progress-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
  }
  return tooltip;
}
function showGanttProgressTooltip(bar, event) {
  const tooltip = ganttProgressTooltip();
  tooltip.textContent = bar.dataset.progress || '';
  tooltip.classList.add('visible');
  const rect = bar.getBoundingClientRect();
  const pointerX = event && Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2;
  const pointerY = event && Number.isFinite(event.clientY) ? event.clientY : rect.top;
  const margin = 12;
  const x = Math.min(window.innerWidth - tooltip.offsetWidth - 8, Math.max(8, pointerX + margin));
  const y = pointerY - tooltip.offsetHeight - margin >= 8
    ? pointerY - tooltip.offsetHeight - margin
    : pointerY + margin;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
function hideGanttProgressTooltip() {
  const tooltip = document.getElementById('ganttProgressTooltip');
  if (tooltip) tooltip.classList.remove('visible');
}
function ganttTaskLabel(task) {
  return task.name || 'Tarefa sem nome';
}
function ganttStatus(task) {
  const styles = { Planejada:'planned', Andamento:'progress', Bloqueado:'blocked', Finalizado:'done', Atrasada:'late' };
  return styles[task.ganttStatus] || 'planned';
}
function ganttTaskVisible(task) {
  return task.ganttStatus !== null;
}
function ganttTaskStart(task) { return ganttDate(task.startAt || task.plannedAt) || ganttDate(task.orderPlannedStartOn); }
function ganttTaskEnd(task) { return ganttDate(task.endAt || task.plannedAt) || ganttDate(task.orderPlannedEndOn); }
function ganttRange(items, fallbackStart, fallbackEnd) {
  const starts = items.map(ganttTaskStart).filter(Boolean);
  const ends = items.map(ganttTaskEnd).filter(Boolean);
  return {
    start: starts.length ? new Date(Math.min.apply(null, starts)) : fallbackStart,
    end: ends.length ? new Date(Math.max.apply(null, ends)) : fallbackEnd
  };
}
function buildGanttTree() {
  const activeOrderIds = new Set(projFiltered.filter(d => OPEN_OS.includes(d.status)).map(d => d.databaseId));
  return PROJECT_TREE.map(client => {
    const projects = client.projects.filter(project => activeOrderIds.has(project.id));
    const projectIds = new Set(projects.map(project => project.id));
    const tasks = client.tasks.filter(task => projectIds.has(task.serviceOrderId) && ganttTaskVisible(task));
    const services = client.services.map(service => {
      const serviceTasks = service.tasks.filter(task => projectIds.has(task.serviceOrderId) && ganttTaskVisible(task));
      return {
        code: service.typeCode,
        label: service.typeName,
        icon: GANTT_SERVICE_ICONS[service.typeCode] || '•',
        tasks: serviceTasks,
        stages: service.stages.map(stage => ({
          stage: stage.name,
          tasks: stage.tasks.filter(task => projectIds.has(task.serviceOrderId) && ganttTaskVisible(task))
        })).filter(stage => stage.tasks.length)
      };
    }).filter(service => service.tasks.length);
    return { name: client.client, projects, tasks, services };
  }).filter(client => client.projects.length)
    .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
}
function ganttToggle(id) {
  const scroll = document.querySelector('#projectGantt .gantt-scroll');
  const position = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
  if (ganttOpenRows.has(id)) ganttOpenRows.delete(id); else ganttOpenRows.add(id);
  renderProjectGantt();
  const nextScroll = document.querySelector('#projectGantt .gantt-scroll');
  if (nextScroll && position) { nextScroll.scrollLeft = position.left; nextScroll.scrollTop = position.top; }
}
function setGanttScale(btn) {
  ganttScale = ['month','week','day'].includes(btn.dataset.ganttScale) ? btn.dataset.ganttScale : 'month';
  document.querySelectorAll('[data-gantt-scale]').forEach(el => el.classList.toggle('active', el.dataset.ganttScale === ganttScale));
  renderProjectGantt();
}
function ganttBar(range, timelineStart, totalDays, status, label, completion) {
  if (!range.start || !range.end) return '';
  const from = Math.max(0, ganttDayDiff(timelineStart, range.start));
  const to = Math.min(totalDays - 1, ganttDayDiff(timelineStart, range.end));
  if (to < 0 || from >= totalDays) return '';
  const left = from / totalDays * 100;
  const width = Math.max(0.45, (Math.max(from, to) - from + 1) / totalDays * 100);
  const percentage = Math.max(0, Math.min(100, Number(completion) || 0));
  return `<span class="gantt-bar ${status}" style="left:${left}%;width:${width}%" data-progress="${percentage}% concluído" aria-label="${ganttEscape(label + ' · ' + percentage + '% concluído')}" tabindex="0" onpointerenter="showGanttProgressTooltip(this,event)" onpointermove="showGanttProgressTooltip(this,event)" onpointerleave="hideGanttProgressTooltip()" onfocus="showGanttProgressTooltip(this)" onblur="hideGanttProgressTooltip()"></span>`;
}
function renderProjectGantt() {
  const host = document.getElementById('projectGantt');
  if (!host) return;

  if(projectLoadState === 'loading' || projectLoadState === 'error') return;

  const clients = buildGanttTree();
  if (!clients.length) {
    host.innerHTML = '<div class="gantt-empty">Nenhum projeto ativo encontrado para os filtros selecionados.</div>';
    return;
  }
  if (!ganttInitialized) {
    ganttOpenRows.add('client-0');
    ganttInitialized = true;
  }
  const allProjects = clients.flatMap(c => c.projects);
  const allTasks = clients.flatMap(c => c.tasks);
  const categorizedTasks = clients.flatMap(c => c.services.flatMap(s => s.tasks));
  const dates = allProjects.flatMap(p => [ganttDate(p.plannedStartOn || p.registeredOn), ganttDate(p.plannedEndOn)]).concat(
    allTasks.flatMap(t => [ganttTaskStart(t), ganttTaskEnd(t)])
  ).filter(Boolean);
  if(!dates.length) {
    host.innerHTML = '<div class="gantt-empty">Os projetos carregados não possuem datas para exibir no cronograma.</div>';
    return;
  }
  let timelineStart = new Date(Math.min.apply(null, dates));
  let timelineEnd = new Date(Math.max.apply(null, dates));
  timelineStart.setDate(timelineStart.getDate() - 3);
  timelineEnd.setDate(timelineEnd.getDate() + 3);
  const totalDays = Math.max(1, ganttDayDiff(timelineStart, timelineEnd) + 1);
  const dayWidth = ganttScale === 'day' ? 62 : ganttScale === 'week' ? (totalDays > 240 ? 16 : 24) : (totalDays > 240 ? 10 : totalDays > 120 ? 14 : 22);
  const timelineWidth = Math.max(760, totalDays * dayWidth);
  const periods = [];
  let cursor = new Date(timelineStart);
  while (cursor <= timelineEnd) {
    let key, label;
    if (ganttScale === 'day') {
      key = cursor.toISOString().slice(0,10);
      label = cursor.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.', '') + '|' + cursor.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    } else if (ganttScale === 'week') {
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      key = weekStart.toISOString().slice(0,10);
      label = `${weekStart.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})} – ${weekEnd.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}`;
    } else {
      key = cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0');
      label = cursor.toLocaleDateString('pt-BR',{month:'short',year:'numeric'});
    }
    let item = periods.find(p => p.key === key);
    if (!item) { item = { key, label, days:0 }; periods.push(item); }
    item.days++;
    cursor.setDate(cursor.getDate()+1);
  }
  const rows = [];
  clients.forEach((client, ci) => {
    const clientId = 'client-' + ci;
    const clientOpen = ganttOpenRows.has(clientId);
    const clientStarts = client.projects.map(p => ganttDate(p.plannedStartOn || p.registeredOn)).filter(Boolean);
    const clientEnds = client.projects.map(p => ganttDate(p.plannedEndOn)).filter(Boolean);
    const fallbackStart = clientStarts.length ? new Date(Math.min.apply(null, clientStarts)) : null;
    const fallbackEnd = clientEnds.length ? new Date(Math.max.apply(null, clientEnds)) : fallbackStart;
    const cr = ganttRange(client.tasks, fallbackStart, fallbackEnd);
    rows.push({ id:clientId, level:0, open:clientOpen, expandable:true, kind:'client', label:client.name, meta:`${client.projects.length} OS · ${client.tasks.length} tarefas`, range:cr, status:'progress', completion:ganttCompletion(client.tasks) });
    if (!clientOpen) return;
    if (!client.services.length && client.tasks.length) {
      rows.push({ id:clientId + '-unclassified', level:1, kind:'note', label:'Nenhuma tarefa classificada (tipo de serviço/etapa) para este cliente.' });
    }
    client.services.forEach((service, si) => {
      const serviceId = clientId + '-service-' + si;
      const serviceOpen = ganttOpenRows.has(serviceId);
      rows.push({ id:serviceId, level:1, open:serviceOpen, expandable:true, kind:'service', icon:service.icon, label:service.label, meta:`${service.tasks.length} tarefas`, range:ganttRange(service.tasks,cr.start,cr.end), status:'progress', completion:ganttCompletion(service.tasks) });
      if (!serviceOpen) return;
      service.stages.forEach((stage, sti) => {
        const stageId = serviceId + '-stage-' + sti;
        const stageOpen = ganttOpenRows.has(stageId);
        rows.push({ id:stageId, level:2, open:stageOpen, expandable:true, kind:'stage', label:stage.stage, meta:`${stage.tasks.length}`, range:ganttRange(stage.tasks,cr.start,cr.end), status:'planned', completion:ganttCompletion(stage.tasks) });
        if (!stageOpen) return;
        stage.tasks.slice().sort((a,b) => String(a.plannedAt || '').localeCompare(String(b.plannedAt || ''))).forEach(task => {
          const start = ganttTaskStart(task);
          const end = ganttTaskEnd(task) || start;
          const mappedStatus = task.ganttStatus;
          rows.push({ level:3, kind:'task', label:ganttTaskLabel(task), meta:`OS ${task.serviceOrderExternalId}`, technician:task.technician, mappedStatus, range:{start,end}, status:ganttStatus(task), completion:ganttCompletion([task]), task });
        });
      });
    });
  });
  const periodHeader = periods.map(period => {
    const label = ganttScale === 'day'
      ? `<b>${ganttEscape(period.label.split('|')[0])}</b><small>${ganttEscape(period.label.split('|')[1])}</small>`
      : ganttEscape(period.label);
    return `<span class="gantt-period-${ganttScale}" style="width:${period.days * dayWidth}px">${label}</span>`;
  }).join('');
  const calendarHighlights = ganttCalendarHighlights(timelineStart, totalDays, dayWidth);
  const calendarHeaderHighlights = ganttScale === 'day' ? calendarHighlights : '';
  const body = rows.map(row => {
    if (row.kind === 'note') {
      return `<div class="gantt-row gantt-note">
      <div class="gantt-name level-${row.level}"><span class="gantt-task-mark"></span><span class="gantt-name-copy"><small>${ganttEscape(row.label)}</small></span></div>
      <div class="gantt-track" style="width:${timelineWidth}px"></div>
    </div>`;
    }
    const toggle = row.expandable ? `onclick="ganttToggle('${row.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ganttToggle('${row.id}')}" role="button" tabindex="0" aria-expanded="${row.open}"` : '';
    const arrow = row.expandable ? `<span class="gantt-chevron ${row.open?'open':''}">›</span>` : '<span class="gantt-task-mark"></span>';
    const icon = row.kind === 'client' ? '<span class="gantt-folder">▰</span>' : row.icon ? `<span class="gantt-service-icon">${row.icon}</span>` : '';
    const barLabel = `${row.label}: ${row.range.start?fmtDate(row.range.start.toISOString().slice(0,10)):'—'} – ${row.range.end?fmtDate(row.range.end.toISOString().slice(0,10)):'—'}`;
    const rowMeta = row.kind === 'task'
      ? `${ganttEscape(row.meta)}${row.technician?` <span class="gantt-meta-separator">·</span> ${ganttEscape(row.technician)}`:''} <span class="gantt-meta-separator">·</span> <span class="gantt-task-status ${row.status}">${ganttEscape(row.mappedStatus)}</span>`
      : ganttEscape(row.meta||'');
    return `<div class="gantt-row gantt-${row.kind}">
      <div class="gantt-name level-${row.level}" ${toggle}>${arrow}${icon}<span class="gantt-name-copy"><strong title="${ganttEscape(row.label)}">${ganttEscape(row.label)}</strong><small>${rowMeta}</small></span></div>
      <div class="gantt-track" style="width:${timelineWidth}px"><span class="gantt-calendar-layer">${calendarHighlights}</span>${ganttBar(row.range,timelineStart,totalDays,row.status,barLabel,row.completion)}</div>
    </div>`;
  }).join('');
  const today = new Date(); today.setHours(12,0,0,0);
  const todayOffset = ganttDayDiff(timelineStart, today);
  const todayLine = todayOffset >= 0 && todayOffset < totalDays ? `<span class="gantt-today" style="left:calc(var(--gantt-label-width) + ${(todayOffset + .5) * dayWidth}px)"><i>Hoje</i></span>` : '';
  host.innerHTML = `<div class="gantt-summary"><strong>${clients.length}</strong> clientes ativos <span>·</span> <strong>${allProjects.length}</strong> projetos <span>·</span> <strong>${categorizedTasks.length}</strong> tarefas categorizadas${allTasks.length>categorizedTasks.length?` <span>·</span> ${allTasks.length-categorizedTasks.length} tarefas sem serviço compatível`:''}</div>
    <div class="gantt-scroll">
      <div class="gantt-grid" style="--gantt-width:${timelineWidth}px;--gantt-day-width:${dayWidth}px">
        ${todayLine}
        <div class="gantt-header"><div class="gantt-header-name">Cliente / Serviço / Etapa / Tarefa</div><div class="gantt-months" style="width:${timelineWidth}px">${periodHeader}${calendarHeaderHighlights ? `<span class="gantt-calendar-layer">${calendarHeaderHighlights}</span>` : ''}</div></div>
        <div class="gantt-rows">${body}</div>
      </div>
    </div>`;
}
function getPTableData() {
  let data = [...projFiltered];
  if (pView === 'abertas') data = data.filter(d => OPEN_OS.includes(d.status));
  else if (pView === 'atrasados') data = data.filter(d => d.diasAte != null && d.diasAte < 0 && d.status !== 'Finalizado');
  else if (pView === 'finalizadas') data = data.filter(d => d.status === 'Finalizado');
  data.sort((a,b) => {
    let va=a[pSort.key], vb=b[pSort.key];
    if (va==null) va = pSort.asc ? Infinity : -Infinity;
    if (vb==null) vb = pSort.asc ? Infinity : -Infinity;
    if (typeof va==='string') va=va.toLowerCase(); if (typeof vb==='string') vb=vb.toLowerCase();
    if (va<vb) return pSort.asc?-1:1; if (va>vb) return pSort.asc?1:-1; return 0;
  });
  return data;
}
function renderPTable() {
  const data = getPTableData();
  const tb = document.getElementById('pBody');
  if (!data.length) { tb.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:20px;color:#999">Nenhum projeto</td></tr>'; return; }
  tb.innerHTML = data.map(d => {
    const st = tasksStatsOs(d.os);
    const pct = st.pct==null ? '—' : st.pct.toFixed(0)+'%';
    return `<tr>
      <td class="sticky-col" title="${d.cliente}"><strong>${d.cliente.length>26?d.cliente.slice(0,24)+'…':d.cliente}</strong></td>
      <td><strong>${d.os}</strong></td>
      <td>${statusBadge(d.status)}</td>
      <td>${prazoBadge(d.prazo)}</td>
      <td title="${d.tipoServico||''}">${(d.tipoServico||'—').length>18?(d.tipoServico||'').slice(0,16)+'…':(d.tipoServico||'—')}</td>
      <td>${fmtDate(d.cadastro)}</td>
      <td>${fmtDate(d.prevInicio)}</td>
      <td>${fmtDate(d.prevTermino)}</td>
      <td>${sitBadge(d.diasAte)}</td>
      <td style="text-align:right;font-weight:600">${d.dias}</td>
      <td style="text-align:center">${st.total}</td>
      <td style="text-align:center">${st.fin}</td>
      <td style="text-align:center;font-weight:600">${pct}</td>
    </tr>`;
  }).join('');
}
function sortP(k) { if (pSort.key===k) pSort.asc=!pSort.asc; else { pSort.key=k; pSort.asc=true; } renderPTable(); }
function setPView(btn) {
  document.querySelectorAll('#panel-projetos .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active'); pView = btn.dataset.view; renderPTable();
}


function initOS() {
  fillSelect('osStatus', OS_DATA.map(d=>d.status));
  fillSelect('osPrazo', OS_DATA.map(d=>d.prazo));
  fillSelect('osOcorrencia', OS_DATA.map(d=>d.ocorrencia));
  fillSelect('osCliente', OS_DATA.map(d=>d.cliente));
  window.osMonths = [...new Set(OS_DATA.map(d=>d.anoMes).filter(Boolean))].sort();
  const osDe = document.getElementById('osDe'), osAte = document.getElementById('osAte');
  osDe.min = 0; osDe.max = Math.max(0, window.osMonths.length - 1); osDe.value = 0;
  osAte.min = 0; osAte.max = Math.max(0, window.osMonths.length - 1); osAte.value = osAte.max;
  updateOsRangeUI();
  document.getElementById('osTotal').textContent=OS_DATA.length;
}
function applyOS() {
  const st=document.getElementById('osStatus').value, pr=document.getElementById('osPrazo').value;
  const oc=document.getElementById('osOcorrencia').value, cl=document.getElementById('osCliente').value;
  const deIdx = +document.getElementById('osDe').value, ateIdx = +document.getElementById('osAte').value;
  const de = (window.osMonths && window.osMonths[Math.min(deIdx, ateIdx)]) || '';
  const ate = (window.osMonths && window.osMonths[Math.max(deIdx, ateIdx)]) || '';
  const se=document.getElementById('osSearch').value.trim().toLowerCase();
  osFiltered=OS_DATA.filter(d=>{
    if(st&&d.status!==st) return false; if(pr&&d.prazo!==pr) return false;
    if(oc&&d.ocorrencia!==oc) return false; if(cl&&d.cliente!==cl) return false;
    if(de && d.anoMes && d.anoMes < de) return false;
    if(ate && d.anoMes && d.anoMes > ate) return false;
    if(se&&!String(d.cliente).toLowerCase().includes(se)&&!String(d.os).includes(se)&&!String(d.ocorrencia).toLowerCase().includes(se)) return false;
    return true;
  });
  document.getElementById('osCount').textContent=osFiltered.length; renderOS();
}
function renderOS() {
  const total=osFiltered.length, fin=osFiltered.filter(d=>d.status==='Finalizado').length;
  const ab=osFiltered.filter(d=>OPEN_OS.includes(d.status)).length, taxa=total?(fin/total*100):0;
  const cli=new Set(osFiltered.map(d=>d.cliente)).size;
  const critAb=osFiltered.filter(d=>OPEN_OS.includes(d.status)&&d.prazo==='Prazo crítico').length;
  const dias=osFiltered.map(d=>d.dias).filter(x=>x>=0).sort((a,b)=>a-b);
  const med=dias.length?dias[Math.floor(dias.length/2)]:0;
  document.getElementById('osKpis').innerHTML=`
    <div class="kpi"><div class="label">Total OS</div><div class="value">${total}</div></div>
    <div class="kpi green"><div class="label">Finalizadas</div><div class="value">${fin}</div><div class="sub">${taxa.toFixed(1)}%</div></div>
    <div class="kpi orange"><div class="label">Em Aberto</div><div class="value">${ab}</div></div>
    <div class="kpi green"><div class="label">Taxa Conclusão</div><div class="value">${taxa.toFixed(1)}%</div></div>
    <div class="kpi accent"><div class="label">Clientes</div><div class="value">${cli}</div></div>
    <div class="kpi red"><div class="label">Crítico Aberto</div><div class="value">${critAb}</div></div>
    <div class="kpi"><div class="label">Tempo Mediano</div><div class="value">${med}<span style="font-size:.8rem">d</span></div></div>`;
  const crit=osFiltered.filter(d=>OPEN_OS.includes(d.status)&&d.prazo==='Prazo crítico').sort((a,b)=>b.dias-a.dias).slice(0,12);
  const venc=osFiltered.filter(d=>OPEN_OS.includes(d.status)&&d.prevTermino&&new Date(d.prevTermino)<TODAY).sort((a,b)=>new Date(a.prevTermino)-new Date(b.prevTermino)).slice(0,12);
  const lh=arr=>arr.length?arr.map(d=>`<div class="priority-item"><span class="os-num">#${d.os}</span><span class="cli">${d.cliente}</span>${statusBadge(d.status)}<span class="dias">${d.dias}d</span></div>`).join(''):'<div style="padding:10px;color:#999">Nenhuma</div>';
  document.getElementById('osCrit').innerHTML=lh(crit); document.getElementById('osVencida').innerHTML=lh(venc);
  const st=countBy(osFiltered,'status'), stL=Object.keys(st), stD=Object.values(st);
  const stC={'Finalizado':'#1B7A4E','Em Serviço':'#1565C0','Agendado':'#6A1B9A','Pendente':'#C62828','Pausado':'#E65100','Cancelado':'#78909C','Aguardando progresso de obra':'#F9A825'};
  if(charts.osStatus) charts.osStatus.destroy();
  charts.osStatus=new Chart(document.getElementById('cOsStatus'),{type:'doughnut',data:{labels:stL,datasets:[{data:stD,backgroundColor:stL.map(l=>stC[l]||'#999'),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,plugins:{legend:{position:'right',labels:{boxWidth:11,font:{size:10}}}},onClick:(e,els)=>{if(els.length){document.getElementById('osStatus').value=stL[els[0].index];applyOS();}}}});
  const oc=Object.entries(countBy(osFiltered,'ocorrencia')).sort((a,b)=>b[1]-a[1]);
  if(charts.osOcorr) charts.osOcorr.destroy();
  charts.osOcorr=new Chart(document.getElementById('cOsOcorr'),{type:'bar',data:{labels:oc.map(e=>e[0].length>20?e[0].slice(0,18)+'…':e[0]),datasets:[{data:oc.map(e=>e[1]),backgroundColor:TEC_COLORS,borderRadius:3,label:'Qtd'}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}}},onClick:(e,els)=>{if(els.length){document.getElementById('osOcorrencia').value=oc[els[0].index][0];applyOS();}}}});
  const cl=Object.entries(countBy(osFiltered,'cliente')).sort((a,b)=>b[1]-a[1]).slice(0,12);
  if(charts.osCli) charts.osCli.destroy();
  charts.osCli=new Chart(document.getElementById('cOsClientes'),{type:'bar',data:{labels:cl.map(e=>e[0].length>18?e[0].slice(0,16)+'…':e[0]),datasets:[{data:cl.map(e=>e[1]),backgroundColor:BRAND,borderRadius:3,label:'OS'}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}}},onClick:(e,els)=>{if(els.length){document.getElementById('osCliente').value=cl[els[0].index][0];applyOS();}}}});
  const tm=Object.entries(countBy(osFiltered,'anoMes')).sort((a,b)=>a[0].localeCompare(b[0]));
  if(charts.osTmp) charts.osTmp.destroy();
  charts.osTmp=new Chart(document.getElementById('cOsTemporal'),{
    type:'line',
    data:{labels:tm.map(e=>mesLabel(e[0])),datasets:[{
      data:tm.map(e=>e[1]), borderColor:BRAND, backgroundColor:'rgba(0,16,152,.18)',
      fill:true, tension:.4, pointRadius:4, pointHoverRadius:7,
      pointBackgroundColor:BRAND, pointBorderColor:'#fff', pointBorderWidth:2,
      borderWidth:2.5, label:'OS cadastradas'
    }]},
    options:{
      responsive:true,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:ctx=>' '+ctx.parsed.y+' OS'}}},
      scales:{
        y:{beginAtZero:true, ticks:{precision:0}, grid:{color:'rgba(0,0,0,.05)'}, border:{display:false}},
        x:{grid:{display:false}, border:{display:false}}
      }
    }
  });
  renderOsTable();
}
function getOsTableData() {
  let data=[...osFiltered];
  if(osView==='abertas') data=data.filter(d=>OPEN_OS.includes(d.status));
  else if(osView==='criticas') data=data.filter(d=>OPEN_OS.includes(d.status)&&d.prazo==='Prazo crítico');
  else if(osView==='vencidas') data=data.filter(d=>OPEN_OS.includes(d.status)&&d.prevTermino&&new Date(d.prevTermino)<TODAY);
  data.sort((a,b)=>{let va=a[osSort.key],vb=b[osSort.key]; if(typeof va==='string')va=va.toLowerCase(); if(typeof vb==='string')vb=vb.toLowerCase(); if(va<vb)return osSort.asc?-1:1; if(va>vb)return osSort.asc?1:-1; return 0;});
  return data;
}
function renderOsTable() {
  const data=getOsTableData(), tb=document.getElementById('osBody');
  if(!data.length){tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:#999">Nenhuma OS</td></tr>'; return;}
  tb.innerHTML=data.slice(0,300).map(d=>`<tr>
      <td class="sticky-col" title="${d.cliente}"><strong>${d.cliente.length>28?d.cliente.slice(0,26)+'…':d.cliente}</strong></td>
      <td><strong>${d.os}</strong></td><td>${statusBadge(d.status)}</td><td>${prazoBadge(d.prazo)}</td>
      <td title="${d.ocorrencia}">${d.ocorrencia.length>22?d.ocorrencia.slice(0,20)+'…':d.ocorrencia}</td>
      <td>${fmtDate(d.cadastro)}</td><td>${fmtDate(d.prevTermino)}</td>
      <td style="text-align:right;font-weight:600">${d.dias}</td></tr>`).join('');
}
function sortOs(k){if(osSort.key===k)osSort.asc=!osSort.asc; else{osSort.key=k;osSort.asc=true;} renderOsTable();}
function setOsView(btn){document.querySelectorAll('#panel-os .tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); osView=btn.dataset.view; renderOsTable();}

/* ========== TAREFAS — com responsáveis + auxiliares ========== */
function allPeopleFromTasks() {
  const s=new Set();
  TASK_DATA.forEach(d=>{ d.participantes.forEach(p=>s.add(p)); });
  return [...s];
}
function initTasks() {
  fillSelect('tStatus', TASK_DATA.map(d=>d.status));
  fillSelect('tTecnico', allPeopleFromTasks());
  fillSelect('tCliente', TASK_DATA.map(d=>d.cliente));
  window.tMonths = [...new Set(TASK_DATA.map(d=>d.anoMes).filter(Boolean))].sort();
  const tDe = document.getElementById('tDe'), tAte = document.getElementById('tAte');
  tDe.min = 0; tDe.max = Math.max(0, window.tMonths.length - 1); tDe.value = 0;
  tAte.min = 0; tAte.max = Math.max(0, window.tMonths.length - 1); tAte.value = tAte.max;
  updateTRangeUI();
  // Só as 5 categorias oficiais, com nomes completos
  const catCodes = [...new Set(TASK_DATA.map(d => normalizeCat(d.categoria)).filter(Boolean))].sort();
  const catEl = document.getElementById('tCat');
  const catCur = catEl.value;
  catEl.innerHTML = '<option value="">Todas</option>';
  catCodes.forEach(code => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = catLabel(code);
    catEl.appendChild(o);
  });
  if ([...catEl.options].some(o => o.value === catCur)) catEl.value = catCur;
  document.getElementById('tTotal').textContent=TASK_DATA.length;
}
function applyTasks() {
  const st=document.getElementById('tStatus').value, te=document.getElementById('tTecnico').value;
  const cl=document.getElementById('tCliente').value;
  const deIdx = +document.getElementById('tDe').value, ateIdx = +document.getElementById('tAte').value;
  const de = (window.tMonths && window.tMonths[Math.min(deIdx, ateIdx)]) || '';
  const ate = (window.tMonths && window.tMonths[Math.max(deIdx, ateIdx)]) || '';
  const ca=document.getElementById('tCat').value;
  const se=document.getElementById('tSearch').value.trim().toLowerCase();
  tFiltered=TASK_DATA.filter(d=>{
    if(st&&d.status!==st) return false;
    if(te&&!d.participantes.includes(te)) return false;
    if(cl&&d.cliente!==cl) return false;
    if(de && d.anoMes && d.anoMes < de) return false;
    if(ate && d.anoMes && d.anoMes > ate) return false;
    if(ca&&normalizeCat(d.categoria)!==ca) return false;
    if(se&&!String(d.nome).toLowerCase().includes(se)&&!String(d.os).includes(se)&&!String(d.cliente).toLowerCase().includes(se)&&!d.participantes.some(p=>p.toLowerCase().includes(se))) return false;
    return true;
  });
  document.getElementById('tCount').textContent=tFiltered.length;
  renderTasks();
}

/** Conta participações: cada pessoa (resp ou aux) em cada tarefa */
function computeParticipation(tasks) {
  const stats = {}; // name -> {resp, aux, finResp, finAux}
  tasks.forEach(d => {
    const isFin = d.status === 'Finalizada';
    if (d.tecnico) {
      if (!stats[d.tecnico]) stats[d.tecnico] = {resp:0, aux:0, finResp:0, finAux:0};
      stats[d.tecnico].resp++;
      if (isFin) stats[d.tecnico].finResp++;
    }
    (d.auxiliares||[]).forEach(a => {
      if (!a || a === d.tecnico) return;
      if (!stats[a]) stats[a] = {resp:0, aux:0, finResp:0, finAux:0};
      stats[a].aux++;
      if (isFin) stats[a].finAux++;
    });
  });
  return stats;
}

function renderTasks() {
  const total=tFiltered.length, fin=tFiltered.filter(d=>d.status==='Finalizada').length;
  const ab=tFiltered.filter(d=>OPEN_TASK.includes(d.status)).length, taxa=total?(fin/total*100):0;
  const stats=computeParticipation(tFiltered);
  const tecs=Object.keys(stats).length;
  const oss=new Set(tFiltered.map(d=>d.os)).size;
  const totalResp=Object.values(stats).reduce((s,v)=>s+v.resp,0);

  document.getElementById('tKpis').innerHTML=`
    <div class="kpi"><div class="label">Total Tarefas</div><div class="value">${total}</div></div>
    <div class="kpi green"><div class="label">Finalizadas</div><div class="value">${fin}</div><div class="sub">${taxa.toFixed(1)}%</div></div>
    <div class="kpi orange"><div class="label">Em Aberto</div><div class="value">${ab}</div></div>
    <div class="kpi accent"><div class="label">Técnicos envolvidos</div><div class="value">${tecs}</div></div>
    <div class="kpi purple"><div class="label">Como Responsável</div><div class="value">${totalResp}</div><div class="sub">tarefas atribuídas</div></div>
    <div class="kpi"><div class="label">OS Relacionadas</div><div class="value">${oss}</div></div>`;

  // Ranking por responsável (ordenado por total como resp)
  const sortedResp=Object.entries(stats).filter(([,s])=>s.resp>0).sort((a,b)=>b[1].resp-a[1].resp);
  // Ranking por auxiliar
  const sortedAux=Object.entries(stats).filter(([,s])=>s.aux>0).sort((a,b)=>b[1].aux-a[1].aux);

  // Chart: Ranking Responsável (horizontal bar, distinct colors)
  if(charts.rankResp) charts.rankResp.destroy();
  charts.rankResp=new Chart(document.getElementById('cRankResp'),{
    type:'bar',
    data:{
      labels: sortedResp.map(e=>e[0]),
      datasets:[{
        label:'Tarefas como Responsável',
        data: sortedResp.map(e=>e[1].resp),
        backgroundColor: sortedResp.map((e,i)=>techColor(e[0], i)),
        borderRadius:6, maxBarThickness:22, borderSkipped:false
      }]
    },
    options:{
      indexAxis:'y', responsive:true,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{afterLabel:function(ctx){ var s=sortedResp[ctx.dataIndex][1]; return 'Finalizadas: '+s.finResp; }}}
      },
      scales:{
        x:{beginAtZero:true, ticks:{precision:0}, grid:{color:'rgba(0,0,0,.05)'}, border:{display:false}},
        y:{grid:{display:false}, border:{display:false}}
      },
      onClick:(e,els)=>{if(els.length){document.getElementById('tTecnico').value=sortedResp[els[0].index][0]; applyTasks();}}
    }
  });

  // Chart: Ranking Auxiliar
  if(charts.rankAux) charts.rankAux.destroy();
  charts.rankAux=new Chart(document.getElementById('cRankAux'),{
    type:'bar',
    data:{
      labels: sortedAux.map(e=>e[0]),
      datasets:[{
        label:'Tarefas como Auxiliar',
        data: sortedAux.map(e=>e[1].aux),
        backgroundColor: sortedAux.map((e,i)=>techColor(e[0], i)),
        borderRadius:6, maxBarThickness:22, borderSkipped:false
      }]
    },
    options:{
      indexAxis:'y', responsive:true,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{afterLabel:function(ctx){ var s=sortedAux[ctx.dataIndex][1]; return 'Finalizadas: '+s.finAux; }}}
      },
      scales:{
        x:{beginAtZero:true, ticks:{precision:0}, grid:{color:'rgba(0,0,0,.05)'}, border:{display:false}},
        y:{grid:{display:false}, border:{display:false}}
      },
      onClick:(e,els)=>{if(els.length){document.getElementById('tTecnico').value=sortedAux[els[0].index][0]; applyTasks();}}
    }
  });

  // Status doughnut
  const st=countBy(tFiltered,'status'), stL=Object.keys(st), stD=Object.values(st);
  const stC={'Finalizada':'#1B7A4E','Agendada':'#6A1B9A','Em execução':'#1565C0','Impedida':'#C62828'};
  if(charts.tStatus) charts.tStatus.destroy();
  charts.tStatus=new Chart(document.getElementById('cTStatus'),{
    type:'doughnut',
    data:{labels:stL, datasets:[{data:stD, backgroundColor:stL.map(l=>stC[l]||'#999'), borderWidth:3, borderColor:'#fff', hoverOffset:10, spacing:2}]},
    options:{
      responsive:true, cutout:'58%',
      plugins:{
        legend:{position:'right', labels:{boxWidth:12, font:{size:10}, padding:10}},
        tooltip:{callbacks:{afterLabel:function(ctx){ var t=stD.reduce(function(a,b){return a+b;},0); return (t?((ctx.raw/t)*100).toFixed(1):0)+'% do total'; }}}
      },
      onClick:(e,els)=>{if(els.length){document.getElementById('tStatus').value=stL[els[0].index]; applyTasks();}}
    }
  });

  // Taxa de conclusão por mês
  const allMonths=[...new Set(tFiltered.map(d=>d.anoMes))].filter(Boolean).sort();
  const taxaMes = allMonths.map(m => {
    const subset = tFiltered.filter(d => d.anoMes === m);
    const t = subset.length;
    const f = subset.filter(d => d.status === 'Finalizada').length;
    return t ? +(f / t * 100).toFixed(1) : 0;
  });
  const totalMes = allMonths.map(m => tFiltered.filter(d => d.anoMes === m).length);
  const finMes = allMonths.map(m => tFiltered.filter(d => d.anoMes === m && d.status === 'Finalizada').length);

  if(charts.taxaMes) charts.taxaMes.destroy();
  charts.taxaMes=new Chart(document.getElementById('cTaxaMes'),{
    type:'bar',
    data:{
      labels: allMonths.map(mesLabel),
      datasets:[
        {
          type:'bar',
          label:'Total',
          data: totalMes,
          backgroundColor:'rgba(0,16,152,0.18)',
          borderRadius:3,
          yAxisID:'y'
        },
        {
          type:'bar',
          label:'Finalizadas',
          data: finMes,
          backgroundColor:'#1B7A4E',
          borderRadius:3,
          yAxisID:'y'
        },
        {
          type:'line',
          label:'Taxa %',
          data: taxaMes,
          borderColor:'#E65100',
          backgroundColor:'#E65100',
          tension:0.3,
          pointRadius:4,
          pointBackgroundColor:'#E65100',
          yAxisID:'y1'
        }
      ]
    },
    options:{
      responsive:true,
      plugins:{legend:{position:'top', labels:{boxWidth:12, font:{size:10}}}},
      scales:{
        y:{ beginAtZero:true, ticks:{precision:0}, title:{display:true, text:'Qtd tarefas'} },
        y1:{ beginAtZero:true, max:100, position:'right', grid:{drawOnChartArea:false},
             ticks:{callback:v=>v+'%'}, title:{display:true, text:'Taxa %'} }
      }
    }
  });

  // Ranking mensal — finalizadas como responsável, cores por técnico
  const finTasks=tFiltered.filter(d=>d.status==='Finalizada');
  const months=[...new Set(finTasks.map(d=>d.anoMes))].filter(Boolean).sort();
  const people=[...new Set(finTasks.map(d=>d.tecnico))].filter(Boolean).sort();
  const monthP={};
  months.forEach(m=>{ monthP[m]={}; people.forEach(p=>monthP[m][p]=0); });
  finTasks.forEach(d=>{
    if(!monthP[d.anoMes] || !d.tecnico) return;
    monthP[d.anoMes][d.tecnico]=(monthP[d.anoMes][d.tecnico]||0)+1;
  });
  if(charts.ranking) charts.ranking.destroy();
  charts.ranking=new Chart(document.getElementById('cRankingMensal'),{
    type:'bar',
    data:{
      labels: months.map(mesLabel),
      datasets: people.map((p,i)=>({
        label:p,
        data: months.map(m=>monthP[m][p]||0),
        backgroundColor: techColor(p, i),
        borderRadius:2
      }))
    },
    options:{
      responsive:true,
      plugins:{legend:{position:'top', labels:{boxWidth:12, font:{size:10}}}},
      scales:{
        x:{stacked:true},
        y:{stacked:true, beginAtZero:true, ticks:{precision:0}, title:{display:true, text:'Tarefas finalizadas como responsável'}}
      }
    }
  });

  // Ranking tables
  const rankRows = (arr, keyTotal, keyFin) => arr.map((e,i)=>{
    const s=e[1];
    const tot=s[keyTotal], ff=s[keyFin];
    const tx = tot ? (ff/tot*100).toFixed(1)+'%' : '—';
    const cls=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    return `<tr class="${cls}"><td>${i+1}º</td><td><strong style="color:${techColor(e[0],i)}">${e[0]}</strong></td>
      <td><strong>${tot}</strong></td><td>${ff}</td><td>${tx}</td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#999">Sem dados</td></tr>';

  document.getElementById('tRankRespBody').innerHTML = rankRows(sortedResp, 'resp', 'finResp');
  document.getElementById('tRankAuxBody').innerHTML = rankRows(sortedAux, 'aux', 'finAux');

  // ===== Manutenção × Projeto por técnico =====
  const mpBy = {};
  tFiltered.forEach(d => {
    if (!d.tecnico) return;
    if (!mpBy[d.tecnico]) mpBy[d.tecnico] = {Manutenção:0, Projeto:0, Outro:0};
    const k = d.tipoMP || 'Outro';
    mpBy[d.tecnico][k] = (mpBy[d.tecnico][k]||0)+1;
  });
  const mpSorted = Object.entries(mpBy).sort((a,b)=>(b[1].Manutenção+b[1].Projeto+b[1].Outro)-(a[1].Manutenção+a[1].Projeto+a[1].Outro));
  if (charts.manutProj) charts.manutProj.destroy();
  charts.manutProj = new Chart(document.getElementById('cManutProjeto'), {
    type: 'bar',
    data: {
      labels: mpSorted.map(e => e[0]),
      datasets: [
        { label: 'Manutenção', data: mpSorted.map(e => e[1].Manutenção), backgroundColor: '#00897B', borderRadius: 2 },
        { label: 'Projeto', data: mpSorted.map(e => e[1].Projeto), backgroundColor: '#E65100', borderRadius: 2 },
        { label: 'Outro', data: mpSorted.map(e => e[1].Outro), backgroundColor: '#90A4AE', borderRadius: 2 }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } }
    }
  });

  // ===== Tarefas em garantia =====
  const garTasks = tFiltered.filter(d => d.garantia);
  document.getElementById('garCount').textContent = garTasks.length;
  const garBy = {};
  garTasks.forEach(d => {
    if (!d.tecnico) return;
    garBy[d.tecnico] = (garBy[d.tecnico]||0)+1;
  });
  const garSorted = Object.entries(garBy).sort((a,b)=>b[1]-a[1]);
  if (charts.garantia) charts.garantia.destroy();
  charts.garantia = new Chart(document.getElementById('cGarantia'), {
    type: 'bar',
    data: {
      labels: garSorted.map(e => e[0]),
      datasets: [{
        label: 'Tarefas em garantia',
        data: garSorted.map(e => e[1]),
        backgroundColor: 'rgba(123,31,162,.85)',
        borderRadius: 6, maxBarThickness: 22, borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y', responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false } },
        y: { grid: { display: false }, border: { display: false } }
      }
    }
  });

  renderTTable();
}

function getTTableData() {
  let data=[...tFiltered];
  if(tView==='finalizadas') data=data.filter(d=>d.status==='Finalizada');
  else if(tView==='abertas') data=data.filter(d=>OPEN_TASK.includes(d.status));
  data.sort((a,b)=>{let va=a[tSort.key],vb=b[tSort.key]; if(typeof va==='string')va=va.toLowerCase(); if(typeof vb==='string')vb=vb.toLowerCase(); if(va<vb)return tSort.asc?-1:1; if(va>vb)return tSort.asc?1:-1; return 0;});
  return data;
}
function renderTTable() {
  const data=getTTableData(), tb=document.getElementById('tBody');
  if(!data.length){tb.innerHTML='<tr><td colspan="10" style="text-align:center;padding:20px;color:#999">Nenhuma tarefa</td></tr>'; return;}
  tb.innerHTML=data.slice(0,400).map(d=>{
    const aux=(d.auxiliares||[]).join(', ')||'—';
    const nome=d.nome.length>40?d.nome.slice(0,38)+'…':d.nome;
    return `<tr>
      <td class="sticky-col" title="${d.cliente}"><strong>${d.cliente.length>22?d.cliente.slice(0,20)+'…':d.cliente}</strong></td>
      <td>${d.id}</td><td><strong>${d.os}</strong></td><td>${statusBadge(d.status)}</td>
      <td><span class="badge badge-resp">${d.tecnico||'—'}</span></td>
      <td title="${aux}">${aux.length>25?aux.slice(0,23)+'…':aux}</td>
      <td title="${d.nome}">${nome}</td>
      <td>${fmtDate(d.prevista)}</td><td>${fmtDate(d.inicio)}</td><td>${fmtDate(d.fim)}</td>
    </tr>`;
  }).join('');
}
function sortT(k){if(tSort.key===k)tSort.asc=!tSort.asc; else{tSort.key=k;tSort.asc=true;} renderTTable();}
function setTView(btn){document.querySelectorAll('#panel-tarefas .tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); tView=btn.dataset.view; renderTTable();}

function resetCurrentFilters() {
  if(currentPanel==='os'){
    ['osStatus','osPrazo','osOcorrencia','osCliente'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('osSearch').value='';
    const osDe=document.getElementById('osDe'), osAte=document.getElementById('osAte');
    osDe.value = 0; osAte.value = osAte.max; updateOsRangeUI();
    applyOS();
  } else if(currentPanel==='tarefas'){
    ['tStatus','tTecnico','tCliente','tCat'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('tSearch').value='';
    const tDe=document.getElementById('tDe'), tAte=document.getElementById('tAte');
    tDe.value = 0; tAte.value = tAte.max; updateTRangeUI();
    applyTasks();
  } else if(currentPanel==='fast'){
    ['fStatus','fPrazo','fCliente'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('fSearch').value='';
    const fDe=document.getElementById('fDe'), fAte=document.getElementById('fAte');
    fDe.value = 0; fAte.value = fAte.max; updateFRangeUI();
    applyFast();
  } else if(currentPanel==='projetos'){
    ['pStatus','pPrazo','pCliente','pSit'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('pSearch').value='';
    const pDe=document.getElementById('pDe'), pAte=document.getElementById('pAte');
    pDe.value = 0; pAte.value = pAte.max; updatePRangeUI();
    applyProj();
  }
}
function exportCurrentXLSX() {
  if (typeof XLSX === 'undefined') {
    alert('Biblioteca XLSX não carregada. Verifique o script SheetJS no HTML.');
    return;
  }
  let sheetData, sheetName, fileName;
  if (currentPanel === 'os') {
    const data = getOsTableData();
    sheetData = data.map(d => ({
      'Cliente': d.cliente,
      'OS': d.os,
      'Status': d.status,
      'Prazo': d.prazo,
      'Tipo': d.ocorrencia,
      'Cadastro': d.cadastro,
      'Prev. Término': d.prevTermino,
      'Dias': d.dias
    }));
    sheetName = 'OS';
    fileName = 'os_filtradas.xlsx';
  } else if (currentPanel === 'tarefas') {
    const data = getTTableData();
    sheetData = data.map(d => ({
      'Cliente': d.cliente,
      'ID': d.id,
      'OS': d.os,
      'Status': d.status,
      'Responsável': d.tecnico || '',
      'Auxiliares': (d.auxiliares || []).join('; '),
      'Tarefa': d.nome,
      'Prevista': d.prevista,
      'Início': d.inicio,
      'Fim': d.fim
    }));
    sheetName = 'Tarefas';
    fileName = 'tarefas_filtradas.xlsx';
  } else if (currentPanel === 'fast') {
    const data = getFTableData();
    sheetData = data.map(d => {
      const ts = typeof tasksForOs === 'function' ? tasksForOs(d.os) : [];
      const avg = typeof avgTaskMinForOs === 'function' ? avgTaskMinForOs(d.os) : null;
      return {
        'Cliente': d.cliente,
        'OS': d.os,
        'Status': d.status,
        'Prazo': d.prazo,
        'Ocorrência': d.ocorrencia,
        'Cadastro': d.cadastro,
        'Prev. Término': d.prevTermino,
        'Dias': d.dias,
        'Tarefas': ts.length,
        'Tempo médio tarefas (min)': avg != null ? Math.round(avg) : ''
      };
    });
    sheetName = 'FAST';
    fileName = 'fast_filtradas.xlsx';
  } else if (currentPanel === 'projetos') {
    const data = getPTableData();
    sheetData = data.map(d => {
      const st = typeof tasksStatsOs === 'function' ? tasksStatsOs(d.os) : { total: 0, fin: 0, pct: null };
      return {
        'Cliente': d.cliente,
        'OS': d.os,
        'Status': d.status,
        'Prazo': d.prazo,
        'Tipo serviço': d.tipoServico || '',
        'Cadastro': d.cadastro,
        'Prev. Início': d.prevInicio,
        'Prev. Término': d.prevTermino,
        'Dias até conclusão': d.diasAte,
        'Dias desde cadastro': d.dias,
        'Tarefas': st.total,
        'Tarefas finalizadas': st.fin,
        '% conclusão tarefas': st.pct != null ? Math.round(st.pct) : ''
      };
    });
    sheetName = 'Projetos';
    fileName = 'projetos_filtrados.xlsx';
  } else {
    return;
  }
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}


function rankLocalidades(cat, tbodyId) {
  const data = (typeof GEO_DATA !== 'undefined' ? GEO_DATA : []).filter(function(p){ return p.cat === cat; });
  const counts = {};
  data.forEach(function(p){ counts[p.bairro] = (counts[p.bairro]||0)+1; });
  const total = data.length;
  const rank = Object.entries(counts).sort(function(a,b){ return b[1]-a[1]; }).slice(0, 5);
  const tb = document.getElementById(tbodyId);
  if (!tb) return;
  if (!rank.length) {
    tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:16px">Sem endereços identificados nesta categoria</td></tr>';
    return;
  }
  tb.innerHTML = rank.map(function(e,i){
    const pct = total ? (e[1]/total*100).toFixed(1)+'%' : '—';
    const cls = i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    return '<tr class="'+cls+'"><td><strong>'+(i+1)+'º</strong></td><td><strong>'+e[0]+'</strong></td><td><strong>'+e[1]+'</strong></td><td>'+pct+'</td></tr>';
  }).join('');
}


const GEO_DATA = [];

let mapHeat = null, heatLayer = null, markersLayer = null;





initOS(); applyOS();
initTasks(); applyTasks();
initFast(); applyFast();
loadProjectData();
