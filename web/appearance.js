// Shared presentation preference only. No project data or network requests.
(function () {
  'use strict';
  var root = document.documentElement;
  var key = 'praxis-appearance';
  var theme = 'light';
  try { theme = localStorage.getItem(key) === 'dark' ? 'dark' : 'light'; } catch {}
  root.dataset.theme = theme;

  function update() {
    document.querySelectorAll('[data-appearance]').forEach(function (button) {
      var label = 'Use ' + (root.dataset.theme === 'dark' ? 'light' : 'dark') + ' theme';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
  }
  function initialize() {
    update();
    document.querySelectorAll('[data-appearance]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try { localStorage.setItem(key, next); } catch {}
        update();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  window.addEventListener('storage', function (event) {
    if (event.key !== key) return;
    root.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    update();
  });
})();
