(function () {
  var s = document.currentScript;
  if (!s) return;
  var k = s.getAttribute('data-k');
  if (!k) return;
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    try {
      fetch('/api/hb', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'k=' + encodeURIComponent(k),
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* no-op */ }
  }, 30000);
})();
