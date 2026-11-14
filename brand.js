(() => {
  const splash = document.getElementById('brand-splash');
  const welcome = document.getElementById('welcome-screen');
  const topic = document.getElementById('topic');
  const shouldWelcome = !localStorage.getItem('zhiying-welcome-seen') || new URLSearchParams(location.search).has('welcome');
  let finished = false;

  const finishSplash = () => {
    if (finished) return;
    finished = true;
    splash.classList.add('leaving');
    setTimeout(() => {
      splash.hidden = true;
      if (shouldWelcome) {
        welcome.hidden = false;
        requestAnimationFrame(() => welcome.classList.add('visible'));
      }
    }, 420);
  };

  const enter = () => {
    localStorage.setItem('zhiying-welcome-seen', '1');
    welcome.classList.remove('visible');
    setTimeout(() => {
      welcome.hidden = true;
      topic.focus();
    }, 320);
  };

  document.getElementById('splash-skip').addEventListener('click', finishSplash);
  setTimeout(finishSplash, matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 2100);
  document.getElementById('welcome-enter').addEventListener('click', enter);
  document.getElementById('welcome-guide').addEventListener('click', () => {
    enter();
    setTimeout(() => {
      const toast = document.getElementById('app-toast');
      toast.textContent = '创作只需四步：输入主题 → 选择创意 → 编辑分镜 → 预览导出。';
      toast.classList.add('visible');
      setTimeout(() => toast.classList.remove('visible'), 3600);
    }, 380);
  });
  document.querySelectorAll('[data-topic-starter]').forEach(button => button.addEventListener('click', () => {
    topic.value = button.dataset.topicStarter;
    topic.dispatchEvent(new Event('input', { bubbles: true }));
    topic.focus();
    topic.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
})();
