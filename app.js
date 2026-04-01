'use strict';

// ── Kategorien ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'rechnungen',   label: 'Rechnungen & Finanzen',       icon: '💰', subcategories: ['Strom','Telefon','Miete','Internet','Sonstiges'] },
  { id: 'vertraege',    label: 'Verträge & Versicherungen',    icon: '📝', subcategories: ['Krankenversicherung','Haftpflicht','Arbeitsvertrag','Sonstiges'] },
  { id: 'behoerden',    label: 'Behörden & Behördenpost',      icon: '🏛️', subcategories: ['Finanzamt','Einwohnermeldeamt','Jobcenter','Sonstiges'] },
  { id: 'persoenliches',label: 'Persönliches & Sonstiges',     icon: '👤', subcategories: ['Zeugnisse','Fotos','Notizen','Sonstiges'] },
];

// ── State ────────────────────────────────────────────────────────────────────

let state = {
  // Schreibtisch
  currentCategoryId: CATEGORIES[0].id,
  currentSubcategory: 'Alle',
  searchQuery: '',
  scannedFiles: {},
  pendingFiles: [],
  activeDocId: null,
  // Haushaltsbuch
  hb: {
    filter: 'alle',
    month: (() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 }; })(),
    editingId: null,
    selectedType: 'ausgabe',
    selectedRecurrence: 'einmalig',
    expandedStacks: new Set(),
    lastMonth: null,
    statsVisible: false,
  },
  // Gemeinsam (persistiert)
  metadata: {
    theme: 'lollypop',
    linkedFolders: {},
    documents: {},
    haushaltsbuch: { entries: {} },
    settings: { notifications: true },
  },
};

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function uuid()       { return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7); }
function escHtml(s)   { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function formatSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}
function formatCurrency(n) {
  return new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' }).format(n);
}
function fileIcon(name) {
  if (!name) return '📄';
  const m = { pdf:'📕', doc:'📘', docx:'📘', txt:'📃', rtf:'📃', xls:'📗', xlsx:'📗', csv:'📊',
               ppt:'📙', pptx:'📙', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️',
               bmp:'🖼️', tiff:'🖼️', zip:'🗜️', rar:'🗜️', '7z':'🗜️', mp3:'🎵', wav:'🎵', mp4:'🎬' };
  return m[name.split('.').pop().toLowerCase()] || '📄';
}
function monthLabel(monthObj) {
  if (!monthObj) return 'Alle Monate';
  return new Date(monthObj.year, monthObj.month-1, 1)
    .toLocaleDateString('de-DE', { month:'long', year:'numeric' });
}

// ── Metadaten ────────────────────────────────────────────────────────────────

async function saveMetadata() {
  await window.electronAPI.saveMetadata(state.metadata);
}

// ─────────────────────────────────────────────────────────────────────────────
// ── THEME ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const icon = theme === 'noxus' ? '🌙' : '🌸';
  const name = theme === 'noxus' ? 'Dark'     : 'Latte';
  document.getElementById('theme-icon').textContent = icon;
  document.getElementById('theme-name').textContent = name;
}

async function toggleTheme() {
  const current = document.body.dataset.theme;
  const next    = current === 'lollypop' ? 'noxus' : 'lollypop';
  state.metadata.theme = next;
  applyTheme(next);
  await saveMetadata();
}

// ─────────────────────────────────────────────────────────────────────────────
// ── TABS ─────────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.gb-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelector(`.gb-tab[data-tab="${tabId}"]`).classList.add('active');
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SCHREIBTISCH: Ordner scannen ──────────────────────────────────────────────

function getLinkedFolder(catId) { return state.metadata.linkedFolders[catId] || null; }
function currentCategory()       { return CATEGORIES.find(c => c.id === state.currentCategoryId); }

function docsForCategory(catId) {
  return Object.values(state.metadata.documents).filter(d => d.category === catId);
}
function docsForCategorySubcat(catId, sub) {
  if (sub === 'Alle') return docsForCategory(catId);
  return Object.values(state.metadata.documents).filter(d => d.category === catId && d.subcategory === sub);
}
function countForCategory(catId) {
  const fromMeta = docsForCategory(catId).length;
  let fromScan = 0;
  const cat = CATEGORIES.find(c => c.id === catId);
  if (cat) {
    for (const sub of cat.subcategories) {
      const key = `${catId}/${sub}`;
      if (state.scannedFiles[key]) {
        const paths = new Set(docsForCategorySubcat(catId, sub).map(d => d.filePath));
        fromScan += state.scannedFiles[key].filter(f => !paths.has(f.path)).length;
      }
    }
    const rootKey = `${catId}/__root__`;
    if (state.scannedFiles[rootKey]) {
      const paths = new Set(docsForCategory(catId).map(d => d.filePath));
      fromScan += state.scannedFiles[rootKey].filter(f => !paths.has(f.path)).length;
    }
  }
  return fromMeta + fromScan;
}

async function scanLinkedFolder(catId) {
  const root = getLinkedFolder(catId);
  if (!root) return;
  const cat = CATEGORIES.find(c => c.id === catId);
  if (!cat) return;
  state.scannedFiles[`${catId}/__root__`] = await window.electronAPI.readDir(root);
  for (const sub of cat.subcategories) {
    state.scannedFiles[`${catId}/${sub}`] = await window.electronAPI.readDir(root + '/' + sub);
  }
}

async function scanAllFolders() {
  for (const cat of CATEGORIES) {
    if (getLinkedFolder(cat.id)) await scanLinkedFolder(cat.id);
  }
}

// ── Schreibtisch: Render ──────────────────────────────────────────────────────

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  for (const cat of CATEGORIES) {
    const count = countForCategory(cat.id);
    const item = document.createElement('div');
    item.className = 'category-item' + (cat.id === state.currentCategoryId ? ' active' : '');
    const expiryStatus = getContractExpiryStatus(cat.id);
    const expiryBadge = expiryStatus === 'red'
      ? `<span class="cat-expiry-badge red" title="Vertrag läuft in &lt;60 Tagen ab">!</span>`
      : expiryStatus === 'yellow'
      ? `<span class="cat-expiry-badge yellow" title="Vertrag läuft in &lt;90 Tagen ab">!</span>`
      : '';
    item.innerHTML = `
      <span class="cat-icon">${cat.icon}</span>
      <span class="cat-label">${cat.label}</span>
      ${count > 0 ? `<span class="cat-count">${count}</span>` : ''}
      ${expiryBadge}
    `;
    item.addEventListener('click', () => selectCategory(cat.id));
    nav.appendChild(item);
  }
}

function renderHeader() {
  const cat = currentCategory();
  document.getElementById('bc-icon').textContent  = cat.icon;
  document.getElementById('bc-label').textContent = cat.label;
}

function renderFolderBar() {
  const folder  = getLinkedFolder(state.currentCategoryId);
  const pathEl  = document.getElementById('folder-path-display');
  const openBtn = document.getElementById('btn-open-folder');
  const unlBtn  = document.getElementById('btn-unlink-folder');
  if (folder) {
    pathEl.textContent = folder;
    pathEl.classList.remove('not-linked');
    openBtn.style.display = 'inline-flex';
    unlBtn.style.display  = 'inline-flex';
  } else {
    pathEl.textContent = 'Kein Ordner verknüpft – Klicke auf "Ordner verknüpfen"';
    pathEl.classList.add('not-linked');
    openBtn.style.display = 'none';
    unlBtn.style.display  = 'none';
  }
}

