/**
 * Save Slot Selection & Management Modal UI.
 * Handles slot picking for New Game, Load Game, Overwrite Confirmation, and Delete.
 */

import { listSaveSlots, deleteSaveSlot, setActiveSlot, getActiveSlot } from './save_slots.js';

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
        const icon = CLASS_ICONS[h.classKey] || '⚔️';
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

    // Overwrite / Delete confirm buttons
    if (confirmAction) {
      const cancelBtn = modal.querySelector('#confirm-cancel-btn');
      if (cancelBtn) cancelBtn.onclick = () => render(null);

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
