// Lightweight celebratory confetti burst on a full-screen canvas.
const COLORS = ['#e5383b', '#ff4d4f', '#a8323e', '#ffffff', '#f3eee7', '#1d1d1f'];

export function confetti(count = 160) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.getElementById('confetti') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 16 - 6,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const start = performance.now();
  canvas.classList.add('on');
  const frame = (t: number) => {
    const age = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - age / 3200);
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
      ctx.restore();
    }
    if (age < 3200) requestAnimationFrame(frame);
    else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.classList.remove('on'); }
  };
  requestAnimationFrame(frame);
}