function renderSubcatBar() {
  const cat = currentCategory();
  const bar = document.getElementById('subcat-bar');
  bar.innerHTML = '';
  for (const sub of ['Alle', ...cat.subcategories]) {
    let count = sub === 'Alle' ? countForCategory(cat.id) : (() => {
      const fromMeta = docsForCategorySubcat(cat.id, sub).length;
      const paths    = new Set(docsForCategorySubcat(cat.id, sub).map(d => d.filePath));
      const fromScan = (state.scannedFiles[`${cat.id}/${sub}`] || []).filter(f => !paths.has(f.path)).length;
      return fromMeta + fromScan;
    })();
    const tab = document.createElement('button');
    tab.className = 'subcat-tab' + (sub === state.currentSubcategory ? ' active' : '');
    tab.innerHTML = sub + (count > 0 ? `<span class="subcat-count">(${count})</span>` : '');
    tab.addEventListener('click', () => { state.currentSubcategory = sub; renderSubcatBar(); renderFileGrid(); });
    bar.appendChild(tab);
  }
}

function buildFileList() {
  const catId = state.currentCategoryId;
  const sub   = state.currentSubcategory;
  const cat   = currentCategory();
  const files = [];

  if (sub === 'Alle') {
    for (const doc of docsForCategory(catId)) files.push({ type:'meta', doc });
    const paths = new Set(docsForCategory(catId).map(d => d.filePath));
    for (const s of cat.subcategories) {
      for (const f of (state.scannedFiles[`${catId}/${s}`] || [])) {
        if (!paths.has(f.path)) files.push({ type:'scan', file:f, subcategory:s });
      }
    }
    for (const f of (state.scannedFiles[`${catId}/__root__`] || [])) {
      if (!paths.has(f.path)) files.push({ type:'scan', file:f, subcategory:null });
    }
  } else {
    for (const doc of docsForCategorySubcat(catId, sub)) files.push({ type:'meta', doc });
    const paths = new Set(docsForCategorySubcat(catId, sub).map(d => d.filePath));
    for (const f of (state.scannedFiles[`${catId}/${sub}`] || [])) {
      if (!paths.has(f.path)) files.push({ type:'scan', file:f, subcategory:sub });
    }
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    return files.filter(e => e.type === 'meta'
      ? (e.doc.title?.toLowerCase().includes(q) || e.doc.note?.toLowerCase().includes(q) || e.doc.filePath?.toLowerCase().includes(q))
      : e.file.name?.toLowerCase().includes(q)
    );
  }
  return files;
}

