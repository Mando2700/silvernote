'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

const POINTS = 180;
// Fibonacci sphere: evenly spread unit vectors, each with its own phase for the "breathing".
const SPHERE = Array.from({ length: POINTS }, (_, index) => {
  const y = 1 - (index / (POINTS - 1)) * 2;
  const radius = Math.sqrt(1 - y * y);
  const theta = index * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, phase: (index * 2.399) % (Math.PI * 2) };
});

/**
 * Grok's "thinking" mark: a rotating particle sphere whose surface ripples, a pulsing core and two
 * faint tilted orbit rings. Canvas 2D, a few hundred dots, so it is cheap to leave running.
 */
export function ThinkingOrb({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    context.scale(ratio, ratio);
    const center = size / 2;
    const radius = size * 0.3;

    const draw = (time: number) => {
      const t = time / 1000;
      context.clearRect(0, 0, size, size);
      context.globalCompositeOperation = 'lighter';

      // Core: a soft ion bloom that swells and settles.
      const pulse = 0.75 + 0.25 * Math.sin(t * 3.2);
      const core = context.createRadialGradient(center, center, 0, center, center, radius * 1.25);
      core.addColorStop(0, `rgba(236, 246, 255, ${0.55 * pulse})`);
      core.addColorStop(0.35, `rgba(159, 216, 255, ${0.28 * pulse})`);
      core.addColorStop(1, 'rgba(159, 216, 255, 0)');
      context.fillStyle = core;
      context.beginPath();
      context.arc(center, center, radius * 1.25, 0, Math.PI * 2);
      context.fill();

      // Particle shell, rotating on two axes; each point breathes in and out on its own phase.
      const ay = t * 0.9;
      const ax = 0.45 + Math.sin(t * 0.6) * 0.35;
      const [sy, cy, sx, cx] = [Math.sin(ay), Math.cos(ay), Math.sin(ax), Math.cos(ax)];
      for (const point of SPHERE) {
        const wobble = 1 + 0.09 * Math.sin(t * 4 + point.phase * 3) + 0.05 * Math.sin(t * 2.3 + point.y * 6);
        const x1 = point.x * cy - point.z * sy;
        const z1 = point.x * sy + point.z * cy;
        const y2 = point.y * cx - z1 * sx;
        const z2 = point.y * sx + z1 * cx;
        const depth = (z2 + 1) / 2; // 0 = back, 1 = front
        const px = center + x1 * radius * wobble;
        const py = center + y2 * radius * wobble;
        const dot = 0.22 + depth * 0.42;
        const r = Math.round(159 + (240 - 159) * depth);
        const g = Math.round(216 + (246 - 216) * depth);
        context.fillStyle = `rgba(${r}, ${g}, 255, ${0.08 + depth * 0.85})`;
        context.beginPath();
        context.arc(px, py, dot, 0, Math.PI * 2);
        context.fill();
      }

      // Two faint tilted orbit rings.
      const orbits = [
        { tilt: 0.42, scale: 1.45 },
        { tilt: -0.9, scale: 1.3 },
      ];
      for (const orbit of orbits) {
        const rx = radius * orbit.scale;
        const ry = rx * 0.32;
        context.strokeStyle = 'rgba(205, 212, 222, 0.14)';
        context.lineWidth = 0.6;
        context.beginPath();
        context.ellipse(center, center, rx, ry, orbit.tilt, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalCompositeOperation = 'source-over';
    };

    if (reduced) {
      draw(1200);
      return;
    }
    let frame = requestAnimationFrame(function loop(time) {
      draw(time);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [size, reduced]);

  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      <span className="absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,rgba(159,216,255,0.22),transparent_65%)] blur-[2px]" />
      <canvas ref={ref} className="relative" style={{ width: size, height: size }} />
    </span>
  );
}
