let currentStatus = null;
let modalWorldId = null;

async function fetchJSON(url) {
  const r = await fetch(url);
  return r.json();
}

async function refreshStatus() {
  try { currentStatus = await fetchJSON('api/status'); }
  catch { currentStatus = { active: false, error: true }; }
  renderStatus();
}

function renderStatus() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (!currentStatus || currentStatus.error) {
    dot.className = 'status-dot dot-error';
    text.textContent = 'Cannot reach Foundry VTT';
    return;
  }
  if (currentStatus.active) {
    dot.className = 'status-dot dot-active';
    text.textContent = `World active: ${currentStatus.world} — ${currentStatus.users ?? 0} user(s) connected`;
  } else {
    dot.className = 'status-dot dot-inactive';
    text.textContent = 'No world running — select one below to launch';
  }
  document.querySelectorAll('.card').forEach(card => {
    const isActive = currentStatus.active && currentStatus.world === card.dataset.worldId;
    card.classList.toggle('active-world', isActive);
  });
}

function openModal(worldId, worldName) {
  if (currentStatus?.active) return;
  modalWorldId = worldId;
  document.getElementById('modal-title').textContent = worldName;
  document.getElementById('modal-pw').value = '';
  document.getElementById('modal-msg').classList.remove('visible');
  document.getElementById('modal-launch-btn').disabled = false;
  document.getElementById('modal-launch-btn').textContent = 'Launch World';
  document.getElementById('modal-backdrop').classList.add('open');
  setTimeout(() => document.getElementById('modal-pw').focus(), 50);
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-backdrop')) return;
  document.getElementById('modal-backdrop').classList.remove('open');
  modalWorldId = null;
}

async function submitModal() {
  const password = document.getElementById('modal-pw').value.trim();
  if (!password) {
    showModalMsg('error', 'Enter the password first.');
    return;
  }
  const btn = document.getElementById('modal-launch-btn');
  btn.disabled = true;
  btn.textContent = 'Launching…';
  document.getElementById('modal-msg').classList.remove('visible');

  try {
    const res = await fetch('api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: modalWorldId, password }),
    });
    const data = await res.json();
    if (data.ok) {
      showModalMsg('success', 'World launched! Redirecting…');
      setTimeout(() => { window.location.href = '/'; }, 2000);
    } else {
      showModalMsg('error', data.error || 'Launch failed.');
      btn.disabled = false;
      btn.textContent = 'Launch World';
    }
  } catch {
    showModalMsg('error', 'Network error — please try again.');
    btn.disabled = false;
    btn.textContent = 'Launch World';
  }
}

function showModalMsg(type, text) {
  const el = document.getElementById('modal-msg');
  el.className = `modal-msg ${type} visible`;
  el.textContent = text;
}

async function loadWorlds() {
  let worlds;
  try { worlds = await fetchJSON('api/worlds'); }
  catch {
    document.getElementById('worlds').innerHTML = '<div class="empty">Failed to load worlds.</div>';
    return;
  }
  if (!Array.isArray(worlds) || !worlds.length) {
    document.getElementById('worlds').innerHTML = '<div class="empty">No worlds configured.</div>';
    return;
  }
  document.getElementById('worlds').innerHTML = worlds.map(w => {
    const isActive = currentStatus?.active && currentStatus?.world === w.id;
    return `
      <div class="card ${isActive ? 'active-world' : ''}" data-world-id="${w.id}" data-world-name="${esc(w.name)}">
        <img class="card-image" src="api/world-bg/${w.id}" alt="">
        <div class="card-image-placeholder" style="display:none">⚔</div>
        <div class="card-overlay">${esc(w.name)}</div>
        <div class="card-footer">
          <span>${w.lastPlayed ? fmtDate(w.lastPlayed) : ''}</span>
          <span class="card-system">${esc(w.system)}</span>
        </div>
        <div class="card-active-badge">Active</div>
      </div>`;
  }).join('');

  document.querySelectorAll('.card-image').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      img.nextElementSibling.style.display = 'flex';
    });
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('modal-launch-btn').addEventListener('click', submitModal);
  document.getElementById('modal-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitModal();
  });
  document.querySelectorAll('.modal-close, .btn-cancel').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  document.getElementById('worlds').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    openModal(card.dataset.worldId, card.dataset.worldName);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  refreshStatus().then(loadWorlds);
  setInterval(refreshStatus, 30_000);
});