function renderFileGrid() {
  const grid    = document.getElementById('file-grid');
  const countEl = document.getElementById('section-count');
  const titleEl = document.getElementById('section-title');
  const files   = buildFileList();

  titleEl.textContent = state.currentSubcategory === 'Alle' ? 'Alle Dokumente' : state.currentSubcategory;
  countEl.textContent = files.length > 0 ? `${files.length} Datei${files.length !== 1 ? 'en' : ''}` : '';
  grid.innerHTML = '';

  if (!files.length) {
    const empty = document.createElement('div');
    empty.style.gridColumn = '1/-1';
    empty.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📂</div>
      <div class="empty-state-title">Keine Dokumente vorhanden</div>
      <div class="empty-state-text">Füge Dokumente hinzu oder verknüpfe einen Ordner, um Dateien automatisch einzulesen.</div>
    </div>`;
    grid.appendChild(empty);
    return;
  }

  for (const entry of files) {
    const card = document.createElement('div');
    card.className = 'file-card';
    if (entry.type === 'meta') {
      const doc  = entry.doc;
      const name = doc.title || doc.fileName || doc.filePath?.split(/[\\/]/).pop() || 'Unbenannt';
      card.innerHTML = `
        <div class="file-card-icon">${fileIcon(doc.filePath || doc.title)}</div>
        <div class="file-card-name">${escHtml(name)}</div>
        ${doc.note ? `<div class="file-card-note">${escHtml(doc.note)}</div>` : ''}
        <div class="file-card-meta">
          ${doc.subcategory ? `<span class="file-card-subcat">${escHtml(doc.subcategory)}</span>` : ''}
          <div class="file-card-date">${formatDate(doc.date || doc.addedAt)}</div>
          ${doc.fileSize ? `<div class="file-card-size">${formatSize(doc.fileSize)}</div>` : ''}
        </div>
        <div class="file-card-actions">
          <button class="file-card-action-btn" data-action="open"   title="Öffnen">▶</button>
          <button class="file-card-action-btn" data-action="detail" title="Details">ℹ</button>
        </div>`;
      card.addEventListener('click',    () => openDetailModal(doc.id));
      card.addEventListener('dblclick', () => openDocument(doc.filePath));
      card.querySelector('[data-action="open"]').addEventListener('click',   e => { e.stopPropagation(); openDocument(doc.filePath); });
      card.querySelector('[data-action="detail"]').addEventListener('click', e => { e.stopPropagation(); openDetailModal(doc.id); });
    } else {
      const f = entry.file;
      card.innerHTML = `
        <div class="file-card-icon">${fileIcon(f.name)}</div>
        <div class="file-card-name">${escHtml(f.name)}</div>
        <div class="file-card-meta">
          ${entry.subcategory ? `<span class="file-card-subcat">${escHtml(entry.subcategory)}</span>` : ''}
          <div class="file-card-date">${formatDate(f.modified)}</div>
          <div class="file-card-size">${formatSize(f.size)}</div>
        </div>
        <div class="file-card-actions">
          <button class="file-card-action-btn" data-action="open"   title="Öffnen">▶</button>
          <button class="file-card-action-btn" data-action="folder" title="Im Explorer">📂</button>
        </div>`;
      card.addEventListener('dblclick', () => openDocument(f.path));
      card.querySelector('[data-action="open"]').addEventListener('click',   e => { e.stopPropagation(); openDocument(f.path); });
      card.querySelector('[data-action="folder"]').addEventListener('click', e => { e.stopPropagation(); window.electronAPI.showInFolder(f.path); });
    }
    grid.appendChild(card);
  }
}

function renderAll() {
  renderSidebar();
  renderHeader();
  renderFolderBar();
  renderSubcatBar();
  renderFileGrid();
  renderContractWarnings();
}

// ── Schreibtisch: Aktionen ────────────────────────────────────────────────────

function selectCategory(catId) {
  state.currentCategoryId  = catId;
  state.currentSubcategory = 'Alle';
  renderAll();
}

async function openDocument(filePath) {
  if (!filePath) return showToast('Kein Dateipfad bekannt.', 'error');
  if (!await window.electronAPI.fileExists(filePath)) return showToast('Datei nicht gefunden: ' + filePath, 'error');
  await window.electronAPI.openFile(filePath);
}

async function linkFolder() {
  const folder = await window.electronAPI.openFolderDialog();
  if (!folder) return;
  state.metadata.linkedFolders[state.currentCategoryId] = folder;
  await saveMetadata();
  const cat = currentCategory();
  for (const sub of cat.subcategories) await window.electronAPI.createDir(folder + '/' + sub);
  await scanLinkedFolder(state.currentCategoryId);
  renderAll();
  showToast('Ordner verknüpft: ' + folder, 'success');
}

async function unlinkFolder() {
  delete state.metadata.linkedFolders[state.currentCategoryId];
  delete state.scannedFiles[state.currentCategoryId];
  await saveMetadata();
  renderAll();
  showToast('Verknüpfung aufgehoben.', 'info');
}

async function openLinkedFolder() {
  const f = getLinkedFolder(state.currentCategoryId);
  if (f) await window.electronAPI.showInFolder(f);
}

async function refreshFolder() {
  if (!getLinkedFolder(state.currentCategoryId)) return showToast('Kein Ordner verknüpft.', 'info');
  await scanLinkedFolder(state.currentCategoryId);
  renderSubcatBar(); renderFileGrid(); renderSidebar();
  showToast('Ordner aktualisiert.', 'success');
}

// ── Schreibtisch: Modal Hinzufügen ────────────────────────────────────────────

function openAddModal() {
  state.pendingFiles = [];
  document.getElementById('add-file-preview').innerHTML = '';
  document.getElementById('add-title').value = '';
  document.getElementById('add-note').value  = '';
  document.getElementById('add-date').value  = new Date().toISOString().slice(0,10);
  const select = document.getElementById('add-subcat');
  select.innerHTML = '';
  for (const sub of currentCategory().subcategories) {
    const opt = document.createElement('option');
    opt.value = sub; opt.textContent = sub;
    if (sub === state.currentSubcategory) opt.selected = true;
    select.appendChild(opt);
  }
  // Vertragsfelder nur für "vertraege" anzeigen
  const contractFieldsEl = document.getElementById('contract-fields');
  if (state.currentCategoryId === 'vertraege') {
    contractFieldsEl.style.display = 'block';
    document.getElementById('add-contract-start').value    = new Date().toISOString().slice(0, 10);
    document.getElementById('add-contract-duration').value = '';
    document.getElementById('add-contract-notice').value   = '';
  } else {
    contractFieldsEl.style.display = 'none';
  }
  openModal('modal-add');
}

async function pickFiles() {
  const paths = await window.electronAPI.openFilesDialog();
  if (!paths.length) return;
  state.pendingFiles = paths;
  renderFilePreview(paths);
}

function renderFilePreview(paths) {
  const c = document.getElementById('add-file-preview');
  c.innerHTML = '';
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    const div  = document.createElement('div');
    div.className = 'file-preview-item';
    div.innerHTML = `<span class="fpi-icon">${fileIcon(name)}</span><span class="fpi-name">${escHtml(name)}</span>`;
    c.appendChild(div);
  }
}

async function saveDocuments() {
  if (!state.pendingFiles.length) return showToast('Keine Dateien ausgewählt.', 'error');
  const catId   = state.currentCategoryId;
  const subcat  = document.getElementById('add-subcat').value;
  const title   = document.getElementById('add-title').value.trim();
  const date    = document.getElementById('add-date').value;
  const note    = document.getElementById('add-note').value.trim();
  const root    = getLinkedFolder(catId);
  const destDir = root ? root + '/' + subcat : null;

  const btn = document.getElementById('btn-save-doc');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  let saved = 0;
  for (const src of state.pendingFiles) {
    const srcName = src.split(/[\\/]/).pop();
    let destPath  = src;
    if (destDir) {
      try { destPath = await window.electronAPI.copyFile(src, destDir, srcName); }
      catch (e) { showToast('Fehler: ' + e.message, 'error'); continue; }
    }
    const id = uuid();
    // Vertragsfelder speichern
    let contractData = {};
    if (catId === 'vertraege') {
      const cStart    = document.getElementById('add-contract-start').value;
      const cDuration = parseInt(document.getElementById('add-contract-duration').value) || 0;
      const cNotice   = parseInt(document.getElementById('add-contract-notice').value)   || 0;
      if (cStart && cDuration > 0) {
        contractData = {
          contractStart:    cStart,
          contractDuration: cDuration,
          contractNotice:   cNotice,
          contractExpiry:   addMonths(cStart, cDuration),
        };
      }
    }
    state.metadata.documents[id] = { id, category:catId, subcategory:subcat, title:title||srcName,
      fileName:srcName, filePath:destPath, date:date||new Date().toISOString().slice(0,10), note,
      addedAt:new Date().toISOString(), ...contractData };
    saved++;
  }

  await saveMetadata();
  if (root) await scanLinkedFolder(catId);
  btn.disabled = false; btn.innerHTML = '💾 Speichern';
  closeModal('modal-add');
  renderAll();
  showToast(`${saved} Dokument${saved!==1?'e':''} hinzugefügt.`, 'success');
}

// ── Schreibtisch: Detail-Modal ────────────────────────────────────────────────

function openDetailModal(docId) {
  const doc = state.metadata.documents[docId];
  if (!doc) return;
  state.activeDocId = docId;
  const cat  = CATEGORIES.find(c => c.id === doc.category);
  const name = doc.title || doc.fileName || doc.filePath?.split(/[\\/]/).pop() || 'Unbenannt';
  const contractInfoHtml = doc.contractExpiry ? `
    <div class="detail-info-row"><span class="detail-info-label label-caps">Vertragsende</span><span class="detail-info-value">${formatDate(doc.contractExpiry)}${(() => { const days = Math.ceil((new Date(doc.contractExpiry + 'T00:00:00') - new Date()) / 86400000); return days >= 0 ? ` <span class="detail-contract-days ${days < 60 ? 'red' : 'yellow'}">(${days} Tage)</span>` : ' <span class="detail-contract-days red">(abgelaufen)</span>'; })()}</span></div>
    ${doc.contractDuration ? `<div class="detail-info-row"><span class="detail-info-label label-caps">Laufzeit</span><span class="detail-info-value">${doc.contractDuration} Monate</span></div>` : ''}
    ${doc.contractNotice ? `<div class="detail-info-row"><span class="detail-info-label label-caps">Kündigungsfrist</span><span class="detail-info-value">${doc.contractNotice} Wochen</span></div>` : ''}
  ` : '';

  document.getElementById('modal-detail-body').innerHTML = `
    <div class="detail-icon">${fileIcon(doc.filePath || doc.title)}</div>
    <div class="detail-name">${escHtml(name)}</div>
    <div class="detail-meta">${cat ? cat.icon + ' ' + cat.label : ''}${doc.subcategory ? ' › ' + doc.subcategory : ''}</div>
    <div class="detail-info-row"><span class="detail-info-label label-caps">Datum</span><span class="detail-info-value">${formatDate(doc.date)}</span></div>
    <div class="detail-info-row"><span class="detail-info-label label-caps">Hinzugefügt</span><span class="detail-info-value">${formatDate(doc.addedAt)}</span></div>
    <div class="detail-info-row"><span class="detail-info-label label-caps">Dateipfad</span><span class="detail-info-value">${escHtml(doc.filePath||'–')}</span></div>
    ${doc.note ? `<div class="detail-info-row"><span class="detail-info-label label-caps">Notiz</span><span class="detail-info-value">${escHtml(doc.note)}</span></div>` : ''}
    ${contractInfoHtml}
  `;

  // Vorschau zurücksetzen
  document.getElementById('modal-preview-section').style.display = 'none';
  document.getElementById('modal-preview-content').innerHTML = '';
  document.getElementById('btn-toggle-preview').textContent = '👁 Vorschau';

  openModal('modal-detail');
}

async function deleteActiveDoc() {
  const doc = state.metadata.documents[state.activeDocId];
  if (!doc) return;
  if (!confirm(`Dokument "${doc.title||doc.fileName}" wirklich entfernen?\n(Die Datei bleibt erhalten.)`)) return;
  delete state.metadata.documents[state.activeDocId];
  state.activeDocId = null;
  await saveMetadata();
  closeModal('modal-detail');
  renderAll();
  showToast('Dokument entfernt.', 'info');
}

// ─────────────────────────────────────────────────────────────────────────────
// ── HAUSHALTSBUCH ─────────────────────────────────────────────────────────────

function hbEntries() { return Object.values(state.metadata.haushaltsbuch.entries); }

// ── Serien-Generierung ────────────────────────────────────────────────────────

function seriesConfig(recurrence) {
  switch (recurrence) {
    case 'monatlich': return { count: 12, monthStep: 1 };
    case 'quartal':   return { count: 4,  monthStep: 3 };
    case 'jaehrlich': return { count: 2,  monthStep: 12 };
    default:          return null;
  }
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // Letzter Tag des Monats falls Ursprungstag nicht existiert (z.B. 31. Feb)
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, maxDay));
  return d.toISOString().slice(0, 10);
}

function generateSeriesEntries(base, seriesId) {
  const cfg = seriesConfig(base.recurrence);
  if (!cfg) return [];
  const entries = [];
  for (let i = 0; i < cfg.count; i++) {
    entries.push({
      id: uuid(),
      seriesId,
      name:        base.name,
      description: base.description,
      amount:      base.amount,
      type:        base.type,
      recurrence:  base.recurrence,
      date:        addMonths(base.date, i * cfg.monthStep),
      paid:        false,
      createdAt:   new Date().toISOString(),
    });
  }
  return entries;
}

// ── Serien-Vorschau im Modal ──────────────────────────────────────────────────

function showSeriesPreview(previewEl, rec, date) {
  const cfg = seriesConfig(rec);
  if (!cfg || !date) { previewEl.style.display = 'none'; return; }
  const endDate  = addMonths(date, (cfg.count - 1) * cfg.monthStep);
  const startLbl = new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
  const endLbl   = new Date(endDate + 'T00:00:00').toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
  previewEl.textContent = `→ ${cfg.count} Einträge werden angelegt (${startLbl} – ${endLbl})`;
  previewEl.style.display = 'block';
}

function updateHBSeriesPreview() {
  const previewEl  = document.getElementById('hb-series-preview');
  const editNoteEl = document.getElementById('hb-edit-note');
  const rec  = state.hb.selectedRecurrence;
  const date = document.getElementById('hb-date').value;

  if (state.hb.editingId) {
    const entry = state.metadata.haushaltsbuch.entries[state.hb.editingId];
    if (entry?.seriesId) {
      // Bereits Teil einer Serie → nur Hinweis zeigen
      previewEl.style.display  = 'none';
      editNoteEl.style.display = 'block';
    } else {
      // Einzeleintrag: Vorschau wenn Wiederholung gewählt
      editNoteEl.style.display = 'none';
      showSeriesPreview(previewEl, rec, date);
    }
    return;
  }

  editNoteEl.style.display = 'none';
  showSeriesPreview(previewEl, rec, date);
}

function filteredHBEntries() {
  let entries = hbEntries();

  // Monatsfilter
  if (state.hb.month) {
    const { year, month } = state.hb.month;
    entries = entries.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
  }

  // Statusfilter
  switch (state.hb.filter) {
    case 'einnahmen':   return entries.filter(e => e.type === 'einnahme');
    case 'ausgaben':    return entries.filter(e => e.type === 'ausgabe');
    case 'bezahlt':     return entries.filter(e => e.paid);
    case 'ausstehend':  return entries.filter(e => !e.paid);
    default:            return entries;
  }
}

function calcHBSummary(entries) {
  let total = 0, paid = 0, pending = 0;
  for (const e of entries) {
    const v = e.type === 'einnahme' ? e.amount : -e.amount;
    total += v;
    if (e.paid) paid += v; else pending += v;
  }
  return { total, paid, pending };
}

// ── HB: Render ────────────────────────────────────────────────────────────────

const HB_REC_LABELS = { monatlich: '↻ Monatlich', quartal: '↻ Quartal', jaehrlich: '↻ Jährlich' };

function buildHBCard(entry, showMonth = false) {
  const card      = document.createElement('div');
  const typeClass = entry.type === 'einnahme' ? 'income' : 'expense';
  card.className  = `hb-card ${typeClass}${entry.paid ? ' paid' : ''}`;
  card.dataset.id = entry.id;

  const amtStr  = (entry.type === 'einnahme' ? '+' : '–') + formatCurrency(entry.amount);
  const typeLbl = entry.type === 'einnahme' ? 'Einnahme' : 'Ausgabe';
  const recLabel = HB_REC_LABELS[entry.recurrence] || null;

  card.innerHTML = `
    <div class="hb-card-stripe"></div>
    <label class="hb-card-check">
      <input type="checkbox" class="hb-checkbox" ${entry.paid ? 'checked' : ''} />
    </label>
    <div class="hb-card-content">
      <div class="hb-card-top-row">
        <span class="hb-card-name">${escHtml(entry.name)}</span>
        <span class="hb-card-amount">${amtStr}</span>
      </div>
      ${entry.description ? `<div class="hb-card-desc">${escHtml(entry.description)}</div>` : ''}
      <div class="hb-card-footer">
        <span class="hb-type-badge badge">${typeLbl}</span>
        ${recLabel ? `<span class="hb-rec-badge badge">${recLabel}</span>` : ''}
        <span class="hb-card-date">${showMonth
          ? new Date(entry.date + 'T00:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
          : formatDate(entry.date)}</span>
        <div class="hb-card-actions">
          <button class="hb-action-btn hb-edit" title="Bearbeiten">✏</button>
          ${entry.seriesId ? `<button class="hb-action-btn hb-del-from" title="Ab hier löschen">⬇🗑</button>` : ''}
          <button class="hb-action-btn hb-del"  title="Nur diesen löschen">🗑</button>
        </div>
      </div>
    </div>`;

  card.querySelector('.hb-checkbox').addEventListener('change', e => {
    e.stopPropagation();
    toggleHBPaid(entry.id);
  });
  card.querySelector('.hb-edit').addEventListener('click', e => { e.stopPropagation(); openHBModal(entry.id); });
  card.querySelector('.hb-del').addEventListener('click',  e => { e.stopPropagation(); deleteHBEntry(entry.id); });
  const delFrom = card.querySelector('.hb-del-from');
  if (delFrom) delFrom.addEventListener('click', e => { e.stopPropagation(); deleteHBFromHere(entry.id); });

  return card;
}

function buildHBStackCard(name, entries) {
  const isExpanded = state.hb.expandedStacks.has(name);
  const rep        = entries[0];
  const typeClass  = rep.type === 'einnahme' ? 'income' : 'expense';
  const recLabel   = HB_REC_LABELS[rep.recurrence] || null;
  const typeLbl    = rep.type === 'einnahme' ? 'Einnahme' : 'Ausgabe';

  const wrapper = document.createElement('div');
  wrapper.className = 'hb-stack-wrapper';

  const card = document.createElement('div');
  card.className = `hb-card hb-stack-card ${typeClass}`;

  card.innerHTML = `
    <div class="hb-card-stripe"></div>
    <div class="hb-card-content">
      <div class="hb-card-top-row">
        <span class="hb-card-name">${escHtml(name)}</span>
        <span class="hb-stack-expand">${isExpanded ? '▾' : '▸'}</span>
      </div>
      <div class="hb-card-footer">
        <span class="hb-type-badge badge">${typeLbl}</span>
        ${recLabel ? `<span class="hb-rec-badge badge">${recLabel}</span>` : ''}
        <span class="hb-card-date">${entries.length} Einträge</span>
      </div>
    </div>
    <div class="hb-stack-count">${entries.length}</div>`;

  card.addEventListener('click', () => {
    if (state.hb.expandedStacks.has(name)) {
      state.hb.expandedStacks.delete(name);
    } else {
      state.hb.expandedStacks.add(name);
    }
    renderHBCards();
  });

  wrapper.appendChild(card);

  if (isExpanded) {
    const expDiv = document.createElement('div');
    expDiv.className = 'hb-stack-entries';
    const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const e of sorted) {
      expDiv.appendChild(buildHBCard(e, true));
    }
    wrapper.appendChild(expDiv);
  }

  return wrapper;
}

function renderHBCards() {
  const grid    = document.getElementById('hb-card-grid');
  const entries = filteredHBEntries()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  grid.innerHTML = '';

  if (!entries.length) {
    grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty-state">
      <div class="empty-state-icon">💳</div>
      <div class="empty-state-title">Keine Einträge vorhanden</div>
      <div class="empty-state-text">Klicke auf "+ Hinzufügen", um deinen ersten Eintrag zu erfassen.</div>
    </div></div>`;
    return;
  }

  if (!state.hb.month) {
    // Alle-Ansicht: gleiche Namen zu einem Stack zusammenfassen
    const groups    = new Map();
    const keyOrder  = [];
    for (const e of entries) {
      if (!groups.has(e.name)) { groups.set(e.name, []); keyOrder.push(e.name); }
      groups.get(e.name).push(e);
    }
    for (const name of keyOrder) {
      const group = groups.get(name);
      grid.appendChild(group.length === 1 ? buildHBCard(group[0]) : buildHBStackCard(name, group));
    }
  } else {
    // Monatsansicht: alle Einträge einzeln
    for (const entry of entries) {
      grid.appendChild(buildHBCard(entry));
    }
  }
}

function renderHBSummary() {
  const { total, paid, pending } = calcHBSummary(filteredHBEntries());

  const totalEl   = document.getElementById('hb-sum-total');
  const paidEl    = document.getElementById('hb-sum-paid');
  const pendingEl = document.getElementById('hb-sum-pending');

  totalEl.textContent   = formatCurrency(total);
  paidEl.textContent    = formatCurrency(paid);
  pendingEl.textContent = formatCurrency(pending);

  // Farbklassen
  totalEl.className = 'hb-sum-value ' + (total > 0 ? 'positive' : total < 0 ? 'negative' : '');
  // paid und pending behalten ihre Klassen (gesetzt im HTML)
}

function renderHBMonthLabel() {
  const lbl = document.getElementById('hb-month-label');
  const all = document.getElementById('hb-all-months');
  lbl.textContent = monthLabel(state.hb.month);
  all.classList.toggle('active', !state.hb.month);
}

function renderHB() {
  renderHBCards();
  renderHBSummary();
  renderHBMonthLabel();
  if (state.hb.statsVisible) drawHBStats();
}

// ── HB: Aktionen ──────────────────────────────────────────────────────────────

async function toggleHBPaid(entryId) {
  const entry = state.metadata.haushaltsbuch.entries[entryId];
  if (!entry) return;
  entry.paid = !entry.paid;
  await saveMetadata();
  renderHB();
}

async function deleteHBEntry(entryId) {
  const entry = state.metadata.haushaltsbuch.entries[entryId];
  if (!entry) return;
  if (!confirm(`Eintrag "${entry.name}" wirklich löschen?`)) return;
  delete state.metadata.haushaltsbuch.entries[entryId];
  await saveMetadata();
  renderHB();
  showToast('Eintrag gelöscht.', 'info');
}

async function deleteHBFromHere(entryId) {
  const entry = state.metadata.haushaltsbuch.entries[entryId];
  if (!entry?.seriesId) return;
  const toDelete = Object.values(state.metadata.haushaltsbuch.entries)
    .filter(e => e.seriesId === entry.seriesId && new Date(e.date) >= new Date(entry.date));
  if (!confirm(`${toDelete.length} Einträge ab ${formatDate(entry.date)} löschen?`)) return;
  for (const e of toDelete) delete state.metadata.haushaltsbuch.entries[e.id];
  await saveMetadata();
  renderHB();
  showToast(`${toDelete.length} Einträge gelöscht.`, 'info');
}

function setHBFilter(filter) {
  state.hb.filter = filter;
  document.querySelectorAll('.hb-filter').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderHB();
}

function changeHBMonth(delta) {
  if (!state.hb.month) {
    const now = new Date();
    state.hb.month = { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  let { year, month } = state.hb.month;
  month += delta;
  if (month > 12) { month = 1;  year++; }
  if (month < 1)  { month = 12; year--; }
  state.hb.month = { year, month };
  state.hb.lastMonth = state.hb.month;
  renderHB();
}

// ── HB: Modal ─────────────────────────────────────────────────────────────────

function openHBModal(editId = null) {
  state.hb.editingId    = editId;
  state.hb.selectedType = 'ausgabe';

  const isEdit = !!editId;
  document.getElementById('modal-hb-icon').textContent  = isEdit ? '✏️' : '💳';
  document.getElementById('modal-hb-title').textContent = isEdit ? 'Eintrag bearbeiten' : 'Eintrag hinzufügen';

  if (isEdit) {
    const e = state.metadata.haushaltsbuch.entries[editId];
    document.getElementById('hb-name').value   = e.name || '';
    document.getElementById('hb-desc').value   = e.description || '';
    document.getElementById('hb-amount').value = e.amount || '';
    document.getElementById('hb-date').value   = e.date || '';
    state.hb.selectedType       = e.type       || 'ausgabe';
    state.hb.selectedRecurrence = e.recurrence || 'einmalig';
  } else {
    document.getElementById('hb-name').value   = '';
    document.getElementById('hb-desc').value   = '';
    document.getElementById('hb-amount').value = '';
    document.getElementById('hb-date').value   = new Date().toISOString().slice(0,10);
    state.hb.selectedRecurrence = 'einmalig';
  }

  // Typ-Buttons
  document.querySelectorAll('.hb-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.hb.selectedType);
  });

  // Wiederholung-Buttons
  document.querySelectorAll('.hb-rec-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rec === state.hb.selectedRecurrence);
  });

  openModal('modal-hb-entry');
  updateHBSeriesPreview();
}

async function saveHBEntry() {
  const name   = document.getElementById('hb-name').value.trim();
  const desc   = document.getElementById('hb-desc').value.trim();
  const amount = parseFloat(document.getElementById('hb-amount').value);
  const date   = document.getElementById('hb-date').value;

  if (!name)          return showToast('Bitte Bezeichnung eingeben.', 'error');
  if (isNaN(amount) || amount < 0) return showToast('Bitte gültigen Betrag eingeben.', 'error');
  if (!date)          return showToast('Bitte Datum eingeben.', 'error');

  if (state.hb.editingId) {
    const entry = state.metadata.haushaltsbuch.entries[state.hb.editingId];
    const cfg   = seriesConfig(state.hb.selectedRecurrence);

    if (cfg && !entry.seriesId) {
      // ── Einzeleintrag → neue Serie anlegen ────────────────────────────────
      const seriesId = uuid();
      entry.name = name; entry.description = desc; entry.amount = amount;
      entry.date = date; entry.type = state.hb.selectedType;
      entry.recurrence = state.hb.selectedRecurrence; entry.seriesId = seriesId;
      for (let i = 1; i < cfg.count; i++) {
        const ne = { id: uuid(), seriesId, name, description: desc, amount,
          type: state.hb.selectedType, recurrence: state.hb.selectedRecurrence,
          date: addMonths(date, i * cfg.monthStep), paid: false,
          createdAt: new Date().toISOString() };
        state.metadata.haushaltsbuch.entries[ne.id] = ne;
      }
      await saveMetadata();
      closeModal('modal-hb-entry');
      renderHB();
      showToast(`${cfg.count} Einträge in Serie umgewandelt.`, 'success');
    } else {
      // ── Einzelnen Eintrag bearbeiten (Serie bleibt unberührt) ────────────
      entry.name = name; entry.description = desc; entry.amount = amount;
      entry.date = date; entry.type = state.hb.selectedType;
      entry.recurrence = state.hb.selectedRecurrence;
      await saveMetadata();
      closeModal('modal-hb-entry');
      renderHB();
      showToast('Eintrag aktualisiert.', 'success');
    }
    state.hb.editingId = null;
  } else {
    // ── Neuer Eintrag ──────────────────────────────────────────────────────
    const base = { name, description: desc, amount, type: state.hb.selectedType,
                   recurrence: state.hb.selectedRecurrence, date };
    const cfg  = seriesConfig(state.hb.selectedRecurrence);

    if (cfg) {
      // Wiederkehrend: ganze Serie anlegen
      const seriesId = uuid();
      const entries  = generateSeriesEntries(base, seriesId);
      for (const e of entries) {
        state.metadata.haushaltsbuch.entries[e.id] = e;
      }
      await saveMetadata();
      closeModal('modal-hb-entry');
      renderHB();
      showToast(`${entries.length} Einträge angelegt.`, 'success');
    } else {
      // Einmalig
      const id = uuid();
      state.metadata.haushaltsbuch.entries[id] = {
        id, ...base, seriesId: null, paid: false, createdAt: new Date().toISOString(),
      };
      await saveMetadata();
      closeModal('modal-hb-entry');
      renderHB();
      showToast('Eintrag hinzugefügt.', 'success');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SHARED: Modal-Helfer ──────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const c     = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className   = `toast ${type}`;
  toast.textContent = msg;
  c.appendChild(toast);
  setTimeout(() => {
    toast.style.cssText += 'opacity:0;transform:translateX(20px);transition:opacity 0.3s,transform 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

function initDragDrop() {
  const content = document.getElementById('content');
  content.addEventListener('dragover',  e => { e.preventDefault(); content.classList.add('drag-over'); });
  content.addEventListener('dragleave', e => { if (!content.contains(e.relatedTarget)) content.classList.remove('drag-over'); });
  content.addEventListener('drop', async e => {
    e.preventDefault();
    content.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).map(f => f.path);
    if (!files.length) return;
    openAddModal();
    state.pendingFiles = files;
    renderFilePreview(files);
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

function initEvents() {
  // Global Bar
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.querySelectorAll('.gb-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Schreibtisch-Header
  document.getElementById('btn-link-folder').addEventListener('click', linkFolder);
  document.getElementById('btn-add-doc').addEventListener('click', openAddModal);
  document.getElementById('btn-open-folder').addEventListener('click', openLinkedFolder);
  document.getElementById('btn-unlink-folder').addEventListener('click', unlinkFolder);
  document.getElementById('btn-refresh-folder').addEventListener('click', refreshFolder);

  // Suche
  let searchTimer;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchQuery = e.target.value.trim(); renderFileGrid(); }, 200);
  });

  // Modal Dokument
  document.getElementById('btn-pick-files').addEventListener('click', pickFiles);
  document.getElementById('btn-save-doc').addEventListener('click', saveDocuments);
  document.getElementById('btn-delete-doc').addEventListener('click', deleteActiveDoc);
  document.getElementById('btn-open-doc').addEventListener('click', () => {
    const doc = state.metadata.documents[state.activeDocId];
    if (doc) openDocument(doc.filePath);
  });
  document.getElementById('btn-show-in-folder').addEventListener('click', () => {
    const doc = state.metadata.documents[state.activeDocId];
    if (doc?.filePath) window.electronAPI.showInFolder(doc.filePath);
  });

  // Haushaltsbuch
  document.getElementById('btn-add-hb-entry').addEventListener('click', () => openHBModal());
  document.getElementById('btn-save-hb-entry').addEventListener('click', saveHBEntry);

  document.querySelectorAll('.hb-filter').forEach(btn => {
    btn.addEventListener('click', () => setHBFilter(btn.dataset.filter));
  });

  document.getElementById('hb-prev-month').addEventListener('click', () => changeHBMonth(-1));
  document.getElementById('hb-next-month').addEventListener('click', () => changeHBMonth(+1));
  document.getElementById('hb-all-months').addEventListener('click', () => {
    if (state.hb.month === null) {
      // Toggle zurück zum zuletzt gewählten Monat
      state.hb.month = state.hb.lastMonth || (() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() + 1 }; })();
    } else {
      state.hb.lastMonth = state.hb.month;
      state.hb.month = null;
    }
    renderHB();
  });

  // HB Typ-Auswahl im Modal
  document.querySelectorAll('.hb-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.hb.selectedType = btn.dataset.type;
      document.querySelectorAll('.hb-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === btn.dataset.type));
    });
  });

  // HB Wiederholung im Modal
  document.querySelectorAll('.hb-rec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.hb.selectedRecurrence = btn.dataset.rec;
      document.querySelectorAll('.hb-rec-btn').forEach(b => b.classList.toggle('active', b.dataset.rec === btn.dataset.rec));
      updateHBSeriesPreview();
    });
  });

  document.getElementById('hb-date').addEventListener('input', updateHBSeriesPreview);

  // Modal schließen via data-close
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Overlay-Klick schließt Modal
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });

  // ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  });

  // Einstellungen
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('settings-notifications').addEventListener('change', async e => {
    state.metadata.settings.notifications = e.target.checked;
    await saveMetadata();
  });

  // HB Export
  document.getElementById('btn-export-hb').addEventListener('click', exportHBCSV);

  // HB Statistik
  document.getElementById('btn-toggle-hb-stats').addEventListener('click', toggleHBStats);

  // Dokument-Vorschau
  document.getElementById('btn-toggle-preview').addEventListener('click', toggleDocPreview);
}

