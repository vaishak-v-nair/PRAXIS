const COLORS = Object.freeze({
  idle: 0xb9ff66,
  running: 0xb9ff66,
  VERIFIED: 0x76e88d,
  CONTRADICTED: 0xff6b6b,
  ERROR: 0xf6c85f,
});

function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export async function createEngineVisual(canvas, statusNode) {
  let THREE;
  try {
    THREE = await import('/three.module.js');
  } catch {
    canvas.dataset.mode = 'fallback';
    statusNode.textContent = 'CSS FALLBACK';
    return {
      setState(state) {
        canvas.dataset.state = state;
        statusNode.textContent = state === 'idle' ? 'CSS FALLBACK' : state.toUpperCase();
      },
      dispose() {},
    };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 5.2);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const geometry = new THREE.IcosahedronGeometry(1.36, 2);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.idle,
    emissive: COLORS.idle,
    emissiveIntensity: 0.78,
    roughness: 0.38,
    metalness: 0.22,
    wireframe: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.82, 1),
    new THREE.MeshStandardMaterial({ color: 0x101510, emissive: COLORS.idle, emissiveIntensity: 0.22, roughness: 0.55, metalness: 0.1 }),
  );
  scene.add(core);

  scene.add(new THREE.AmbientLight(0xd8ffd1, 0.42));
  const key = new THREE.PointLight(0xb9ff66, 4.2, 12);
  key.position.set(2.4, 2, 3.2);
  scene.add(key);

  let active = true;
  let visualState = 'idle';
  const clock = new THREE.Clock();

  function colorFor(state) {
    return COLORS[state] || COLORS.running;
  }

  function setState(state) {
    visualState = state || 'idle';
    const color = colorFor(visualState);
    material.color.setHex(color);
    material.emissive.setHex(color);
    core.material.emissive.setHex(color);
    key.color.setHex(color);
    canvas.dataset.mode = 'three';
    canvas.dataset.state = visualState;
    statusNode.textContent = visualState === 'idle' ? 'THREE.JS ACTIVE' : visualState.toUpperCase();
    statusNode.style.color = cssColor(color);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    if (!active) return;
    const t = clock.getElapsedTime();
    const running = visualState === 'running';
    const pulse = running ? 1 + Math.sin(t * 8) * 0.1 : 1 + Math.sin(t * 2.2) * 0.035;
    mesh.rotation.x = t * 0.32;
    mesh.rotation.y = t * 0.54;
    core.rotation.x = -t * 0.22;
    core.rotation.y = t * 0.34;
    mesh.scale.setScalar(pulse);
    core.scale.setScalar(0.96 + (pulse - 1) * 0.72);
    material.emissiveIntensity = running ? 1.1 + Math.sin(t * 9) * 0.28 : 0.72;
    key.intensity = running ? 5.4 + Math.sin(t * 7) * 0.8 : 3.6;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  resize();
  setState('idle');
  requestAnimationFrame(render);
  window.addEventListener('resize', resize);

  return {
    setState,
    dispose() {
      active = false;
      window.removeEventListener('resize', resize);
      geometry.dispose();
      material.dispose();
      core.geometry.dispose();
      core.material.dispose();
      renderer.dispose();
    },
  };
}
