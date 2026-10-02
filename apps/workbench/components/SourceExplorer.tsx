"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FileCode, Search } from "lucide-react";
import type { Job } from "@/lib/contracts";

export default function SourceExplorer({ plan }: { plan: NonNullable<Job["plan"]> }) {
  const graph = plan.graph; const host = useRef<HTMLDivElement>(null);
  const meshIndex = useRef(new Map<string, THREE.Mesh>());
  const renderGraph = useRef<() => void>(() => undefined);
  const [selected, setSelected] = useState(graph.nodes[0] || ""); const [query, setQuery] = useState("");
  const selectedPath = useRef(selected);
  const [unavailable, setUnavailable] = useState(false);
  const fingerprint = JSON.stringify(graph);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const data = JSON.parse(fingerprint) as typeof graph;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setUnavailable(true); return; }
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 20);
    const nodes = new THREE.Group(); scene.add(nodes);
    const sphere = new THREE.SphereGeometry(0.13, 12, 8);
    const meshes = data.nodes.map((name, i) => {
      const angle = i * Math.PI * (3 - Math.sqrt(5)), radius = 1 + 5 * Math.sqrt((i + 1) / Math.max(1, data.nodes.length));
      const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0x83949e }));
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * .6, Math.sin(i) * .8);
      mesh.userData.path = name; nodes.add(mesh); return mesh;
    });
    meshIndex.current = new Map(meshes.map(mesh => [String(mesh.userData.path), mesh]));
    const positions = new Map(data.nodes.map((name, i) => [name, meshes[i].position]));
    const lines = new THREE.BufferGeometry().setFromPoints(data.edges.flatMap(edge => {
      const start = positions.get(edge.source), end = positions.get(edge.target); return start && end ? [start, end] : [];
    }));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4a5962, transparent: true, opacity: .7 });
    scene.add(new THREE.LineSegments(lines, lineMaterial));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", "Static source-import map. The file list provides keyboard access.");
    element.appendChild(renderer.domElement);
    renderGraph.current = () => renderer.render(scene, camera);
    const colors = () => {
      const tokens = getComputedStyle(document.documentElement);
      for (const [name, mesh] of meshIndex.current) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(tokens.getPropertyValue(name === selectedPath.current ? '--accent' : '--muted').trim());
      }
      lineMaterial.color.set(tokens.getPropertyValue('--border-strong').trim());
      renderGraph.current();
    };
    const themeObserver = new MutationObserver(colors);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    colors();
    const resize = () => { const width = element.clientWidth || 600; renderer.setSize(width, 340); camera.aspect = width / 340; camera.updateProjectionMatrix(); renderGraph.current(); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const ray = new THREE.Raycaster();
    const pick = (event: PointerEvent) => { const bounds = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera); const hit = ray.intersectObjects(meshes)[0]; if (hit) setSelected(String(hit.object.userData.path)); };
    const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    renderer.domElement.addEventListener("pointerdown", pick); renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => { observer.disconnect(); themeObserver.disconnect(); renderer.domElement.removeEventListener("pointerdown", pick); renderer.domElement.removeEventListener("webglcontextlost", lost); meshIndex.current.clear(); renderGraph.current = () => undefined; sphere.dispose(); meshes.forEach(mesh => (mesh.material as THREE.Material).dispose()); lines.dispose(); lineMaterial.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [fingerprint]);
  useEffect(() => {
    selectedPath.current = selected;
    const tokens = getComputedStyle(document.documentElement);
    for (const [name, mesh] of meshIndex.current) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.set(tokens.getPropertyValue(name === selected ? '--accent' : '--muted').trim());
    }
    renderGraph.current();
  }, [selected]);
  const imports = graph.edges.filter(edge => edge.source === selected).map(edge => edge.target);
  const callers = graph.edges.filter(edge => edge.target === selected).map(edge => edge.source);
  return <section><div className="view-heading"><div><h2>Source explorer</h2><p>{graph.indexed_files} of {graph.eligible_files} eligible files indexed · {graph.edges.length} local import relationships</p></div><span className="status neutral">Static analysis</span></div>
    <div className="source-explorer"><aside><label className="search"><Search size={15} /><input aria-label="Find source file" placeholder="Find a file…" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="file-list">{graph.nodes.filter(name => name.toLowerCase().includes(query.toLowerCase())).map(name => <button key={name} aria-pressed={selected === name} onClick={() => setSelected(name)}><FileCode size={14} /><span>{name}</span></button>)}</div></aside><div><div className="source-canvas" ref={host} />{unavailable && <p role="status" className="micro">WebGL unavailable. File selection and import relationships remain available.</p>}<div className="relationship-detail"><code>{selected || "No indexed source files"}</code><div><h3>Imports</h3>{imports.length ? imports.map(name => <button className="text-link" key={name} onClick={() => setSelected(name)}>{name}</button>) : <p>No resolved local imports.</p>}</div><div><h3>Imported by</h3>{callers.length ? callers.map(name => <button className="text-link" key={name} onClick={() => setSelected(name)}>{name}</button>) : <p>No resolved callers.</p>}</div></div></div></div>
    <p className="micro">{graph.limited ? "Inventory is bounded to 150 source files. " : ""}This map shows parsed imports, not a runtime trace. Dynamic imports, aliases and external dependencies may be unresolved.</p>
    <details className="disclosure"><summary>Manifests and candidate tests</summary><div className="inventory-grid"><div><h3>Manifests</h3>{plan.manifests.map(name => <code key={name}>{name}</code>)}</div><div><h3>{plan.test_file_count} candidate test files</h3>{plan.test_files.map(name => <code key={name}>{name}</code>)}</div></div></details>
  </section>;
}
