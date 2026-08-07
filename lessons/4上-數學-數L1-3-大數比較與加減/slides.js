(() => {
  document.documentElement.classList.add('js');

  const STAGE_WIDTH = 1600;
  const STAGE_HEIGHT = 900;
  const stage = document.querySelector('#stage');
  const slides = [...document.querySelectorAll('.slide')];
  const current = document.querySelector('[data-current]');
  const total = document.querySelector('[data-total]');
  const step = document.querySelector('[data-step]');
  const progress = document.querySelector('[data-progress]');
  let index = 0;

  if (!stage || slides.length === 0) return;

  const clamp = (value) => Math.max(0, Math.min(value, slides.length - 1));

  /* ── 逐步揭露：一次只出一個元件，讓推論過程在課堂上展開 ──
     data-after-answer 的元件（含答案的判斷帶）不在手動揭露序列裡，
     必須等學生作答才會出現，否則測驗形同先公布答案。
     同時掛 is-shown 與 is-revealed，讓 [data-reveal] 與舊的 .fragment 樣式都吃得到。 */
  const steps = (slide) => [...slide.querySelectorAll('[data-reveal]:not([data-after-answer])')];
  const show = (el, on) => {
    el.classList.toggle('is-shown', on);
    el.classList.toggle('is-revealed', on);
    el.setAttribute('aria-hidden', String(!on));
  };
  const revealNext = (slide) => {
    const next = steps(slide).find((el) => !el.classList.contains('is-shown'));
    if (!next) return false;
    show(next, true);
    return true;
  };
  const revealPrev = (slide) => {
    const shown = steps(slide).filter((el) => el.classList.contains('is-shown'));
    if (!shown.length) return false;
    show(shown[shown.length - 1], false);
    return true;
  };
  const setReveal = (slide, all) => {
    slide.querySelectorAll('[data-reveal]').forEach((el) => {
      // 答案帶即使回看也不自動亮，維持「答過才看得到」
      show(el, Boolean(all) && !el.hasAttribute('data-after-answer'));
    });
  };
  const updateRevealMeta = () => {
    const all = steps(slides[index]);
    const shown = all.filter((el) => el.classList.contains('is-shown')).length;
    const meta = document.querySelector('[data-reveal-meta]');
    if (meta) meta.textContent = all.length ? `· 揭露 ${shown}/${all.length}` : '';
    if (step) step.textContent = all.length ? `· ${shown} / ${all.length}` : '';
  };

  const slideIndexFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const found = slides.findIndex((slide) => slide.dataset.slideId === id);
    return found >= 0 ? found : 0;
  };

  const render = (nextIndex, updateHash = true, fromBack = false) => {
    index = clamp(nextIndex);
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === index;
      slide.classList.toggle('is-active', active);
      slide.hidden = !active;
      slide.setAttribute('aria-hidden', String(!active));
    });
    // 往前翻＝這頁還沒講，全部收起；往回翻＝這頁講完了，全部攤開
    setReveal(slides[index], fromBack);
    updateRevealMeta();
    if (current) current.textContent = String(index + 1);
    if (total) total.textContent = String(slides.length);
    if (progress) progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    if (updateHash) history.replaceState(null, '', `#${encodeURIComponent(slides[index].dataset.slideId)}`);
  };

  const advance = () => {
    if (revealNext(slides[index])) { updateRevealMeta(); return; }
    if (index < slides.length - 1) render(index + 1);
  };
  const retreat = () => {
    if (revealPrev(slides[index])) { updateRevealMeta(); return; }
    if (index > 0) render(index - 1, true, true);
  };

  // 非 TDS 題型（點選項、翻答案卡）也要能觸發：作答動作一發生就放出該頁的答案帶
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest
      ? e.target.closest('.rcard, .opt, .q-opt, [data-quiz-check], [data-match-check], [data-order-check], [data-flip]')
      : null;
    if (!t) return;
    const sl = t.closest('.slide');
    if (sl) sl.querySelectorAll('[data-after-answer]').forEach((el) => show(el, true));
  });
  // 答對／答錯後才放出含答案的判斷帶
  document.addEventListener('tds:answered', (event) => {
    const slide = event.target && event.target.closest ? event.target.closest('.slide') : null;
    if (!slide) return;
    slide.querySelectorAll('[data-after-answer]').forEach((el) => show(el, true));
  });

  const resize = () => {
    const scale = Math.min(innerWidth / STAGE_WIDTH, innerHeight / STAGE_HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  const isInteractiveTarget = (target) => Boolean(target.closest('a, button, input, textarea, select, [contenteditable="true"]'));

  addEventListener('keydown', (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); advance(); }
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); retreat(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); render(index + 1); }   // 直接跳下一頁，不逐步
    else if (event.key === 'ArrowUp') { event.preventDefault(); render(index - 1, true, true); }
    else if (event.key === 'Home') { event.preventDefault(); render(0); }
    else if (event.key === 'End') { event.preventDefault(); render(slides.length - 1, true, true); }
  });

  document.querySelector('[data-action="previous"]')?.addEventListener('click', retreat);
  document.querySelector('[data-action="next"]')?.addEventListener('click', advance);
  document.querySelector('[data-action="reveal-all"]')?.addEventListener('click', () => {
    setReveal(slides[index], true); updateRevealMeta();
  });
  document.querySelector('[data-action="fullscreen"]')?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      console.warn('Unable to toggle fullscreen mode.', error);
    }
  });

  addEventListener('hashchange', () => render(slideIndexFromHash(), false));
  addEventListener('resize', resize);
  resize();
  render(slideIndexFromHash(), false);
})();
