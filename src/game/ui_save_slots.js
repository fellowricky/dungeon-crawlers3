/**
 * Save Slot Selection & Management Modal UI.
 * Handles slot picking for New Game, Load Game, Overwrite Confirmation, and Delete.
 */

import { listSaveSlots, deleteSaveSlot, setActiveSlot, getActiveSlot,
         exportSlotFile, parseSaveFile, importSaveInto } from './save_slots.js';
import { reportError } from './errors.js';

import { iconHtml } from './icons.js';
let _modalEl = null;

const CLASS_ICONS = {
  fighter: '⚔️', rogue: '🗡️', cleric: '✨', wizard: '🔮',
  barbarian: '🪓', bard: '🎵', druid: '🌿', monk: '🥋',
  paladin: '🛡️', ranger: '🏹', sorcerer: '🔮', warlock: '💀'
};

function getOrCreateModal() {
  if (_modalEl && document.body.contains(_modalEl)) return _modalEl;
  const el = document.createElement('div');
  el.id = 'save-slots-modal';
  el.className = 'save-slots-overlay';
  document.body.appendChild(el);
  _modalEl = el;
  return el;
}

/**
 * Opens the Save Slots modal.
 * @param {Object} options
 * @param {'new'|'load'} options.mode - 'new' to select slot for new party, 'load' to continue/switch save
 * @param {Function} options.onSelect - callback(slotId, isNewGame)
 * @param {Function} options.onCancel - callback()
 */
