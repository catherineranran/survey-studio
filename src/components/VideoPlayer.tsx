import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../lib/i18n';
import type { Lang, VideoAnswer, VideoSettings } from '../lib/types';
import { openVideo } from '../lib/video';
import { Icon } from './ui';

// The video player of video questions. 'flat' shows an ordinary video. 'wrap' shows a
// magic window: the video frame is a patch of an equirectangular picture that reaches
// `span` degrees around the viewer (140, 180, 360 …), seen through a perspective view
// `fov` degrees across. Respondents look around by dragging, with the arrow keys, or
// (optionally) by moving their phone; the view never leaves the picture. Every pixel's
// view ray is turned into longitude / latitude and looked up in the frame, so the view
// is an exact perspective view (the same approach as the MW140 viewer on ranranli.net).
//
// It records how much of the video was played, whether it reached the end, and where the
// respondent looked during each second of it.

const D2R = Math.PI / 180;
const MAX_ASPECT = 1.6; // the view is at most 16:10 …
const MIN_ASPECT = 0.75; // … and at least 3:4; wider or taller screens get black bars

const VS = 'attribute vec2 p; varying vec2 ndc; void main() { ndc = p; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 ndc;
uniform sampler2D tex;
uniform mat3 rays;   // (ndc.x, ndc.y, 1) -> view ray; -Z is the picture's centre, +Y is up
uniform vec2 span;   // the picture's angular width and height (radians)
uniform float wrapX; // 1: the picture goes all the way round
uniform float ready;
void main() {
  vec3 r = normalize(rays * vec3(ndc, 1.0));
  float lon = atan(r.x, -r.z), lat = asin(clamp(r.y, -1.0, 1.0));
  vec2 uv = vec2(lon / span.x + 0.5, lat / span.y + 0.5);
  if (wrapX > 0.5) uv.x = fract(uv.x);
  if (ready < 0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0);
}`;

// 3 x 3 matrices, row-major.
const mul3 = (a: number[], b: number[]) => {
  const o: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]);
  return o;
};
const rotX = (a: number) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// Recorded with the response (respondents see a translated message instead).
const CANT_PLAY = 'The browser couldn’t play the video file.';
const NO_PICTURE = 'The browser played the sound but not the picture (unsupported video format).';
const NO_WEBGL = 'The browser can’t draw the magic window (WebGL is off or unavailable).';
const TOO_BIG = 'The video is larger than this device can draw.';
const STALLED = 'The video stopped loading (no data for 30 seconds).';
const STALL_MS = 30000;
const round1 = (x: number) => Math.round(x * 10) / 10;

export interface Geometry {
  hSpan: number;
  vSpan: number;
  wrap: boolean;
  tanH: number;
  tanV: number;
  halfV: number;
}

/** The view for a canvas of the given aspect ratio. Angles in degrees in, radians out. */
export function geometry(span: number, fov: number, frameAspect: number, aspect: number): Geometry {
  const wrap = span >= 360;
  const hSpan = Math.min(span, 360) * D2R;
  const vSpan = Math.min(hSpan / Math.max(frameAspect, 1e-3), Math.PI);
  const fovH = Math.max(20, Math.min(fov, wrap ? 170 : Math.min(170, span))) * D2R;
  const tanH = Math.tan(fovH / 2);
  const tanV = tanH / aspect;
  return { hSpan, vSpan, wrap, tanH, tanV, halfV: Math.atan(tanV) };
}

/** Longitude / latitude of points along the edge of the view, looking straight ahead at the given pitch. */
function edgeRays(g: Geometry, pitch: number): [number, number][] {
  const out: [number, number][] = [];
  const n = 8;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  for (let i = 0; i <= n; i++) {
    const a = -1 + (2 * i) / n;
    for (const [x, y] of [
      [a, 1],
      [a, -1],
      [1, a],
      [-1, a],
    ]) {
      const rx = x * g.tanH;
      const ry0 = y * g.tanV;
      const len = Math.hypot(rx, ry0, 1);
      const ry = (ry0 * cp + sp) / len;
      const rz = (ry0 * sp - cp) / len;
      out.push([Math.atan2(rx / len, -rz), Math.asin(Math.max(-1, Math.min(1, ry)))]);
    }
  }
  return out;
}

/** Keeps the view on the picture: respondents look around only as far as the picture goes, corners included. */
export function clampView(g: Geometry, yaw: number, pitch: number): [number, number] {
  const lonLimit = g.wrap ? Infinity : g.hSpan / 2 + 1e-6;
  const fits = (p: number) => edgeRays(g, p).every(([lo, la]) => Math.abs(la) <= g.vSpan / 2 + 1e-6 && Math.abs(lo) <= lonLimit);
  let pm = 0;
  if (fits(0)) {
    let lo = 0;
    let hi = g.vSpan / 2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    pm = lo;
  }
  const p = Math.max(-pm, Math.min(pm, pitch));
  if (g.wrap) return [wrapAngle(yaw), p];
  const maxLon = Math.max(...edgeRays(g, p).map(([lo]) => Math.abs(lo)));
  const ym = Math.max(0, g.hSpan / 2 - maxLon);
  return [Math.max(-ym, Math.min(ym, yaw)), p];
}

/** Device orientation -> the direction the back of the device points: [yaw (> 0 left), pitch (> 0 up)]. */
export function deviceDirection(alpha: number, beta: number, gamma: number, screenAngle: number): [number, number] {
  // Quaternion from the Euler angles (order YXZ), then turned so the camera looks out of the
  // back of the device instead of its top, then corrected for the screen's rotation.
  const [x, y, z] = [beta * D2R, alpha * D2R, -gamma * D2R];
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  let q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  const mul = (a: number[], b: number[]) => [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  q = mul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const o = (-screenAngle * D2R) / 2;
  q = mul(q, [0, 0, Math.sin(o), Math.cos(o)]);
  // Rotate (0, 0, -1) by q.
  const [qx, qy, qz, qw] = q;
  const v = [0, 0, -1];
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  const fx = v[0] + qw * tx + (qy * tz - qz * ty);
  const fy = v[1] + qw * ty + (qz * tx - qx * tz);
  const fz = v[2] + qw * tz + (qx * ty - qy * tx);
  return [Math.atan2(-fx, -fz), Math.asin(Math.max(-1, Math.min(1, fy)))];
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Load = { kind: 'loading'; progress: number } | { kind: 'ready' } | { kind: 'error'; message: string };

export interface VideoPlayerProps {
  settings: VideoSettings;
  lang: Lang;
  value?: VideoAnswer;
  /** Called with what's been recorded so far; undefined while there's nothing to record. */
  onChange: (v: VideoAnswer | undefined) => void;
  /** Id of the question title, which names the player for screen readers. */
  labelledBy?: string;
}

export function VideoPlayer({ settings, lang, value, onChange, labelledBy }: VideoPlayerProps) {
  const wrapView = settings.view === 'wrap';
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading', progress: 0 });
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState<'off' | 'native' | 'fill'>('off');
  const [time, setTime] = useState({ now: 0, total: 0 });
  const [buffering, setBuffering] = useState(false);
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

  const cfg = useRef(settings);
  cfg.current = settings;
  // Where the respondent looks (radians; yaw > 0 is left). Drag and keys move `yaw` / `pitch`;
  // device tilt adds to them relative to how the device was held when it started.
  const view = useRef({ yaw: 0, pitch: 0, tiltYaw: 0, tiltPitch: 0, tiltRef: null as [number, number] | null });
  const rec = useRef<VideoAnswer>({ sec: value?.sec ?? 0, end: value?.end ?? false, look: value?.look ? [...value.look] : undefined });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastReport = useRef(0);
  // A problem drawing the magic window outlasts reloading the video; only a fresh start clears it.
  const drawError = useRef<string | null>(null);

  const sent = useRef(value !== undefined);
  const report = useCallback((now = false) => {
    const at = performance.now();
    if (!now && at - lastReport.current < 1000) return;
    lastReport.current = at;
    const r = rec.current;
    // Nothing to record until it plays (or fails); an error that went away is taken back.
    if (!r.sec && !r.end && !r.err) {
      if (sent.current) onChangeRef.current(undefined);
      sent.current = false;
      return;
    }
    sent.current = true;
    const out: VideoAnswer = { sec: round1(r.sec), end: r.end };
    if (r.look) out.look = r.look.slice();
    if (r.err) out.err = r.err;
    onChangeRef.current(out);
  }, []);

  const fail = useCallback(
    (message: string) => {
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
      rec.current.err = message;
      report(true);
      setLoad({ kind: 'error', message });
    },
    [report],
  );

  /* ------------------------------------------------------------ loading */
  useEffect(() => {
    const video = videoRef.current!;
    let cancelled = false;
    let release = () => {};
    setLoad({ kind: 'loading', progress: 0 });
    openVideo(settings.src, (f) => !cancelled && setLoad({ kind: 'loading', progress: f }))
      .then((opened) => {
        if (cancelled || drawError.current) {
          opened.release();
          if (!cancelled && drawError.current) fail(drawError.current);
          return;
        }
        release = opened.release;
        // The magic window draws the video with WebGL, which needs it from this site or from a
        // host that allows it (CORS). Decrypted folders are local (blob:) anyway.
        if (wrapView && !opened.url.startsWith('blob:')) video.crossOrigin = 'anonymous';
        video.src = opened.url;
        video.load();
        setLoad({ kind: 'ready' });
        if (rec.current.err) {
          // It loads now: the earlier problem no longer counts.
          delete rec.current.err;
          report(true);
        }
      })
      .catch((e) => !cancelled && fail(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      release();
    };
  }, [settings.src, wrapView, attempt, fail, report]);

  /* -------------------------------------------------------- video events */
  useEffect(() => {
    const v = videoRef.current!;
    let last = 0;
    const onTime = () => {
      const d = v.currentTime - last;
      if (d > 0 && d < 1.5) rec.current.sec += d; // normal playback; restarts and stalls don't count
      last = v.currentTime;
      setTime({ now: v.currentTime, total: v.duration || 0 });
      report();
    };
    const onSeeked = () => {
      last = v.currentTime;
    };
    const onMeta = () => {
      last = v.currentTime;
      setTime({ now: v.currentTime, total: v.duration || 0 });
      // Some browsers play only the sound of formats they can't decode (HEVC, for example).
      if (!v.videoWidth || !v.videoHeight) return fail(NO_PICTURE);
      if (cfg.current.view === 'wrap' && Number.isFinite(v.duration) && v.duration > 0) {
        const old = rec.current.look ?? [];
        rec.current.look = Array.from({ length: Math.ceil(v.duration) }, (_, i) => old[i] ?? null);
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      setEnded(false);
    };
    const onPause = () => {
      setPlaying(false);
      report(true);
    };
    const onEnded = () => {
      rec.current.end = true;
      setEnded(true);
      setPlaying(false);
      report(true);
    };
    const onError = () => {
      if (!v.getAttribute('src')) return;
      fail(CANT_PLAY);
    };
    // Waiting for data (a video file streamed from the web): show it, and after 30 seconds
    // without progress let the respondent go on.
    let stall = 0;
    const onWaiting = () => {
      setBuffering(true);
      clearTimeout(stall);
      stall = window.setTimeout(() => fail(STALLED), STALL_MS);
    };
    const onFlowing = () => {
      setBuffering(false);
      clearTimeout(stall);
    };
    // Switching to another tab or app pauses the video, so the time recorded is time watched.
    const onHidden = () => document.hidden && !v.paused && v.pause();
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onFlowing);
    v.addEventListener('pause', onFlowing);
    v.addEventListener('emptied', onFlowing);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      clearTimeout(stall);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onFlowing);
      v.removeEventListener('pause', onFlowing);
      v.removeEventListener('emptied', onFlowing);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', onHidden);
      report(true);
    };
  }, [fail, report]);

  /* ------------------------------------------------------- magic window */
  useEffect(() => {
    if (!wrapView) return;
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const video = videoRef.current!;
    drawError.current = null;
    const stop = (message: string) => {
      drawError.current = message;
      fail(message);
    };
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) {
      stop(NO_WEBGL);
      return;
    }
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    let checked = false;
    const U: Record<string, WebGLUniformLocation | null> = {};
    let tex: WebGLTexture | null = null;
    let hasFrame = false;
    let dirty = true;
    const init = () => {
      const shader = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['tex', 'rays', 'span', 'wrapX', 'ready']) U[n] = gl.getUniformLocation(prog, n);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      hasFrame = false;
      dirty = true;
    };
    try {
      init();
    } catch {
      stop(NO_WEBGL);
      return;
    }
    const onLost = (e: Event) => e.preventDefault();
    const onRestored = () => init();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const markDirty = () => {
      dirty = true;
    };
    video.addEventListener('loadeddata', markDirty);
    video.addEventListener('seeked', markDirty);

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (gl.isContextLost()) return;
      // Size: the stage's box, kept between 3:4 and 16:10.
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const cw = Math.max(1, Math.min(sw, Math.round(sh * MAX_ASPECT)));
      const ch = Math.max(1, Math.min(sh, Math.round(cw / MIN_ASPECT)));
      if (canvas.style.width !== `${cw}px`) canvas.style.width = `${cw}px`;
      if (canvas.style.height !== `${ch}px`) canvas.style.height = `${ch}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cw * dpr);
      const h = Math.round(ch * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      // A new frame while playing, or once after loading or seeking.
      if (video.readyState >= 2 && (!video.paused || !hasFrame || dirty)) {
        if (Math.max(video.videoWidth, video.videoHeight) > maxTexture) {
          cancelAnimationFrame(raf);
          return stop(TOO_BIG);
        }
        try {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
          hasFrame = true;
          dirty = false;
        } catch {
          // A video from another site that doesn't allow it (CORS) can't be drawn.
          cancelAnimationFrame(raf);
          return stop(CANT_PLAY);
        }
        if (!checked) {
          checked = true;
          if (gl.getError() !== gl.NO_ERROR) {
            cancelAnimationFrame(raf);
            return stop(CANT_PLAY);
          }
        }
      }
      const s = cfg.current;
      const frameAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
      const g = geometry(s.span, s.fov, frameAspect, cw / ch);
      const v = view.current;
      const [yaw, pitch] = clampView(g, v.yaw + v.tiltYaw, v.pitch + v.tiltPitch);
      v.yaw = yaw - v.tiltYaw; // dragging past the edge doesn't build up
      v.pitch = pitch - v.tiltPitch;
      const rays = mul3(rotY(yaw), mul3(rotX(pitch), [g.tanH, 0, 0, 0, g.tanV, 0, 0, 0, -1]));
      gl.viewport(0, 0, w, h);
      gl.uniformMatrix3fv(U.rays, false, [rays[0], rays[3], rays[6], rays[1], rays[4], rays[7], rays[2], rays[5], rays[8]]);
      gl.uniform2f(U.span, g.hSpan, g.vSpan);
      gl.uniform1f(U.wrapX, g.wrap ? 1 : 0);
      gl.uniform1f(U.ready, hasFrame ? 1 : 0);
      gl.uniform1i(U.tex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Where the respondent looks during this second of the video.
      const look = rec.current.look;
      if (look && !video.paused) {
        const i = Math.floor(video.currentTime);
        if (i >= 0 && i < look.length) look[i] = [round1(-yaw / D2R), round1(pitch / D2R)];
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      video.removeEventListener('loadeddata', markDirty);
      video.removeEventListener('seeked', markDirty);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [wrapView, attempt, fail]);

  /* ---------------------------------------------------------- tilting */
  const tiltOn = useRef(false);
  const onOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    const [yaw, pitch] = deviceDirection(e.alpha ?? 0, e.beta, e.gamma, angle);
    const v = view.current;
    if (!v.tiltRef) v.tiltRef = [yaw, pitch];
    v.tiltYaw = wrapAngle(yaw - v.tiltRef[0]);
    v.tiltPitch = pitch - v.tiltRef[1];
  }, []);
  useEffect(() => () => window.removeEventListener('deviceorientation', onOrientation), [onOrientation]);
  const enableTilt = () => {
    if (!wrapView || !settings.tilt || tiltOn.current || typeof DeviceOrientationEvent === 'undefined') return;
    const start = () => {
      tiltOn.current = true;
      window.addEventListener('deviceorientation', onOrientation);
    };
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    // iPhone and iPad ask first, and only in answer to a tap.
    if (typeof D.requestPermission === 'function') D.requestPermission().then((r) => r === 'granted' && start(), () => {});
    else start();
  };

  /* --------------------------------------------------------- controls */
  const play = () => {
    const v = videoRef.current!;
    enableTilt();
    if (v.ended) v.currentTime = 0;
    v.play().catch(() => setPlaying(false));
  };
  const toggle = () => {
    const v = videoRef.current!;
    if (v.paused || v.ended) play();
    else v.pause();
  };
  const restart = () => {
    const v = videoRef.current!;
    v.currentTime = 0;
    play();
  };
  const recentre = () => {
    const v = view.current;
    v.yaw = 0;
    v.pitch = 0;
    v.tiltYaw = 0;
    v.tiltPitch = 0;
    v.tiltRef = null;
  };
  const toggleMute = () => {
    const v = videoRef.current!;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  // Full screen where the browser allows it (not on iPhone), otherwise fill the window.
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const onChange = () => {
      const el = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      setFull((f) => (el && el === rootRef.current ? 'native' : f === 'native' ? 'off' : f));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);
  useEffect(() => {
    if (full !== 'fill') return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setFull('off');
    document.body.classList.add('vp-filled');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('vp-filled');
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);
  const toggleFull = () => {
    const el = rootRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    if (!el) return;
    if (full === 'native') {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (full === 'fill') return setFull('off');
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setFull('fill'));
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else setFull('fill');
  };

  /* ---------------------------------------------------- looking around */
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const c = e.currentTarget;
    const s = cfg.current;
    const g = geometry(s.span, s.fov, 1, c.clientWidth / Math.max(1, c.clientHeight));
    const k = (2 * g.halfV) / Math.max(1, c.clientHeight); // the picture follows the pointer
    view.current.yaw += (e.clientX - d.x) * k;
    view.current.pitch += (e.clientY - d.y) * k;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const step = 0.05;
    switch (e.key) {
      case 'ArrowLeft':
        view.current.yaw += step;
        break;
      case 'ArrowRight':
        view.current.yaw -= step;
        break;
      case 'ArrowUp':
        view.current.pitch += step;
        break;
      case 'ArrowDown':
        view.current.pitch -= step;
        break;
      case ' ':
      case 'k':
        toggle();
        break;
      case 'Home':
        recentre();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /* ----------------------------------------------------------- render */
  const ready = load.kind === 'ready';
  const pct = time.total ? Math.min(100, (100 * time.now) / time.total) : 0;
  const hint = wrapView ? t(lang, settings.tilt && touch ? 'videoTiltHint' : 'videoLookHint') : '';
  return (
    <div ref={rootRef} className={`vp ${wrapView ? 'vp-wrap' : 'vp-flat'} ${full !== 'off' ? 'is-full' : ''} ${full === 'fill' ? 'is-fill' : ''}`}>
      <div ref={stageRef} className="vp-stage">
        {wrapView && (
          <canvas
            ref={canvasRef}
            className="vp-canvas"
            tabIndex={0}
            role="application"
            aria-roledescription={t(lang, 'videoRole')}
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : t(lang, 'videoRole')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          />
        )}
        <video
          ref={videoRef}
          className={wrapView ? 'vp-source' : 'vp-video'}
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden={wrapView || undefined}
          tabIndex={wrapView ? -1 : undefined}
          onClick={wrapView ? undefined : toggle}
        />
        {load.kind === 'loading' && (
          <div className="vp-overlay" role="status">
            <span className="vp-spinner" aria-hidden="true" />
            <span>{t(lang, 'videoLoading', { pct: Math.floor(load.progress * 10) * 10 })}</span>
          </div>
        )}
        {ready && buffering && playing && (
          <div className="vp-overlay vp-buffering" role="status">
            <span className="vp-spinner" aria-hidden="true" />
          </div>
        )}
        {load.kind === 'error' && (
          <div className="vp-overlay vp-error" role="alert">
            <p>{t(lang, 'videoError')}</p>
            <button type="button" className="vp-btn" onClick={() => setAttempt((n) => n + 1)}>
              {t(lang, 'videoRetry')}
            </button>
          </div>
        )}
        {ready && (!started || ended) && !playing && (
          <div className="vp-overlay">
            <button type="button" className="vp-play" onClick={play}>
              <Icon name="play" size={22} />
              <span>{t(lang, ended ? 'videoAgain' : 'videoPlay')}</span>
            </button>
          </div>
        )}
      </div>
      <div className="vp-bar">
        <button type="button" className="vp-btn" onClick={toggle} disabled={!ready}>
          {t(lang, playing ? 'videoPause' : 'videoResume')}
        </button>
        <button type="button" className="vp-btn" onClick={restart} disabled={!ready || !started}>
          {t(lang, 'videoRestart')}
        </button>
        <button type="button" className="vp-btn" onClick={toggleMute} disabled={!ready} aria-pressed={muted}>
          {t(lang, muted ? 'videoUnmute' : 'videoMute')}
        </button>
        {wrapView && (
          <button type="button" className="vp-btn" onClick={recentre} disabled={!ready}>
            {t(lang, 'videoCentre')}
          </button>
        )}
        <button type="button" className="vp-btn" onClick={toggleFull} aria-pressed={full !== 'off'}>
          {t(lang, full === 'off' ? 'videoFull' : 'videoExitFull')}
        </button>
        <span className="vp-time">
          {fmt(time.now)} / {fmt(time.total)}
        </span>
        <span className="vp-track" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
      {hint && <p className="vp-hint">{hint}</p>}
    </div>
  );
}
