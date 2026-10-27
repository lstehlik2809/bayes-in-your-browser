// Decorative motion only: sections fade in and fixed dataset facts count up. Results are never animated through wrong values.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window);

if (!still) {
  const sections = document.querySelectorAll('.why-strip > div, .section-heading, .about-section > div, .methods-section > *');
  document.documentElement.classList.add('motion');
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  sections.forEach((node, i) => { node.classList.add('reveal'); node.style.setProperty('--delay', `${(i % 3) * 70}ms`); reveal.observe(node); });

  const counters = document.querySelectorAll('[data-count]');
  const count = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      count.unobserve(entry.target);
      const node = entry.target, target = Number(node.dataset.count), start = performance.now(), duration = 1100;
      const step = now => { const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3; node.textContent = Math.round(target * eased).toLocaleString('en'); if (t < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  }, { threshold: 1 });
  counters.forEach(node => count.observe(node));
}