export function showSaveSlotsModal({ mode = 'load', onSelect, onCancel }) {
  const modal = getOrCreateModal();
  modal.classList.add('show');

  const render = (confirmAction = null) => {
    const slots = listSaveSlots();
    const activeSlot = getActiveSlot();
    const isNew = mode === 'new';

    const titleText = isNew ? 'NEW CAMPAIGN — SELECT SAVE SLOT' : 'LOAD SAVED GAME';
    const subText = isNew
      ? 'Choose a save slot for your new company. Starting in an occupied slot will prompt before overwriting.'
      : 'Select a saved company to resume your adventure.';

    let slotsHtml = slots.map(slot => {
      const isCurrentActive = slot.slotId === activeSlot && !slot.empty;

      if (slot.empty) {
        return `
          <div class="save-slot-card empty ${isNew ? 'clickable-new' : ''}" data-slot="${slot.slotId}">
            <div class="slot-card-header">
              <span class="slot-number-badge">SLOT ${slot.slotId}</span>
              <span class="slot-status-empty">[ EMPTY SLOT ]</span>
            </div>
            <div class="slot-card-body empty-body">
              <div class="empty-slot-icon">📜</div>
              <div class="empty-slot-desc">No saved company data</div>
            </div>
            <div class="slot-card-footer">
              ${isNew
                ? `<button class="btn primary slot-act-btn" data-action="pick-new" data-slot="${slot.slotId}">➕ Start New Game</button>`
                : `<button class="btn disabled slot-act-btn" disabled>Empty</button>`
              }
            </div>
          </div>
        `;
      }

      // Occupied slot
      const partyChips = slot.heroes.map(h => {
        const icon = iconHtml('class', h.classKey, CLASS_ICONS[h.classKey] || '⚔️');
        const clsLabel = h.classKey ? (h.classKey[0].toUpperCase() + h.classKey.slice(1)) : 'Hero';
        return `
          <div class="slot-hero-chip">
            <span class="hero-chip-icon">${icon}</span>
            <span class="hero-chip-name">${h.name}</span>
            <span class="hero-chip-lvl">Lv.${h.level} ${clsLabel}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="save-slot-card occupied ${isCurrentActive ? 'current-active' : ''}" data-slot="${slot.slotId}">
          <div class="slot-card-header">
            <div class="slot-card-title-group">
              <span class="slot-number-badge">SLOT ${slot.slotId}</span>
              ${isCurrentActive ? '<span class="slot-active-tag">CURRENT</span>' : ''}
            </div>
            <span class="slot-timestamp">${slot.formattedDate || 'Saved'}</span>
          </div>
          <div class="slot-card-body">
            <div class="slot-party-roster">
              ${partyChips}
            </div>
            <div class="slot-meta-row">
              <span class="slot-meta-badge location">📍 ${slot.locationText}</span>
              <span class="slot-meta-badge gold">💰 ${slot.gold.toLocaleString()}g</span>
            </div>
          </div>
          <div class="slot-card-footer">
            <div class="slot-actions-left">
              <button class="btn danger-btn slot-del-btn" data-action="delete" data-slot="${slot.slotId}" title="Delete this save slot">🗑️ Delete</button>
              <button class="btn slot-export-btn" data-slot="${slot.slotId}" title="Download this save as a file you can keep or move to another computer">⬇ Export</button>
            </div>
            <div class="slot-actions-right">
              ${isNew
                ? `<button class="btn warn-btn slot-act-btn" data-action="prompt-overwrite" data-slot="${slot.slotId}">⚠️ Overwrite</button>`
                : `<button class="btn primary slot-act-btn" data-action="load" data-slot="${slot.slotId}">▶ Resume</button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    let confirmOverlayHtml = '';
    if (confirmAction) {
      if (confirmAction.type === 'overwrite') {
        const slot = slots.find(s => s.slotId === confirmAction.slotId);
        const partySummary = (slot?.heroes || []).map(h => `${h.name} (Lv.${h.level})`).join(', ') || 'Unknown Company';
        confirmOverlayHtml = `
          <div class="save-slot-confirm-backdrop">
            <div class="save-slot-confirm-dialog">
              <h3 class="confirm-warn-title">⚠️ Overwrite Save Slot ${confirmAction.slotId}?</h3>
              <p class="confirm-text">
                Slot ${confirmAction.slotId} currently holds <strong>${partySummary}</strong>.
              </p>
              <p class="confirm-subtext">Starting a new campaign in this slot will permanently delete this progress.</p>
              <div class="confirm-actions">
                <button class="btn warn-btn" id="confirm-overwrite-btn">Yes, Overwrite & Start</button>
                <button class="btn" id="confirm-cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        `;
      } else if (confirmAction.type === 'import') {
        const file = confirmAction.file;
        const party = file.heroes.map(h => `${h.name} (Lv.${h.level})`).join(', ');
        const when = file.exportedAt ? new Date(file.exportedAt).toLocaleString() : 'unknown date';
        const choices = slots.map(slot => {
          const holds = slot.empty ? 'empty' : `overwrite ${(slot.heroes || []).map(h => h.name).join(', ')}`;
          return `<button class="btn ${slot.empty ? 'primary' : 'warn-btn'} import-target-btn" data-slot="${slot.slotId}">Slot ${slot.slotId} — ${holds}</button>`;
        }).join('');
        confirmOverlayHtml = `
          <div class="save-slot-confirm-backdrop">
            <div class="save-slot-confirm-dialog">
              <h3 class="confirm-warn-title">⬆ Import Save</h3>
              <p class="confirm-text">The file holds <strong>${party}</strong>, exported ${when}.</p>
              <p class="confirm-subtext">Choose the slot to put it in. An occupied slot is replaced — that cannot be undone.</p>
              <div class="confirm-actions import-targets">${choices}</div>
              <div class="confirm-actions">
                <button class="btn" id="confirm-cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        `;
      } else if (confirmAction.type === 'error') {
        confirmOverlayHtml = `
          <div class="save-slot-confirm-backdrop">
            <div class="save-slot-confirm-dialog danger">
              <h3 class="confirm-danger-title">Could not import</h3>
              <p class="confirm-text">${confirmAction.message}</p>
              <div class="confirm-actions">
                <button class="btn" id="confirm-cancel-btn">OK</button>
              </div>
            </div>
          </div>
        `;
      } else if (confirmAction.type === 'delete') {
        const slot = slots.find(s => s.slotId === confirmAction.slotId);
        const partySummary = (slot?.heroes || []).map(h => `${h.name} (Lv.${h.level})`).join(', ') || 'Saved Data';
        confirmOverlayHtml = `
          <div class="save-slot-confirm-backdrop">
            <div class="save-slot-confirm-dialog danger">
              <h3 class="confirm-danger-title">🗑️ Delete Save Slot ${confirmAction.slotId}?</h3>
              <p class="confirm-text">
                Are you sure you want to delete <strong>Slot ${confirmAction.slotId} (${partySummary})</strong>?
              </p>
              <p class="confirm-subtext">This action cannot be undone.</p>
              <div class="confirm-actions">
                <button class="btn danger-btn" id="confirm-delete-btn">Yes, Delete Slot</button>
                <button class="btn" id="confirm-cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        `;
      }
    }

    modal.innerHTML = `
      <div class="save-slots-panel">
        <div class="save-slots-header">
          <h2 class="save-slots-title">${titleText}</h2>
          <p class="save-slots-subtitle">${subText}</p>
        </div>
        <div class="save-slots-list">
          ${slotsHtml}
        </div>
        <div class="save-slots-bottom-bar">
          <button class="btn" id="save-slots-back-btn">↩ Back to Menu</button>
          <button class="btn" id="save-slots-import-btn" title="Load a save file exported from this game">⬆ Import save file…</button>
          <input type="file" id="save-slots-import-file" accept=".json,application/json" hidden>
        </div>
        ${confirmOverlayHtml}
      </div>
    `;

    // Event listeners
    const backBtn = modal.querySelector('#save-slots-back-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        closeModal();
        if (onCancel) onCancel();
      };
    }

    /* Import: the file picker is opened from the bar; the parsed file then
       comes back through the confirm dialog so the player picks the slot. */
    const importBtn = modal.querySelector('#save-slots-import-btn');
    const importFile = modal.querySelector('#save-slots-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = () => {
        const f = importFile.files && importFile.files[0];
        if (!f) return;
        f.text().then(text => {
          try { render({ type: 'import', file: parseSaveFile(text) }); }
          catch (e) { render({ type: 'error', message: e.message }); }
        }).catch(e => { reportError('read save file', e, 'warn'); render({ type: 'error', message: 'The file could not be read.' }); });
      };
    }

    // Export: download the slot as a file.
    modal.querySelectorAll('.slot-export-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const out = exportSlotFile(parseInt(btn.dataset.slot, 10));
        if (!out) return;
        const blob = new Blob([out.text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = out.filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
    });

    // Overwrite / Delete / Import confirm buttons
    if (confirmAction) {
      const cancelBtn = modal.querySelector('#confirm-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => render(null);

      modal.querySelectorAll('.import-target-btn').forEach(b => {
        b.onclick = () => {
          const target = parseInt(b.dataset.slot, 10);
          try {
            importSaveInto(target, confirmAction.file);
            render(null);
          } catch (e) {
            render({ type: 'error', message: e.quota
              ? 'Browser storage is full — delete a slot or free space and try again.'
              : 'The save could not be written.' });
          }
        };
      });

      const overwriteBtn = modal.querySelector('#confirm-overwrite-btn');
      if (overwriteBtn) {
        overwriteBtn.onclick = () => {
          closeModal();
          setActiveSlot(confirmAction.slotId);
          if (onSelect) onSelect(confirmAction.slotId, true);
        };
      }

      const deleteBtn = modal.querySelector('#confirm-delete-btn');
      if (deleteBtn) {
        deleteBtn.onclick = () => {
          deleteSaveSlot(confirmAction.slotId);
          render(null);
        };
      }
      return;
    }

    // Action button clicks
    modal.querySelectorAll('.slot-act-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const slotId = parseInt(btn.dataset.slot, 10);
        if (action === 'pick-new') {
          closeModal();
          setActiveSlot(slotId);
          if (onSelect) onSelect(slotId, true);
        } else if (action === 'load') {
          closeModal();
          setActiveSlot(slotId);
          if (onSelect) onSelect(slotId, false);
        } else if (action === 'prompt-overwrite') {
          render({ type: 'overwrite', slotId });
        }
      };
    });

    // Delete button clicks
    modal.querySelectorAll('.slot-del-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slotId = parseInt(btn.dataset.slot, 10);
        render({ type: 'delete', slotId });
      };
    });

    // Direct card clicks in New Game mode for empty cards
    if (isNew) {
      modal.querySelectorAll('.save-slot-card.empty').forEach(card => {
        card.onclick = () => {
          const slotId = parseInt(card.dataset.slot, 10);
          closeModal();
          setActiveSlot(slotId);
          if (onSelect) onSelect(slotId, true);
        };
      });
    }
  };

  const closeModal = () => {
    modal.classList.remove('show');
  };

  render();
}
