// WP-IP-LOCKDOWN — client-side deterrence layer. Loaded ONLY on protected
// content views for client roles (hab_admin never gets body.hab-protected).
//
// This layer is deterrence, not DRM. The print stylesheet and the server-side
// watermark in the delivered HTML are the real controls; this script adds the
// branded UX (modal instead of the print dialog) and friction (copy notice,
// context menu suppression). HONEST LIMIT: OS-level screenshots and screen
// recording cannot be prevented from a browser. The visible watermark carrying
// the licensee's name and email is the screenshot deterrent.
(function () {
  'use strict';
  if (!document.body || !document.body.classList.contains('hab-protected')) return;

  var COPY_NOTICE = 'HAB Academy content is licensed for personal, on-screen use only. ' +
    'Copying is disabled. Team access is available through an HAB enterprise subscription.';

  // ----- Branded modal (shown instead of the print dialog) -----
  var backdrop = null;
  function showModal(title, msg) {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'hab-modal-backdrop';
      backdrop.innerHTML =
        '<div class="hab-modal" role="alertdialog" aria-modal="true">' +
        '<div class="hab-modal-shield">HAB</div>' +
        '<h2></h2><p></p>' +
        '<button type="button" class="hab-notice-btn" data-close>Back to reading</button>' +
        '</div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.hasAttribute('data-close')) hideModal();
      });
      document.body.appendChild(backdrop);
    }
    backdrop.querySelector('h2').textContent = title;
    backdrop.querySelector('p').textContent = msg;
    backdrop.style.display = 'flex';
  }
  function hideModal() { if (backdrop) backdrop.style.display = 'none'; }

  // ----- Print / save shortcut interception (Ctrl/Cmd+P, Ctrl/Cmd+S) -----
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 's')) {
      e.preventDefault();
      e.stopPropagation();
      showModal(
        k === 'p' ? 'Printing is disabled' : 'Saving is disabled',
        'HAB Academy content is licensed for on-screen personal use only. ' +
        'Need printed books for your counter? Printed copies are available to order in the app. ' +
        'Team access is available through an HAB enterprise subscription.'
      );
    }
  }, true);

  // Print via browser menu: cannot be cancelled, but the print stylesheet
  // blanks every page. Show the branded explanation as well.
  window.addEventListener('beforeprint', function () {
    showModal('Printing is disabled',
      'HAB Academy content is licensed for on-screen personal use only. The printed output is blank by design.');
  });
  window.addEventListener('keyup', function (e) {
    if (e.key === 'Escape') hideModal();
  });

  // ----- Context menu suppressed on content containers only -----
  document.addEventListener('contextmenu', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.hab-nocopy') : null;
    if (el) e.preventDefault();
  });

  // ----- Copy/cut from content returns the license notice instead -----
  function onCopy(e) {
    var sel = document.getSelection();
    var node = sel && sel.anchorNode;
    var el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
    if (el && el.closest && el.closest('.hab-nocopy') && e.clipboardData) {
      e.clipboardData.setData('text/plain', COPY_NOTICE);
      e.preventDefault();
    }
  }
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);

  // ----- Images inside content: not draggable -----
  Array.prototype.forEach.call(document.querySelectorAll('.hab-nocopy img'), function (img) {
    img.setAttribute('draggable', 'false');
  });
  document.addEventListener('dragstart', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.hab-nocopy') : null;
    if (el) e.preventDefault();
  });

  // ----- Watermark guard -----
  // The watermark is server-rendered into the HTML. This guard re-inserts it
  // if the node is deleted and clears inline hiding, raising the effort bar.
  // A determined user with devtools can still fight it; that is expected —
  // the watermark's job is attribution on captures, not being unremovable.
  var wm = document.querySelector('.hab-watermark');
  if (wm) {
    var wmHtml = wm.outerHTML;
    setInterval(function () {
      var cur = document.querySelector('.hab-watermark');
      if (!cur) {
        document.body.insertAdjacentHTML('afterbegin', wmHtml);
      } else {
        cur.style.display = '';
        cur.style.visibility = '';
        cur.style.opacity = '';
      }
    }, 3000);
  }

  // ----- Content License notice dismiss -----
  var notice = document.getElementById('hab-license-notice');
  if (notice) {
    var btn = notice.querySelector('[data-dismiss]');
    if (btn) btn.addEventListener('click', function () { notice.remove(); });
  }
})();
