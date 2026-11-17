/**
 * Dev-only end-to-end harness (page loaded with ?e2e=1 in development).
 *
 * Replaces getUserMedia so the whole try-on + voice stack can be exercised
 * without a person in front of the machine:
 *   video → a lit 3D render of MediaPipe's own canonical face mesh (skin,
 *           eyes, brows, lips), head slowly turning, drawn to a canvas stream
 *   audio → a Web Audio destination; window.__e2eSay(url) plays a WAV into it
 *           as if the customer spoke into the microphone
 * Also exposes window.__e2e for the test driver (stores, timings).
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import { CANONICAL_MESH_CM } from "@/lib/canonicalFaceMesh";
import { FACE_TRIANGLES } from "@/lib/faceMesh";

type Conn = readonly { start: number; end: number }[];
const ids = (c: Conn) => new Set(c.flatMap((e) => [e.start, e.end]));

function faceCanvas(width = 1280, height = 720): { canvas: HTMLCanvasElement; stop: () => void } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(new Color("#d9d4cc"));
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, width / height, 1, 1000);
  camera.position.set(0, 0, 48);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(CANONICAL_MESH_CM), 3));
  geo.setIndex(FACE_TRIANGLES);
  geo.computeVertexNormals();
  const skin = new Color("#c68a64");
  const eyes = ids([...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE] as Conn);
  const brows = ids([...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW] as Conn);
  const lips = ids(FaceLandmarker.FACE_LANDMARKS_LIPS as Conn);
  const col = new Float32Array(468 * 3);
  for (let i = 0; i < 468; i++) {
    const c = eyes.has(i) ? new Color("#1d1410") : brows.has(i) ? new Color("#2a1a12") : lips.has(i) ? new Color("#8e4a44") : skin;
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  const face = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }));
  scene.add(face);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(10, 15, 40);
  scene.add(key);

  let raf = 0;
  const t0 = performance.now();
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    face.rotation.y = 0.25 * Math.sin(t * 0.5); // ±14° yaw
    face.rotation.x = 0.06 * Math.sin(t * 0.37);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(draw);
  };
  draw();
  return { canvas, stop: () => cancelAnimationFrame(raf) };
}

export function installE2EFakeMedia() {
  const md = navigator.mediaDevices;
  const original = md.getUserMedia.bind(md);
  let audioCtx: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  const ensureAudio = () => {
    if (!audioCtx || !dest) {
      audioCtx = new AudioContext({ sampleRate: 48000 });
      dest = audioCtx.createMediaStreamDestination();
      // Room-noise floor (~-55 dBFS). A real mic is never digitally silent;
      // pure zeros let the WebRTC sender go quiet, and the server-side VAD
      // then never sees the pause that ends the customer's turn.
      const noise = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.0018;
      const src = audioCtx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.connect(dest);
      src.start();
    }
    return { audioCtx, dest };
  };

  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const tracks: MediaStreamTrack[] = [];
    if (constraints?.video) {
      const { canvas } = faceCanvas();
      tracks.push(...canvas.captureStream(30).getVideoTracks());
    }
    if (constraints?.audio) {
      // A clone per request: callers stop the tracks they get (pipecat's
      // transport opens the mic once just to check permission, then stops
      // it), and a stopped shared track would leave the real call silent.
      tracks.push(...ensureAudio().dest.stream.getAudioTracks().map((t) => t.clone()));
    }
    if (!tracks.length) return original(constraints);
    return new MediaStream(tracks);
  };

  const w = window as unknown as Record<string, unknown>;
  /** Play a WAV into the fake microphone; resolves when it has finished. */
  w.__e2eSay = async (url: string) => {
    const { audioCtx: ctx, dest: d } = ensureAudio();
    await ctx.resume();
    if (ctx.state !== "running") throw new Error(`fake mic AudioContext is ${ctx.state}`);
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(d);
    const done = new Promise<number>((res) => (src.onended = () => res(performance.now())));
    src.start();
    return done;
  };
  console.info("[EyeNetra:e2e] fake camera + microphone installed");
}
