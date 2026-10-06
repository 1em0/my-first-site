// 深色 / 浅色模式切换：手动选择保存在 localStorage，未选择时跟随系统
(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  var STORAGE_KEY = 'theme';

  function getSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function save(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* 隐私模式等情况下可能写不进去，忽略即可 */
    }
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function currentIsDark() {
    var attr = root.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return systemPrefersDark();
  }

  // 页面加载时应用之前保存的选择
  var saved = getSaved();
  if (saved === 'dark' || saved === 'light') {
    root.setAttribute('data-theme', saved);
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = currentIsDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      save(next);
    });
  }
})();

// 页脚年份
(function () {
  var year = document.getElementById('year');
  if (year) {
    year.textContent = new Date().getFullYear();
  }
})();
