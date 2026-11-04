// Säulendiagramme (SVG): Hinweis mit dem Wert der Säule unter dem Zeiger

/** Hinweis über der Säule zeigen, auf der der Zeiger steht (Säulen: <g class="saeule" data-tipp="…">) */
export function tippBinden(el) {
  el.querySelectorAll('.diagramm-flaeche').forEach((f) => {
    const tipp = f.querySelector('.diagramm-tipp');
    f.addEventListener('pointermove', (ev) => {
      const g = ev.target.closest('[data-tipp]');
      f.querySelectorAll('.saeule.aktiv').forEach((x) => x !== g && x.classList.remove('aktiv'));
      if (!g) { tipp.hidden = true; return; }
      g.classList.add('aktiv');
      tipp.textContent = g.dataset.tipp;
      tipp.hidden = false;
      const r = f.getBoundingClientRect();
      tipp.style.left = `${Math.min(Math.max(ev.clientX - r.left, 70), r.width - 70)}px`;
    });
    f.addEventListener('pointerleave', () => { tipp.hidden = true; f.querySelectorAll('.saeule.aktiv').forEach((x) => x.classList.remove('aktiv')); });
  });
}
