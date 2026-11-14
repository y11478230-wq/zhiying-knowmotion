(() => {
  const splash = document.getElementById('brand-splash');
  const welcome = document.getElementById('welcome-screen');
  const topic = document.getElementById('topic');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shouldWelcome = !localStorage.getItem('zhiying-welcome-seen') || new URLSearchParams(location.search).has('welcome');
  let finished = false, scene = null;
  const timers = [];
  const later = (callback, delay) => timers.push(setTimeout(callback, delay));

  const finishSplash = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    scene?.exit();
    splash.classList.add('leaving');
    setTimeout(() => {
      scene?.dispose(); scene = null;
      splash.hidden = true;
      if (shouldWelcome) {
        welcome.hidden = false;
        requestAnimationFrame(() => welcome.classList.add('visible'));
      }
    }, reduced ? 0 : 760);
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
  if (reduced) { splash.classList.add('fallback', 'brand-visible'); later(finishSplash, 500); }
  else {
    try { scene = globalThis.createParticleScene?.(document.getElementById('particle-canvas')); if (!scene) splash.classList.add('fallback'); }
    catch (error) { console.warn('粒子场不可用，已使用静态视觉。', error); splash.classList.add('fallback'); }
    later(() => splash.classList.add('brand-visible'), 3050);
    later(finishSplash, 5600);
  }
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
