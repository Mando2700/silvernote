'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uMouse; // cursor in canvas CSS pixels, origin bottom-left
  uniform vec2 uResolution; // canvas size in CSS pixels
  uniform float uMouseStrength;
  attribute float aRand;
  varying float vHeight;
  varying float vDepth;
  varying float vLight;
  varying float vGlow;
  void main() {
    vec3 p = position;
    // One broad swell sweeping diagonally across the panel, its crest gently
    // bending and drifting, like a single fold of silk seen from above.
    vec2 dir = normalize(vec2(0.42, 1.0));
    float bend = sin(p.x * 0.055 + uTime * 0.14) * 2.6;
    float d = dot(p.xz, dir) + 5.0 - sin(uTime * 0.1) * 1.8 - bend;
    float ridge = exp(-(d * d) / 130.0);
    float breathe = 1.0 + 0.14 * sin(p.x * 0.09 - uTime * 0.4);
    float swell = ridge * 6.0 * breathe;
    // Faint long-period groundswell plus a whisper of surface texture.
    float ground = sin(p.x * 0.07 + p.z * 0.05 + uTime * 0.2) * 0.22;
    float ripple = sin(p.x * 0.8 + p.z * 0.55 + uTime * 0.9) * 0.035 * (0.4 + ridge);
    p.y += swell + ground + ripple - 0.9;
    vHeight = swell;
    // Signed slope: the face toward the camera catches light, the back falls into shadow.
    vLight = clamp(d / 130.0 * 2.0 * swell, -1.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    // Cursor, in screen space so it is a true circle centred on the pointer regardless of
    // perspective: points part radially around it with a faint ring rippling outward.
    vec2 screen = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * uResolution;
    vec2 toMouse = screen - uMouse;
    float mouseDist = length(toMouse);
    float influence = exp(-(mouseDist * mouseDist) / 4200.0) * uMouseStrength;
    float ring = sin(mouseDist * 0.09 - uTime * 2.4) * exp(-(mouseDist * mouseDist) / 12000.0) * uMouseStrength;
    vec2 push = (toMouse / max(mouseDist, 0.001)) * (influence * 16.0 + ring * 2.5);
    gl_Position.xy += push / uResolution * 2.0 * gl_Position.w;
    vGlow = influence;
    gl_PointSize = (2.0 + aRand * 1.3) * uPixelRatio * (26.0 / vDepth) * (1.0 + influence * 0.35);
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vHeight;
  varying float vDepth;
  varying float vLight;
  varying float vGlow;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.15, d);
    float peak = smoothstep(0.5, 6.0, vHeight);
    float crest = smoothstep(4.8, 6.4, vHeight);
    float lit = smoothstep(0.05, 0.8, vLight);
    float shade = smoothstep(0.05, 0.8, -vLight);
    vec3 base = vec3(0.5, 0.54, 0.62);
    vec3 silver = vec3(0.9, 0.93, 0.99);
    vec3 ion = vec3(0.62, 0.85, 1.0);
    vec3 color = mix(base * 0.7, silver, clamp(peak * 0.55 + lit * 0.6, 0.0, 1.0)) + crest * vec3(0.1, 0.12, 0.16);
    // The back slope picks up a cold ion tint so the fold reads as lit from two sides.
    color = mix(color, ion * 0.8, shade * 0.35 + crest * 0.15);
    float fade = smoothstep(80.0, 26.0, vDepth) * smoothstep(3.0, 9.0, vDepth);
    color = mix(color, ion, vGlow * 0.45);
    float strength = 0.34 + peak * 0.3 + lit * 0.55 + crest * 0.3 - shade * 0.22 + vGlow * 0.5;
    gl_FragColor = vec4(color, alpha * fade * strength);
  }
`;

/** Subtle WebGL backdrop for the dashboard hero: a drifting point-field "market surface". */
export function HeroCanvas({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // no WebGL: the CSS gradient behind stays visible
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(0, 17, 12);
    camera.lookAt(0, 0, -6);

    const columns = 300;
    const rows = 80;
    const positions = new Float32Array(columns * rows * 3);
    const random = new Float32Array(columns * rows);
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        positions[index * 3] = (column - columns / 2) * 0.42;
        positions[index * 3 + 1] = 0;
        positions[index * 3 + 2] = -row * 0.62 + 8;
        random[index] = Math.random();
        index += 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(random, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uMouse: { value: new THREE.Vector2(-1000, -1000) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMouseStrength: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      material.uniforms.uResolution.value.set(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let frame = 0;
    let visible = true;
    const timer = new THREE.Timer();
    timer.connect(document); // pauses time while the tab is hidden
    // Content and overlays sit above the canvas, so track the pointer on the window.
    const pointer = { x: 0, y: 0, px: 0, py: 0, inside: false };
    const onPointer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width;
      const ny = (event.clientY - rect.top) / rect.height;
      pointer.inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
      if (!pointer.inside) return;
      pointer.x = (nx - 0.5) * 2;
      pointer.y = (ny - 0.5) * 2;
      pointer.px = event.clientX - rect.left;
      pointer.py = rect.bottom - event.clientY;
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    const mouse = material.uniforms.uMouse.value as THREE.Vector2;
    let mouseStrength = 0;

    const render = () => {
      timer.update();
      const elapsed = timer.getElapsed();
      material.uniforms.uTime.value = elapsed;
      camera.position.x += (pointer.x * 1.4 - camera.position.x) * 0.03;
      camera.position.y += (17 - pointer.y * 0.8 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, -6);
      if (pointer.inside) {
        // Start at the cursor when fading in from nothing so the circle doesn't slide in from afar.
        if (mouseStrength < 0.02) mouse.set(pointer.px, pointer.py);
        else {
          mouse.x += (pointer.px - mouse.x) * 0.18;
          mouse.y += (pointer.py - mouse.y) * 0.18;
        }
      }
      mouseStrength += ((pointer.inside ? 1 : 0) - mouseStrength) * 0.06;
      material.uniforms.uMouseStrength.value = mouseStrength;
      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (visible && !document.hidden) render();
    };

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    intersection.observe(host);

    if (reduced) {
      material.uniforms.uTime.value = 12;
      renderer.render(scene, camera);
    } else {
      loop();
    }

    return () => {
      cancelAnimationFrame(frame);
      timer.dispose();
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reduced]);

  return <div ref={hostRef} className={className} aria-hidden />;
}
