'use strict';

const ETHERCALC_ROOM = 'k3im7605mgvf';
const ETHERCALC_BASE = 'https://ethercalc.net';
const ETHERCALC_CSV_URL = `${ETHERCALC_BASE}/_/${ETHERCALC_ROOM}/csv`;
const ETHERCALC_WRITE_URL = `${ETHERCALC_BASE}/_/${ETHERCALC_ROOM}`;
const FORMAT_MARKER = 'FAMILY_TREE_JSON_V1';
const CHUNK_SIZE = 12000;
const SYNC_INTERVAL_MS = 10000;
const STAGE_WIDTH = 2400;
const STAGE_HEIGHT = 3400;
const CARD_W = 220;
const CARD_H = 150;
const GENERATION_Y_START = 110;
const GENERATION_GAP = 285;
const MAX_GENERATIONS = 12;

const state = {
  records: [], people: [], search: '', pendingImage: null, removeExistingImage: false,
  deleteId: null, syncing: false, saveQueue: Promise.resolve(), lastRemoteSignature: '',
  view: { x: 80, y: 50, scale: 1 }, drag: null, pan: null, pinch: null
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  tree: $('#familyTree'), treeLines: $('#treeLines'), treeViewport: $('#treeViewport'), treeStage: $('#treeStage'), generationBands: $('#generationBands'), empty: $('#emptyState'),
  resultInfo: $('#resultInfo'), totalCount: $('#totalCount'), syncStatus: $('#syncStatus'), search: $('#searchInput'), dialog: $('#personDialog'), form: $('#personForm'),
  modalTitle: $('#modalTitle'), id: $('#personId'), name: $('#nameInput'), nickname: $('#nicknameInput'), gender: $('#genderInput'), birthName: $('#birthNameInput'), birthDate: $('#birthDateInput'),
  birthPlace: $('#birthPlaceInput'), deathDate: $('#deathDateInput'), deathPlace: $('#deathPlaceInput'), generation: $('#generationInput'), father: $('#fatherInput'), mother: $('#motherInput'), partner: $('#partnerInput'),
  notes: $('#notesInput'), image: $('#imageInput'), imagePreview: $('#imagePreview'), imagePrompt: $('#imagePrompt'), removeImage: $('#removeImageButton'),
  confirmDialog: $('#confirmDialog'), toast: $('#toast'), template: $('#personTemplate'), syncButton: $('#syncButton'),
  zoomOut: $('#zoomOutButton'), zoomIn: $('#zoomInButton'), zoomReset: $('#zoomResetButton'), fitTree: $('#fitTreeButton'), autoLayout: $('#autoLayoutButton'),
  fullscreen: $('#fullscreenButton'), mobileView: $('#mobileViewButton'), treeShell: document.querySelector('.tree-shell')
};