// ── Migration: Einzel-Einträge mit Wiederholung → vollständige Serie ──────────

function migrateHBSeries() {
  const entries = state.metadata.haushaltsbuch.entries;
  const toMigrate = Object.values(entries).filter(e => !e.seriesId && seriesConfig(e.recurrence));
  if (!toMigrate.length) return;

  for (const original of toMigrate) {
    const seriesId = uuid();
    const cfg      = seriesConfig(original.recurrence);
    // Ersten Eintrag (den bestehenden) mit seriesId versehen
    original.seriesId = seriesId;
    // Restliche Einträge der Serie generieren (ab Index 1)
    for (let i = 1; i < cfg.count; i++) {
      const newEntry = {
        id:          uuid(),
        seriesId,
        name:        original.name,
        description: original.description,
        amount:      original.amount,
        type:        original.type,
        recurrence:  original.recurrence,
        date:        addMonths(original.date, i * cfg.monthStep),
        paid:        false,
        createdAt:   original.createdAt || new Date().toISOString(),
      };
      entries[newEntry.id] = newEntry;
    }
  }
  // Persistieren
  saveMetadata();
}

// ─────────────────────────────────────────────────────────────────────────────
// ── VERTRAGSABLAUF ────────────────────────────────────────────────────────────

function getExpiringContracts(withinDays = 90) {
  const now = new Date();
  return Object.values(state.metadata.documents)
    .filter(d => d.contractExpiry)
    .map(doc => {
      const expiry   = new Date(doc.contractExpiry + 'T00:00:00');
      const daysLeft = Math.ceil((expiry - now) / 86400000);
      return { doc, daysLeft };
    })
    .filter(({ daysLeft }) => daysLeft >= 0 && daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

function getContractExpiryStatus(catId) {
  if (catId !== 'vertraege') return null;
  const expiring = getExpiringContracts(90);
  if (expiring.some(({ daysLeft }) => daysLeft < 60)) return 'red';
  if (expiring.length > 0) return 'yellow';
  return null;
}

function renderContractWarnings() {
  const el = document.getElementById('contract-warnings');
  if (!el) return;
  const expiring = getExpiringContracts(90);
  if (!expiring.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="cw-header">⚠️ Ablaufende Verträge</div>
    <div class="cw-list">
      ${expiring.map(({ doc, daysLeft }) => `
        <div class="cw-item ${daysLeft < 60 ? 'urgent' : ''}">
          <span class="cw-name">${escHtml(doc.title || doc.fileName || 'Unbenannt')}</span>
          <span class="cw-meta">Läuft ab: ${formatDate(doc.contractExpiry)}</span>
          <span class="cw-days-badge badge ${daysLeft < 60 ? 'red' : 'yellow'}">${daysLeft}d</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── STATISTIK ─────────────────────────────────────────────────────────────────

function toggleHBStats() {
  const section = document.getElementById('hb-stats-section');
  const btn     = document.getElementById('btn-toggle-hb-stats');
  state.hb.statsVisible = !state.hb.statsVisible;
  section.style.display = state.hb.statsVisible ? 'block' : 'none';
  btn.classList.toggle('active', state.hb.statsVisible);
  if (state.hb.statsVisible) drawHBStats();
}

function drawHBStats() {
  const allEntries = hbEntries();
  const cs = getComputedStyle(document.documentElement);
  const incomeColor  = cs.getPropertyValue('--income-color').trim()  || '#40a02b';
  const expenseColor = cs.getPropertyValue('--expense-color').trim() || '#d20f39';
  const textColor    = cs.getPropertyValue('--text').trim()          || '#4c4f69';
  const mutedColor   = cs.getPropertyValue('--text-muted').trim()    || '#6c6f85';
  const borderColor  = cs.getPropertyValue('--border').trim()        || '#ccd0da';
  const accentColor  = cs.getPropertyValue('--accent').trim()        || '#8839ef';

  // ── Balkendiagramm ────────────────────────────────────────────────────────
  const barCanvas = document.getElementById('hb-bar-chart');
  if (barCanvas) {
    const now = new Date();
    const months = [];
    for (let i = -3; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push({
        year:   d.getFullYear(),
        month:  d.getMonth() + 1,
        label:  d.toLocaleDateString('de-DE', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2),
      });
    }
    const barData = months.map(m => {
      const mes = allEntries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === m.year && d.getMonth() + 1 === m.month;
      });
      return {
        label:   m.label,
        income:  mes.filter(e => e.type === 'einnahme').reduce((s, e) => s + e.amount, 0),
        expense: mes.filter(e => e.type === 'ausgabe').reduce((s, e) => s + e.amount, 0),
      };
    });

    const ctx  = barCanvas.getContext('2d');
    const W    = barCanvas.width, H = barCanvas.height;
    const pt   = 20, pb = 48, pl = 58, pr = 10;
    const cW   = W - pl - pr, cH = H - pt - pb;
    const maxVal = Math.max(...barData.map(d => Math.max(d.income, d.expense)), 1);

    ctx.clearRect(0, 0, W, H);

    // Gitterlinien + Y-Achsenbeschriftung
    for (let i = 0; i <= 4; i++) {
      const y = pt + cH - (cH * i / 4);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(W - pr, y); ctx.stroke();
      const val = maxVal * i / 4;
      ctx.fillStyle  = mutedColor;
      ctx.font       = '10px system-ui';
      ctx.textAlign  = 'right';
      ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0), pl - 5, y + 3);
    }

    // Balken
    const groupW = cW / barData.length;
    const barW   = Math.max(Math.min(groupW * 0.32, 22), 8);
    barData.forEach((d, i) => {
      const gx = pl + i * groupW + groupW / 2;
      const iH = Math.max((d.income  / maxVal) * cH, d.income  > 0 ? 2 : 0);
      const eH = Math.max((d.expense / maxVal) * cH, d.expense > 0 ? 2 : 0);
      ctx.fillStyle = incomeColor;
      ctx.fillRect(gx - barW - 2, pt + cH - iH, barW, iH);
      ctx.fillStyle = expenseColor;
      ctx.fillRect(gx + 2, pt + cH - eH, barW, eH);
      ctx.fillStyle = mutedColor;
      ctx.font      = '9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, gx, H - pb + 14);
    });

    // Legende
    ctx.fillStyle = incomeColor;  ctx.fillRect(pl, H - 16, 10, 10);
    ctx.fillStyle = textColor;    ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Einnahmen', pl + 14, H - 7);
    ctx.fillStyle = expenseColor; ctx.fillRect(pl + 90, H - 16, 10, 10);
    ctx.fillStyle = textColor;    ctx.fillText('Ausgaben', pl + 104, H - 7);
  }

  // ── Kreisdiagramm ─────────────────────────────────────────────────────────
  const pieCanvas = document.getElementById('hb-pie-chart');
  if (pieCanvas) {
    const ctx = pieCanvas.getContext('2d');
    const W   = pieCanvas.width, H = pieCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const totalIncome  = allEntries.filter(e => e.type === 'einnahme').reduce((s, e) => s + e.amount, 0);
    const totalExpense = allEntries.filter(e => e.type === 'ausgabe').reduce((s, e) => s + e.amount, 0);
    const totalPaid    = allEntries.filter(e => e.paid).reduce((s, e) => s + e.amount, 0);
    const totalPending = allEntries.filter(e => !e.paid).reduce((s, e) => s + e.amount, 0);

    const pendingColor = cs.getPropertyValue('--sum-pending-color').trim() || '#df8e1d';
    const slices = [
      { label: 'Einnahmen',  value: totalIncome,  color: incomeColor },
      { label: 'Ausgaben',   value: totalExpense, color: expenseColor },
    ].filter(s => s.value > 0);

    const total = slices.reduce((s, d) => s + d.value, 0);
    const cx = W / 2, cy = (H - 90) / 2 + 8, r = Math.min(cx, cy) - 8;

    if (total === 0) {
      ctx.fillStyle = mutedColor;
      ctx.font = '12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Keine Daten', cx, cy);
    } else {
      let angle = -Math.PI / 2;
      slices.forEach(s => {
        const slice = (s.value / total) * 2 * Math.PI;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, angle, angle + slice);
        ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
        angle += slice;
      });
      // Donut-Loch
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI);
      ctx.fillStyle = cs.getPropertyValue('--surface').trim() || '#ffffff'; ctx.fill();
    }

    // Legende unten
    const legY = cy + r + 16;
    [
      { label: 'Einnahmen',  value: totalIncome,  color: incomeColor },
      { label: 'Ausgaben',   value: totalExpense, color: expenseColor },
      { label: 'Bezahlt',    value: totalPaid,    color: accentColor },
      { label: 'Ausstehend', value: totalPending, color: pendingColor },
    ].forEach((item, i) => {
      const lx = 8, ly = legY + i * 18;
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, ly - 9, 10, 10);
      ctx.fillStyle = textColor;
      ctx.font = '11px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(`${item.label}: ${formatCurrency(item.value)}`, lx + 15, ly);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CSV-EXPORT ────────────────────────────────────────────────────────────────

async function exportHBCSV() {
  const entries = filteredHBEntries().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!entries.length) return showToast('Keine Einträge zum Exportieren.', 'info');

  const recLabels = { monatlich: 'Monatlich', quartal: 'Quartal', jaehrlich: 'Jährlich', einmalig: 'Einmalig' };
  const rows = [
    ['Datum', 'Bezeichnung', 'Beschreibung', 'Typ', 'Betrag (EUR)', 'Bezahlt', 'Wiederholung'],
    ...entries.map(e => [
      e.date,
      e.name,
      e.description || '',
      e.type === 'einnahme' ? 'Einnahme' : 'Ausgabe',
      e.amount.toFixed(2).replace('.', ','),
      e.paid ? 'Ja' : 'Nein',
      recLabels[e.recurrence] || 'Einmalig',
    ]),
  ];
  // UTF-8 BOM + semikolon-getrennt für Excel (DE)
  const csv = '\ufeff' + rows.map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
  ).join('\r\n');

  const monthStr = state.hb.month
    ? `${state.hb.month.year}-${String(state.hb.month.month).padStart(2, '0')}`
    : new Date().toISOString().slice(0, 7);
  const defaultName = `Haushaltsbuch_${monthStr}.csv`;

  const result = await window.electronAPI.saveFile(defaultName, csv);
  if (result === true)  showToast('CSV exportiert.', 'success');
  else if (result === false) showToast('Export fehlgeschlagen.', 'error');
  // null = abgebrochen, kein Toast
}

// ─────────────────────────────────────────────────────────────────────────────
// ── FÄLLIGKEITS-ERINNERUNGEN ──────────────────────────────────────────────────

function checkDueEntries() {
  if (!state.metadata.settings?.notifications) return;
  const cutoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const due = hbEntries().filter(e => {
    if (e.paid) return false;
    const d = new Date(e.date + 'T00:00:00');
    return d <= cutoff;
  });
  if (!due.length) return;
  const names = due.slice(0, 3).map(e => e.name).join(', ');
  const extra = due.length > 3 ? ` + ${due.length - 3} weitere` : '';
  try {
    new Notification('Virtueller Schreibtisch – Fällige Einträge', {
      body: `${due.length} ausstehend: ${names}${extra}`,
    });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ── EINSTELLUNGEN-MODAL ───────────────────────────────────────────────────────

function openSettingsModal() {
  document.getElementById('settings-notifications').checked = !!state.metadata.settings?.notifications;
  renderBackupList();
  openModal('modal-settings');
}

async function renderBackupList() {
  const list    = document.getElementById('backup-list');
  list.innerHTML = '<div class="backup-loading">Lade…</div>';
  const backups = await window.electronAPI.listBackups();
  if (!backups.length) {
    list.innerHTML = '<div class="backup-empty">Keine Backups vorhanden.</div>';
    return;
  }
  list.innerHTML = backups.map(f => {
    const dateStr = f.replace('metadata_', '').replace('.json', '');
    return `<div class="backup-item">
      <span class="backup-date">📁 ${dateStr}</span>
      <button class="btn btn-secondary btn-sm backup-restore-btn" data-file="${escHtml(f)}">↩ Wiederherstellen</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.backup-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => restoreBackup(btn.dataset.file));
  });
}

async function restoreBackup(fileName) {
  const dateStr = fileName.replace('metadata_', '').replace('.json', '');
  if (!confirm(`Backup vom ${dateStr} wiederherstellen?\nAlle aktuellen Daten werden überschrieben!`)) return;
  const ok = await window.electronAPI.restoreBackup(fileName);
  if (ok) {
    showToast('Backup wiederhergestellt – App wird neu geladen…', 'success');
    setTimeout(() => location.reload(), 1800);
  } else {
    showToast('Backup konnte nicht wiederhergestellt werden.', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── DOKUMENT-VORSCHAU ─────────────────────────────────────────────────────────

async function toggleDocPreview() {
  const section = document.getElementById('modal-preview-section');
  const content = document.getElementById('modal-preview-content');
  const btn     = document.getElementById('btn-toggle-preview');

  if (section.style.display !== 'none') {
    section.style.display = 'none';
    content.innerHTML     = '';
    btn.textContent       = '👁 Vorschau';
    return;
  }

  const doc = state.metadata.documents[state.activeDocId];
  if (!doc?.filePath) {
    showToast('Kein Dateipfad bekannt.', 'info');
    return;
  }

  const ext     = (doc.filePath.split('.').pop() || '').toLowerCase();
  const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];

  section.style.display = 'block';
  btn.textContent       = '👁 Vorschau ausblenden';
  content.innerHTML     = '<div class="preview-loading">Lade Vorschau…</div>';

  if (imgExts.includes(ext)) {
    const result = await window.electronAPI.readFileAsBase64(doc.filePath);
    if (result?.base64) {
      content.innerHTML = `<img class="preview-image" src="data:${result.mime};base64,${result.base64}" alt="Vorschau" />`;
    } else {
      content.innerHTML = '<div class="preview-unavailable">Datei konnte nicht geladen werden.</div>';
    }
  } else if (ext === 'pdf') {
    const result = await window.electronAPI.readFileAsBase64(doc.filePath);
    if (result?.base64) {
      try {
        const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: 'application/pdf' });
        const url   = URL.createObjectURL(blob);
        content.innerHTML = `<iframe class="preview-pdf" src="${url}"></iframe>`;
      } catch (_) {
        content.innerHTML = '<div class="preview-unavailable">PDF konnte nicht gerendert werden.</div>';
      }
    } else {
      content.innerHTML = '<div class="preview-unavailable">Datei konnte nicht geladen werden.</div>';
    }
  } else {
    content.innerHTML = '<div class="preview-unavailable">Keine Vorschau verfügbar für diesen Dateityp.</div>';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const saved = await window.electronAPI.loadMetadata();
  if (saved) {
    state.metadata = {
      theme: 'lollypop',
      linkedFolders: {},
      documents: {},
      haushaltsbuch: { entries: {} },
      ...saved,
      haushaltsbuch: { entries: {}, ...(saved.haushaltsbuch || {}) },
    };
  }

  // Settings-Defaults sicherstellen
  state.metadata.settings = { notifications: true, ...state.metadata.settings };

  migrateHBSeries();

  applyTheme(state.metadata.theme || 'lollypop');
  await scanAllFolders();

  initEvents();
  initDragDrop();
  renderAll();
  renderHB();

  const dataPath = await window.electronAPI.getDataPath();
  document.getElementById('sidebar-footer').textContent = dataPath;

  // Fälligkeits-Erinnerungen
  checkDueEntries();
  setInterval(checkDueEntries, 24 * 60 * 60 * 1000);
}

init().catch(err => console.error('Startfehler:', err));