function setSyncStatus(text, type = '') { elements.syncStatus.textContent = text; elements.syncStatus.dataset.type = type; }
function normalize(value) { return String(value || '').toLocaleLowerCase('ro-RO').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function getPerson(id) { return state.people.find((person) => person.id === id); }
function yearOf(date) { return date ? String(date).slice(0, 4) : ''; }
function lifespan(person) { const b = yearOf(person.birthDate), d = yearOf(person.deathDate); return b || d ? `${b || '?'} — ${d || 'prezent'}` : 'date necunoscute'; }
function parseDateParts(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}
function ageInYears(person) {
  const birth = parseDateParts(person.birthDate);
  if (!birth) return null;
  const death = parseDateParts(person.deathDate);
  const now = new Date();
  const end = death || { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  let age = end.year - birth.year;
  if (end.month < birth.month || (end.month === birth.month && end.day < birth.day)) age -= 1;
  return age >= 0 ? age : null;
}
function ageLabel(person) {
  const age = ageInYears(person);
  if (age === null) return '';
  return person.deathDate ? `${age} ani la deces` : `${age} ani`;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hasStoredPosition(person) { return Number.isFinite(Number(person.posX)) && Number.isFinite(Number(person.posY)); }

function matchesSearch(person) {
  const query = normalize(state.search.trim());
  if (!query) return true;
  const relatives = [person.fatherId, person.motherId, person.partnerId].map((id) => getPerson(id)?.name || '');
  const siblings = getSiblings(person.id).map((p) => p.name);
  return normalize([person.name, person.nickname, person.birthName, person.birthDate, person.birthPlace, person.deathDate, person.deathPlace, person.notes, ...relatives, ...siblings].join(' ')).includes(query);
}

function generationFor(person, memo = new Map(), path = new Set()) {
  if (memo.has(person.id)) return memo.get(person.id);
  const hasManual = person.manualGeneration !== null && person.manualGeneration !== undefined && person.manualGeneration !== '';
  const manual = hasManual ? Number(person.manualGeneration) : NaN;
  if (Number.isInteger(manual) && manual >= 0) { memo.set(person.id, manual); return manual; }
  if (path.has(person.id)) return 0;
  path.add(person.id);
  const parents = [person.fatherId, person.motherId].map(getPerson).filter(Boolean);
  const gen = parents.length ? Math.max(...parents.map((parent) => generationFor(parent, memo, new Set(path)))) + 1 : 0;
  memo.set(person.id, gen);
  return gen;
}
function generationFromY(y) { return clamp(Math.round((y - GENERATION_Y_START) / GENERATION_GAP), 0, MAX_GENERATIONS - 1); }
function generationY(generation) { return GENERATION_Y_START + generation * GENERATION_GAP; }

function shareParent(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const aParents = [a.fatherId, a.motherId].filter(Boolean);
  const bParents = new Set([b.fatherId, b.motherId].filter(Boolean));
  return aParents.some((id) => bParents.has(id));
}
function getSiblings(id) { const person = getPerson(id); return person ? state.people.filter((other) => shareParent(person, other)) : []; }

function siblingLabel(person) {
  const count = getSiblings(person.id).length;
  if (!count) return '';
  return `${count} ${count === 1 ? 'frate / soră' : 'frați / surori'}`;
}

function parentKey(person) {
  const ids = [person.fatherId, person.motherId].filter(Boolean).sort();
  return ids.length ? ids.join('|') : `root:${person.id}`;
}

function familyClusterKey(person) {
  // Copiii acelorași părinți rămân împreună. Dacă nu sunt cunoscuți părinții,
  // cuplurile sunt tratate ca o singură ramură familială.
  const parents = [person.fatherId, person.motherId].filter(Boolean).sort();
  if (parents.length) return `parents:${parents.join('|')}`;
  if (person.partnerId && getPerson(person.partnerId)) return `couple:${[person.id, person.partnerId].sort().join('|')}`;
  return `root:${person.id}`;
}

function familyAnchorX(person, placed, previousGenerationCenters) {
  const parentXs = [person.fatherId, person.motherId]
    .map((id) => placed.get(id)?.x)
    .filter((x) => Number.isFinite(x));
  if (parentXs.length) return parentXs.reduce((a,b)=>a+b,0) / parentXs.length;

  const partnerX = person.partnerId ? placed.get(person.partnerId)?.x : null;
  if (Number.isFinite(partnerX)) return partnerX;

  const familyParents = [person.fatherId, person.motherId].filter(Boolean);
  for (const id of familyParents) {
    if (previousGenerationCenters.has(id)) return previousGenerationCenters.get(id);
  }
  return null;
}

function defaultLayoutPositions() {
  const memo = new Map(), groups = new Map();
  state.people.forEach((p) => {
    const gen = generationFor(p, memo);
    if (!groups.has(gen)) groups.set(gen, []);
    groups.get(gen).push(p);
  });

  const result = new Map();
  const SPOUSE_GAP = 18;
  const UNIT_GAP = 46;
  const FAMILY_GAP = 130;
  const generations = [...groups.keys()].sort((a,b)=>a-b);

  generations.forEach((gen) => {
    const people = groups.get(gen);
    const inGeneration = new Set(people.map((p)=>p.id));
    const used = new Set();
    const units = [];

    // Construiește unități de layout. Un cuplu este întotdeauna o singură unitate,
    // astfel încât soțul și soția să fie așezați unul lângă altul.
    people
      .slice()
      .sort((a,b)=>(a.birthDate||'9999').localeCompare(b.birthDate||'9999') || a.name.localeCompare(b.name,'ro'))
      .forEach((person) => {
        if (used.has(person.id)) return;
        const partner = person.partnerId && inGeneration.has(person.partnerId) ? getPerson(person.partnerId) : null;
        if (partner && !used.has(partner.id)) {
          const pair = [person, partner].sort((a,b) => {
            if (a.gender === 'M' && b.gender === 'F') return -1;
            if (a.gender === 'F' && b.gender === 'M') return 1;
            return (a.birthDate || '9999').localeCompare(b.birthDate || '9999') || a.name.localeCompare(b.name,'ro');
          });
          units.push({ members: pair, isCouple: true });
          used.add(person.id); used.add(partner.id);
        } else {
          units.push({ members: [person], isCouple: false });
          used.add(person.id);
        }
      });

    units.forEach((unit) => {
      const anchors = unit.members
        .map((p)=>familyAnchorX(p, result, new Map()))
        .filter((x)=>Number.isFinite(x));
      unit.anchor = anchors.length ? anchors.reduce((a,b)=>a+b,0)/anchors.length : null;

      // Pentru ordonarea pe ramuri, folosește familia de origine a membrului
      // care are părinți cunoscuți. La cupluri, asta păstrează ramura compactă
      // fără a despărți soții.
      const originKeys = unit.members
        .map((p)=>familyClusterKey(p))
        .filter(Boolean)
        .sort();
      unit.familyKey = originKeys[0] || `unit:${unit.members[0].id}`;
      unit.width = unit.members.length * CARD_W + (unit.members.length - 1) * SPOUSE_GAP;
    });

    units.sort((a,b) => {
      if (a.anchor !== null && b.anchor !== null && Math.abs(a.anchor-b.anchor) > 10) return a.anchor-b.anchor;
      if (a.anchor !== null && b.anchor === null) return -1;
      if (a.anchor === null && b.anchor !== null) return 1;
      if (a.familyKey !== b.familyKey) return a.familyKey.localeCompare(b.familyKey,'ro');
      const an=a.members[0]?.name||'', bn=b.members[0]?.name||'';
      return an.localeCompare(bn,'ro');
    });

    const totalWidth = units.reduce((sum,u)=>sum+u.width,0) + Math.max(0,units.length-1)*UNIT_GAP;
    let cursor = Math.max(90,(STAGE_WIDTH-totalWidth)/2);
    let previousFamily = null;

    units.forEach((unit) => {
      if (previousFamily !== null && previousFamily !== unit.familyKey) cursor += FAMILY_GAP-UNIT_GAP;
      let start = cursor;
      if (unit.anchor !== null) start = Math.max(cursor, unit.anchor - unit.width/2);

      unit.members.forEach((person,index) => {
        result.set(person.id, {
          x: Math.round(start + index*(CARD_W+SPOUSE_GAP)),
          y: generationY(gen)
        });
      });

      cursor = start + unit.width + UNIT_GAP;
      previousFamily = unit.familyKey;
    });
  });

  return result;
}
function personPosition(person, defaults) {
  if (hasStoredPosition(person)) return { x: Number(person.posX), y: Number(person.posY) };
  return defaults.get(person.id) || { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 };
}

function renderPerson(person, defaults) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector('.person-card');
  card.dataset.id = person.id; card.dataset.gender = person.gender || '';
  const pos = personPosition(person, defaults); card.style.left = `${pos.x}px`; card.style.top = `${pos.y}px`;
  if (state.search.trim() && matchesSearch(person)) card.classList.add('is-match');
  const image = fragment.querySelector('.person-card__image'), placeholder = fragment.querySelector('.person-card__placeholder');
  if (person.image) { image.src = person.image; image.alt = `Fotografie ${person.name}`; placeholder.hidden = true; } else image.hidden = true;
  const generation = generationFor(person);
  fragment.querySelector('.person-card__generation').textContent = `Gen. ${generation + 1}`;
  const ageBadge = fragment.querySelector('.person-card__age');
  ageBadge.textContent = ageLabel(person);
  ageBadge.hidden = !ageBadge.textContent;
  fragment.querySelector('.person-card__relation').textContent = siblingLabel(person);
  fragment.querySelector('.person-card__name').textContent = person.name;
  const nickname = fragment.querySelector('.person-card__nickname');
  nickname.textContent = person.nickname ? `„${person.nickname}”` : '';
  if (!person.nickname) nickname.hidden = true;
  fragment.querySelector('.person-card__years').textContent = lifespan(person);
  const birthName = fragment.querySelector('.person-card__birth-name'); birthName.textContent = person.birthName ? `n. ${person.birthName}` : ''; birthName.hidden = !person.birthName;
  const place = fragment.querySelector('.person-card__place'); place.textContent = person.birthPlace ? `⌖ ${person.birthPlace}` : ''; place.hidden = !person.birthPlace;
  fragment.querySelector('.generation-down-action').addEventListener('click', (e) => { e.stopPropagation(); movePersonGeneration(person.id, -1); });
  fragment.querySelector('.generation-up-action').addEventListener('click', (e) => { e.stopPropagation(); movePersonGeneration(person.id, 1); });
  fragment.querySelector('.edit-action').addEventListener('click', (e) => { e.stopPropagation(); openEditModal(person.id); });
  fragment.querySelector('.delete-action').addEventListener('click', (e) => { e.stopPropagation(); askDelete(person.id); });
  const dragHandle = fragment.querySelector('.person-card__drag');
  dragHandle?.addEventListener('pointerdown', startCardDrag);
  return fragment;
}

function render() {
  elements.tree.innerHTML = ''; elements.treeLines.innerHTML = ''; elements.totalCount.textContent = state.people.length;
  const matches = state.people.filter(matchesSearch);
  elements.resultInfo.textContent = state.search.trim()
    ? (matches.length ? `${matches.length} ${matches.length === 1 ? 'persoană găsită' : 'persoane găsite'} — rezultatele sunt evidențiate.` : 'Nu am găsit această persoană în arbore.')
    : (state.people.length ? 'Pozițiile și relațiile sunt sincronizate prin EtherCalc.' : '');
  const isEmpty = state.people.length === 0;
  elements.empty.hidden = !isEmpty; document.querySelector('.tree-shell').hidden = isEmpty;
  if (isEmpty) return;
  renderGenerationBands();
  const defaults = defaultLayoutPositions();
  state.people.forEach((person) => elements.tree.appendChild(renderPerson(person, defaults)));
  applyView();
  requestAnimationFrame(drawConnections);
}

function renderGenerationBands() {
  if (!elements.generationBands) return;
  elements.generationBands.innerHTML = '';
  const memo = new Map();
  const highest = Math.max(3, ...state.people.map((p) => generationFor(p, memo)));
  const count = Math.min(MAX_GENERATIONS, highest + 2);
  for (let gen = 0; gen < count; gen += 1) {
    const band = document.createElement('div');
    band.className = 'generation-band';
    band.style.top = `${generationY(gen) - 72}px`;
    band.style.height = `${GENERATION_GAP - 26}px`;
    const label = document.createElement('span');
    label.className = 'generation-band__label';
    label.textContent = `Generația ${gen + 1}`;
    band.appendChild(label);
    elements.generationBands.appendChild(band);
  }
}

function cardPoint(id, edge = 'center') {
  const card = elements.tree.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!card) return null;
  const x = parseFloat(card.style.left) || 0, y = parseFloat(card.style.top) || 0, w = card.offsetWidth, h = card.offsetHeight;
  if (edge === 'top') return { x: x + w / 2, y };
  if (edge === 'bottom') return { x: x + w / 2, y: y + h };
  if (edge === 'left') return { x, y: y + h / 2 };
  if (edge === 'right') return { x: x + w, y: y + h / 2 };
  return { x: x + w / 2, y: y + h / 2 };
}

function svgPath(d, cls = '') { const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',d); if (cls) p.setAttribute('class',cls); elements.treeLines.appendChild(p); return p; }
function svgCircle(cx, cy, r, cls) { const c = document.createElementNS('http://www.w3.org/2000/svg','circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r); c.setAttribute('class',cls); elements.treeLines.appendChild(c); }

function drawConnections() {
  elements.treeLines.innerHTML = ''; elements.treeLines.setAttribute('viewBox',`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`);
  const drawnParents = new Set();
  state.people.forEach((person) => {
    [person.fatherId, person.motherId].filter(Boolean).forEach((parentId) => {
      if (!getPerson(parentId)) return;
      const key = `${parentId}>${person.id}`; if (drawnParents.has(key)) return; drawnParents.add(key);
      const a = cardPoint(parentId,'bottom'), b = cardPoint(person.id,'top'); if (!a || !b) return;
      const midY = a.y + (b.y - a.y) * .48;
      svgPath(`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`);
    });
    if (person.partnerId && person.id < person.partnerId && getPerson(person.partnerId)) {
      const a = cardPoint(person.id,'center'), b = cardPoint(person.partnerId,'center'); if (!a || !b) return;
      svgPath(`M ${a.x} ${a.y} C ${(a.x+b.x)/2} ${a.y-18}, ${(a.x+b.x)/2} ${b.y-18}, ${b.x} ${b.y}`,'partner-line');
    }
  });

  // Legături între frați/surori. Frații sunt deduși automat când au cel puțin un părinte comun.
  const siblingGroups = new Map();
  state.people.forEach((p) => {
    [p.fatherId, p.motherId].filter(Boolean).forEach((parentId) => {
      if (!siblingGroups.has(parentId)) siblingGroups.set(parentId, []);
      siblingGroups.get(parentId).push(p);
    });
  });
  const renderedSiblingSets = new Set();
  siblingGroups.forEach((members) => {
    const unique = [...new Map(members.map((p) => [p.id,p])).values()];
    if (unique.length < 2) return;
    const ids = unique.map((p) => p.id).sort(); const setKey = ids.join('|');
    if (renderedSiblingSets.has(setKey)) return; renderedSiblingSets.add(setKey);
    const points = unique.map((p) => cardPoint(p.id,'top')).filter(Boolean).sort((a,b) => a.x-b.x); if (points.length < 2) return;
    const y = Math.min(...points.map((p) => p.y)) - 24;
    svgPath(`M ${points[0].x} ${y} L ${points[points.length-1].x} ${y}`,'sibling-line');
    points.forEach((p) => { svgPath(`M ${p.x} ${y} L ${p.x} ${p.y}`,'sibling-line'); svgCircle(p.x,y,3.5,'sibling-dot'); });
  });
}

function applyView() {
  const { x, y, scale } = state.view;
  elements.treeStage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  elements.zoomReset.textContent = `${Math.round(scale * 100)}%`;
}
function setZoom(nextScale, anchorX = elements.treeViewport.clientWidth / 2, anchorY = elements.treeViewport.clientHeight / 2) {
  const old = state.view.scale, next = clamp(nextScale,.35,1.8); if (next === old) return;
  const worldX = (anchorX - state.view.x) / old, worldY = (anchorY - state.view.y) / old;
  state.view.scale = next; state.view.x = anchorX - worldX * next; state.view.y = anchorY - worldY * next; applyView();
}
function fitTree() {
  const cards = [...elements.tree.querySelectorAll('.person-card')]; if (!cards.length) return;
  const xs = cards.map((c) => parseFloat(c.style.left)||0), ys = cards.map((c) => parseFloat(c.style.top)||0);
  const maxXs = cards.map((c,i) => xs[i] + c.offsetWidth), maxYs = cards.map((c,i) => ys[i] + c.offsetHeight);
  const minX=Math.min(...xs)-80,minY=Math.min(...ys)-80,maxX=Math.max(...maxXs)+80,maxY=Math.max(...maxYs)+80;
  const scale = clamp(Math.min(elements.treeViewport.clientWidth/(maxX-minX),elements.treeViewport.clientHeight/(maxY-minY)),.35,1.15);
  state.view.scale=scale; state.view.x=(elements.treeViewport.clientWidth-(maxX-minX)*scale)/2-minX*scale; state.view.y=(elements.treeViewport.clientHeight-(maxY-minY)*scale)/2-minY*scale; applyView();
}


function updateViewModeButtons() {
  const isFullscreen = document.fullscreenElement === elements.treeShell;
  const isMobile = elements.treeShell.classList.contains('mobile-view');
  if (elements.fullscreen) {
    elements.fullscreen.setAttribute('aria-pressed', String(isFullscreen));
    elements.fullscreen.textContent = isFullscreen ? '⤢ Ieși full screen' : '⛶ Full screen';
  }
  if (elements.mobileView) {
    elements.mobileView.setAttribute('aria-pressed', String(isMobile));
    elements.mobileView.textContent = isMobile ? '🖥 Desktop view' : '📱 Mobile view';
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === elements.treeShell) await document.exitFullscreen();
    else if (elements.treeShell.requestFullscreen) await elements.treeShell.requestFullscreen();
    else { showToast('Browserul nu suportă modul Full Screen pentru această pagină.'); return; }
  } catch (error) {
    console.error(error);
    showToast('Full Screen nu a putut fi activat.');
  }
}

function toggleMobileView() {
  const active = elements.treeShell.classList.toggle('mobile-view');
  updateViewModeButtons();
  requestAnimationFrame(() => {
    drawConnections();
    fitTree();
  });
  showToast(active ? 'Mobile view activat.' : 'Desktop view activat.');
}

function startCardDrag(event) {
  if (event.button !== 0 && event.pointerType !== 'touch') return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const card = handle.closest('.person-card');
  if (!card || state.pan || state.pinch) return;
  const id = card.dataset.id;
  state.drag = {
    id, card, handle, pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY,
    left: parseFloat(card.style.left) || 0,
    top: parseFloat(card.style.top) || 0,
    moved: false
  };
  handle.setPointerCapture(event.pointerId);
  card.classList.add('is-dragging');
  elements.treeViewport.classList.add('dragging-person');
  handle.addEventListener('pointermove', moveCardDrag);
  handle.addEventListener('pointerup', endCardDrag);
  handle.addEventListener('pointercancel', endCardDrag);
}

function moveCardDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  event.preventDefault();
  const dx = (event.clientX - state.drag.startX) / state.view.scale;
  const dy = (event.clientY - state.drag.startY) / state.view.scale;
  if (Math.hypot(dx, dy) > 4) state.drag.moved = true;
  const left = clamp(state.drag.left + dx, 20, STAGE_WIDTH - state.drag.card.offsetWidth - 20);
  const top = clamp(state.drag.top + dy, 20, STAGE_HEIGHT - state.drag.card.offsetHeight - 20);
  state.drag.card.style.left = `${left}px`;
  state.drag.card.style.top = `${top}px`;
  requestAnimationFrame(drawConnections);
}

async function endCardDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  const { card, handle, id, moved } = state.drag;
  card.classList.remove('is-dragging');
  elements.treeViewport.classList.remove('dragging-person');
  handle.removeEventListener('pointermove', moveCardDrag);
  handle.removeEventListener('pointerup', endCardDrag);
  handle.removeEventListener('pointercancel', endCardDrag);
  try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch (_) {}
  state.drag = null;
  if (!moved) return;

  const person = getPerson(id);
  if (!person) return;
  const left = Math.round(parseFloat(card.style.left) || 0);
  const top = Math.round(parseFloat(card.style.top) || 0);
  const manualGeneration = generationFromY(top);
  const snappedTop = generationY(manualGeneration);
  card.style.top = `${snappedTop}px`;
  drawConnections();
  const changed = { ...person, posX: left, posY: snappedTop, manualGeneration, updatedAt: new Date().toISOString() };
  try {
    await persistChange(changed);
    showToast(`Poziție salvată · Generația ${manualGeneration + 1}`);
  } catch (e) {
    console.error(e);
    showToast('Poziția nu a putut fi salvată.');
  }
}

async function movePersonGeneration(id, delta) {
  const person = getPerson(id);
  if (!person) return;
  const current = generationFor(person);
  const next = clamp(current + delta, 0, MAX_GENERATIONS - 1);
  if (next === current) { showToast(next === 0 ? 'Persoana este deja în prima generație.' : 'Ai ajuns la limita generațiilor.'); return; }
  const defaults = defaultLayoutPositions();
  const currentPos = personPosition(person, defaults);
  const changed = {
    ...person,
    manualGeneration: next,
    posX: Math.round(currentPos.x),
    posY: generationY(next),
    updatedAt: new Date().toISOString()
  };
  try {
    await persistChange(changed);
    showToast(`${person.name} → Generația ${next + 1}`);
  } catch (error) {
    console.error(error);
    showToast('Generația nu a putut fi salvată.');
  }
}

function isCanvasTarget(target) {
  return !target.closest('.person-card,button,input,select,textarea,a,label');
}

function startPan(event) {
  if (state.drag || state.pinch || !isCanvasTarget(event.target)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  state.pan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: state.view.x,
    y: state.view.y
  };
  elements.treeViewport.setPointerCapture(event.pointerId);
  elements.treeViewport.classList.add('is-panning');
}

function movePan(event) {
  if (!state.pan || state.drag || event.pointerId !== state.pan.pointerId) return;
  event.preventDefault();
  state.view.x = state.pan.x + (event.clientX - state.pan.startX);
  state.view.y = state.pan.y + (event.clientY - state.pan.startY);
  applyView();
}

function endPan(event) {
  if (!state.pan || event.pointerId !== state.pan.pointerId) return;
  try { if (elements.treeViewport.hasPointerCapture(event.pointerId)) elements.treeViewport.releasePointerCapture(event.pointerId); } catch (_) {}
  state.pan = null;
  elements.treeViewport.classList.remove('is-panning');
}

function zoomAt(delta, clientX, clientY) {
  const rect = elements.treeViewport.getBoundingClientRect();
  const factor = Math.exp(-delta * 0.0015);
  setZoom(state.view.scale * factor, clientX - rect.left, clientY - rect.top);
}

async function autoLayout() {
  if (!state.people.length) return;
  const defaults=defaultLayoutPositions(), now=new Date().toISOString();
  const changed=state.people.map((p)=>({...p,posX:Math.round(defaults.get(p.id).x),posY:Math.round(defaults.get(p.id).y),updatedAt:now}));
  state.records=mergeRecords(state.records,changed); state.people=state.records.filter((r)=>!r.deleted); render(); fitTree();
  try { setSyncStatus('Se salvează aranjarea…'); const remote=await fetchRemoteRecords(); const merged=mergeRecords(remote,state.records); await putRemoteRecords(merged); applyRecords(merged); fitTree(); setSyncStatus('Aranjare salvată','ok'); showToast('Arborele a fost rearanjat.'); } catch(e) { console.error(e); setSyncStatus('Salvarea a eșuat','error'); showToast('Aranjarea nu a putut fi salvată.'); }
}

function fillRelationSelects(currentId = '') {
  const selected={father:elements.father.value,mother:elements.mother.value,partner:elements.partner.value};
  const options=state.people.filter((p)=>p.id!==currentId).sort((a,b)=>a.name.localeCompare(b.name,'ro'));
  [elements.father,elements.mother,elements.partner].forEach((select)=>{select.innerHTML='<option value="">— Necunoscut / nespecificat —</option>'; options.forEach((p)=>{const o=document.createElement('option');o.value=p.id;o.textContent=`${p.name}${yearOf(p.birthDate)?` (${yearOf(p.birthDate)})`:''}`;select.appendChild(o);});});
  elements.father.value=selected.father;elements.mother.value=selected.mother;elements.partner.value=selected.partner;
}

function csvEscape(value){const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function parseCsv(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows;}
function utf8ToBase64(text){const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
function base64ToUtf8(base64){const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new TextDecoder().decode(bytes);}
function recordsToCsv(records){const rows=[['format','record_id','part','payload']];[...records].sort((a,b)=>String(a.id).localeCompare(String(b.id))).forEach((record)=>{const encoded=utf8ToBase64(JSON.stringify(record)),parts=Math.max(1,Math.ceil(encoded.length/CHUNK_SIZE));for(let part=0;part<parts;part++)rows.push([FORMAT_MARKER,record.id,`${part+1}/${parts}`,encoded.slice(part*CHUNK_SIZE,(part+1)*CHUNK_SIZE)]);});return rows.map((r)=>r.map(csvEscape).join(',')).join('\n');}
function csvToRecords(csv){if(!csv.trim())return[];const rows=parseCsv(csv),grouped=new Map();for(const row of rows){if(row[0]!==FORMAT_MARKER||!row[1]||!row[2])continue;const[p,t]=row[2].split('/').map(Number);if(!Number.isInteger(p)||!Number.isInteger(t)||p<1||t<1)continue;if(!grouped.has(row[1]))grouped.set(row[1],{total:t,chunks:[]});grouped.get(row[1]).chunks[p-1]=row[3]||'';}const records=[];for(const{total,chunks}of grouped.values()){if(chunks.length!==total||chunks.some((c)=>typeof c!=='string'))continue;try{records.push(JSON.parse(base64ToUtf8(chunks.join(''))));}catch(e){console.warn('Înregistrare genealogică invalidă ignorată.',e);}}return records.filter((x)=>x&&x.id&&x.updatedAt);}
function mergeRecords(...collections){const merged=new Map();collections.flat().forEach((r)=>{if(!r?.id)return;const cur=merged.get(r.id);if(!cur||String(r.updatedAt||'')>String(cur.updatedAt||''))merged.set(r.id,r);});return[...merged.values()];}
function applyRecords(records){state.records=records;state.people=records.filter((r)=>!r.deleted);render();}
async function fetchRemoteRecords(){const res=await fetch(`${ETHERCALC_CSV_URL}?t=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw new Error(`EtherCalc a răspuns cu status ${res.status}.`);return csvToRecords(await res.text());}
async function putRemoteRecords(records){const csv=recordsToCsv(records);const res=await fetch(ETHERCALC_WRITE_URL,{method:'PUT',headers:{'Content-Type':'text/csv;charset=UTF-8'},body:csv});if(!res.ok)throw new Error(`EtherCalc nu a acceptat salvarea (${res.status}).`);return csv;}
async function syncFromRemote({notify=false}={}){if(state.syncing)return;state.syncing=true;setSyncStatus('Se sincronizează…');try{const remote=await fetchRemoteRecords();const sig=JSON.stringify(remote.map((r)=>[r.id,r.updatedAt,!!r.deleted]).sort());if(sig!==state.lastRemoteSignature){applyRecords(mergeRecords(state.records,remote));state.lastRemoteSignature=sig;}setSyncStatus(`Sincronizat ${new Date().toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})}`,'ok');if(notify)showToast('Arborele a fost sincronizat.');}catch(e){console.error(e);setSyncStatus('Eroare de conectare','error');if(notify)showToast('Nu am putut accesa EtherCalc.');}finally{state.syncing=false;}}
async function persistChange(changedRecord){state.saveQueue=state.saveQueue.then(async()=>{setSyncStatus('Se salvează…');let remote=await fetchRemoteRecords();let merged=mergeRecords(remote,state.records,[changedRecord]);await putRemoteRecords(merged);remote=await fetchRemoteRecords();const verified=mergeRecords(remote,merged);if(verified.length!==remote.length||verified.some((r)=>!remote.find((x)=>x.id===r.id&&x.updatedAt===r.updatedAt))){await putRemoteRecords(verified);merged=verified;}else merged=remote;applyRecords(merged);state.lastRemoteSignature=JSON.stringify(merged.map((r)=>[r.id,r.updatedAt,!!r.deleted]).sort());setSyncStatus('Salvat în EtherCalc','ok');});return state.saveQueue;}

function resetImagePreview(){state.pendingImage=null;state.removeExistingImage=false;elements.image.value='';elements.imagePreview.removeAttribute('src');elements.imagePreview.hidden=true;elements.imagePrompt.hidden=false;elements.removeImage.hidden=true;}
function showImagePreview(source){elements.imagePreview.src=source;elements.imagePreview.hidden=false;elements.imagePrompt.hidden=true;elements.removeImage.hidden=false;}
function clearErrors(){document.querySelectorAll('.error').forEach((el)=>el.textContent='');elements.name.classList.remove('invalid');}
function openAddModal(){elements.form.reset();resetImagePreview();elements.id.value='';fillRelationSelects('');elements.generation.value='auto';elements.modalTitle.textContent='Adaugă o persoană';clearErrors();elements.dialog.showModal();setTimeout(()=>elements.name.focus(),50);}
function openEditModal(id){const p=getPerson(id);if(!p)return;elements.form.reset();resetImagePreview();elements.id.value=p.id;fillRelationSelects(p.id);elements.name.value=p.name||'';elements.nickname.value=p.nickname||'';elements.gender.value=p.gender||'';elements.birthName.value=p.birthName||'';elements.birthDate.value=p.birthDate||'';elements.birthPlace.value=p.birthPlace||'';elements.deathDate.value=p.deathDate||'';elements.deathPlace.value=p.deathPlace||'';elements.generation.value=(p.manualGeneration!==null&&p.manualGeneration!==undefined&&p.manualGeneration!==''&&Number.isInteger(Number(p.manualGeneration)))?String(Number(p.manualGeneration)):'auto';elements.father.value=p.fatherId||'';elements.mother.value=p.motherId||'';elements.partner.value=p.partnerId||'';elements.notes.value=p.notes||'';elements.modalTitle.textContent='Editează persoana';if(p.image)showImagePreview(p.image);clearErrors();elements.dialog.showModal();}
function closeModal(){elements.dialog.close();resetImagePreview();}
function validateForm(){clearErrors();if(!elements.name.value.trim()){document.querySelector('[data-error-for="name"]').textContent='Introdu numele persoanei.';elements.name.classList.add('invalid');elements.name.focus();return false;}const id=elements.id.value;if([elements.father.value,elements.mother.value,elements.partner.value].includes(id)&&id){showToast('O persoană nu poate fi propriul părinte sau partener.');return false;}return true;}
async function optimizeImage(file){if(!file)return null;if(!file.type.startsWith('image/'))throw new Error('Fișierul ales nu este o imagine.');const bitmap=await createImageBitmap(file),maxSide=760,scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise((resolve,reject)=>canvas.toBlob((blob)=>{if(!blob)return reject(new Error('Imaginea nu a putut fi procesată.'));const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);},'image/jpeg',.66));}
async function handleImage(file){try{setSyncStatus('Se procesează fotografia…');state.pendingImage=await optimizeImage(file);state.removeExistingImage=false;showImagePreview(state.pendingImage);setSyncStatus('Fotografia este pregătită','ok');}catch(e){showToast(e.message);elements.image.value='';}}
async function handleSubmit(event){event.preventDefault();if(!validateForm())return;const id=elements.id.value||crypto.randomUUID(),existing=getPerson(id),defaults=defaultLayoutPositions(),fallback=defaults.get(id)||{x:STAGE_WIDTH/2-CARD_W/2,y:STAGE_HEIGHT/2-CARD_H/2},now=new Date().toISOString();const person={id,name:elements.name.value.trim(),nickname:elements.nickname.value.trim(),gender:elements.gender.value,birthName:elements.birthName.value.trim(),birthDate:elements.birthDate.value,birthPlace:elements.birthPlace.value.trim(),deathDate:elements.deathDate.value,deathPlace:elements.deathPlace.value.trim(),manualGeneration:elements.generation.value==='auto'?null:Number(elements.generation.value),fatherId:elements.father.value,motherId:elements.mother.value,partnerId:elements.partner.value,notes:elements.notes.value.trim(),image:state.removeExistingImage?null:(state.pendingImage||existing?.image||null),posX:existing?.posX??fallback.x,posY:existing?.posY??fallback.y,createdAt:existing?.createdAt||now,updatedAt:now,deleted:false};
if (Number.isInteger(person.manualGeneration)) person.posY = generationY(person.manualGeneration);
try{await persistChange(person);closeModal();showToast(existing?'Persoana a fost actualizată.':'Persoana a fost adăugată în arbore.');}catch(e){console.error(e);setSyncStatus('Salvarea a eșuat','error');showToast('Nu am putut salva în EtherCalc.');}}
function askDelete(id){state.deleteId=id;elements.confirmDialog.showModal();}
async function confirmDelete(){const existing=getPerson(state.deleteId);if(!existing)return;const tombstone={...existing,image:null,deleted:true,updatedAt:new Date().toISOString()};state.deleteId=null;try{await persistChange(tombstone);showToast('Persoana a fost ștearsă din arbore.');}catch(e){console.error(e);showToast('Ștergerea nu a putut fi salvată.');}}
let toastTimer;function showToast(message){clearTimeout(toastTimer);elements.toast.textContent=message;elements.toast.classList.add('show');toastTimer=setTimeout(()=>elements.toast.classList.remove('show'),3200);}

$('#openAddModal').addEventListener('click',openAddModal);$('#emptyAddButton').addEventListener('click',openAddModal);$('#closeModal').addEventListener('click',closeModal);$('#cancelButton').addEventListener('click',closeModal);elements.form.addEventListener('submit',handleSubmit);
elements.search.addEventListener('input',(e)=>{state.search=e.target.value;render();});elements.image.addEventListener('change',(e)=>{const[file]=e.target.files;if(file)handleImage(file);});elements.removeImage.addEventListener('click',()=>{state.pendingImage=null;state.removeExistingImage=true;elements.image.value='';elements.imagePreview.removeAttribute('src');elements.imagePreview.hidden=true;elements.imagePrompt.hidden=false;elements.removeImage.hidden=true;});
elements.syncButton.addEventListener('click',()=>syncFromRemote({notify:true}));elements.confirmDialog.addEventListener('close',()=>{if(elements.confirmDialog.returnValue==='confirm')confirmDelete();else state.deleteId=null;});elements.dialog.addEventListener('click',(e)=>{if(e.target===elements.dialog)closeModal();});
elements.zoomIn.addEventListener('click',()=>setZoom(state.view.scale+.15));elements.zoomOut.addEventListener('click',()=>setZoom(state.view.scale-.15));elements.zoomReset.addEventListener('click',()=>{state.view={x:80,y:50,scale:1};applyView();});elements.fitTree.addEventListener('click',fitTree);elements.autoLayout.addEventListener('click',autoLayout);elements.fullscreen?.addEventListener('click',toggleFullscreen);elements.mobileView?.addEventListener('click',toggleMobileView);document.addEventListener('fullscreenchange',()=>{updateViewModeButtons();requestAnimationFrame(()=>{drawConnections();fitTree();});});
elements.treeViewport.addEventListener('wheel',(e)=>{e.preventDefault(); zoomAt(e.deltaY,e.clientX,e.clientY);},{passive:false});
elements.treeViewport.addEventListener('pointerdown',startPan);
elements.treeViewport.addEventListener('pointermove',movePan);
elements.treeViewport.addEventListener('pointerup',endPan);
elements.treeViewport.addEventListener('pointercancel',endPan);
elements.treeViewport.addEventListener('lostpointercapture',()=>{ if(state.pan){state.pan=null;elements.treeViewport.classList.remove('is-panning');} });
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncFromRemote();});window.addEventListener('focus',()=>syncFromRemote());window.addEventListener('online',()=>syncFromRemote({notify:true}));window.addEventListener('resize',()=>requestAnimationFrame(drawConnections));setInterval(()=>{if(!document.hidden)syncFromRemote();},SYNC_INTERVAL_MS);updateViewModeButtons();syncFromRemote({notify:false});
