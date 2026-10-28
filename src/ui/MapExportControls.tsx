import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n/i18n';
import type { MapLayer } from '../render/mapRenderer';
import type { Frame } from '../worker/protocol';
import { EXPORT_ICONS } from './icons';
import { formatGyr } from './format';

const MAX_TIMELAPSE_FRAMES = 120;
const TIMELAPSE_WIDTH = 480;
const PLAYBACK_FPS = 12;
const FRAME_INTERVALS = [1, 5, 10, 25] as const;

export type CaptureMap = (caption?: string, maxWidth?: number) => HTMLCanvasElement | null;

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type));
}

function mediaRecorderAvailable(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  );
}

function webmMimeType(): string {
  for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function MapExportControls({
  frame,
  layer,
  capture,
}: {
  frame: Frame;
  layer: MapLayer;
  capture: CaptureMap;
}) {
  const [recording, setRecording] = useState(false);
  const [interval, setIntervalFrames] = useState<(typeof FRAME_INTERVALS)[number]>(5);
  const [frames, setFrames] = useState<HTMLCanvasElement[]>([]);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const receivedFrames = useRef(0);
  const supported = mediaRecorderAvailable();

  useEffect(() => {
    if (!recording || !frame.running) return;
    receivedFrames.current++;
    if ((receivedFrames.current - 1) % interval !== 0) return;
    const handle = requestAnimationFrame(() => {
      const snapshot = capture(undefined, TIMELAPSE_WIDTH);
      if (!snapshot) return;
      setFrames((current) => [...current.slice(-(MAX_TIMELAPSE_FRAMES - 1)), snapshot]);
    });
    return () => cancelAnimationFrame(handle);
  }, [capture, frame, interval, recording]);

  const exportPng = async () => {
    const caption = `${t('share.seed')}: ${frame.creation.seed}  •  ${t('stat.age')}: ${formatGyr(frame.year)}  •  ${t('export.layer')}: ${t(`layer.${layer}` as MessageKey)}`;
    const canvas = capture(caption);
    if (!canvas) return;
    const blob = await canvasBlob(canvas, 'image/png');
    if (blob) downloadBlob(blob, `geogenesis-${frame.creation.seed}-${layer}.png`);
  };

  const exportWebm = async () => {
    if (!supported || frames.length < 2) return;
    setExporting(true);
    setStatus(t('export.timelapseEncoding'));
    try {
      const playback = document.createElement('canvas');
      playback.width = frames[0]!.width;
      playback.height = frames[0]!.height;
      const context = playback.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable');
      const stream = (
        playback as HTMLCanvasElement & {
          captureStream: (frameRate?: number) => MediaStream;
        }
      ).captureStream(PLAYBACK_FPS);
      const mimeType = webmMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error('MediaRecorder failed'));
      });
      recorder.start();
      for (const frameCanvas of frames) {
        context.drawImage(frameCanvas, 0, 0);
        await new Promise((resolve) => window.setTimeout(resolve, 1000 / PLAYBACK_FPS));
      }
      recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      downloadBlob(
        new Blob(chunks, { type: recorder.mimeType || 'video/webm' }),
        `geogenesis-${frame.creation.seed}-${layer}-timelapse.webm`,
      );
      setStatus(t('export.timelapseReady'));
    } catch {
      setStatus(t('export.timelapseFailed'));
    } finally {
      setExporting(false);
    }
  };

  const unavailableTitle = t('export.mediaRecorderUnavailable');
  return (
    <div className="export-controls" role="group" aria-label={t('export.title')}>
      <button onClick={() => void exportPng()} title={t('export.imageHint')}>
        {EXPORT_ICONS.image}
        <span className="visually-hidden">{t('export.image')}</span>
      </button>
      <label title={t('export.intervalHint')}>
        <span className="visually-hidden">{t('export.interval')}</span>
        <select
          value={interval}
          onChange={(event) =>
            setIntervalFrames(Number(event.target.value) as (typeof FRAME_INTERVALS)[number])
          }
          disabled={recording}
          title={t('export.intervalHint')}
        >
          {FRAME_INTERVALS.map((value) => (
            <option key={value} value={value}>
              {t('export.everyFrames', { count: value })}
            </option>
          ))}
        </select>
      </label>
      <button
        className={recording ? 'recording' : undefined}
        disabled={!supported || (!recording && !frame.running)}
        onClick={() => {
          if (recording) setRecording(false);
          else {
            receivedFrames.current = 0;
            setFrames([]);
            setStatus('');
            setRecording(true);
          }
        }}
        title={
          !supported
            ? unavailableTitle
            : recording
              ? t('export.stopHint')
              : frame.running
                ? t('export.startHint')
                : t('export.startPausedHint')
        }
      >
        {recording ? EXPORT_ICONS.stop : EXPORT_ICONS.record}
        <span>{recording ? t('export.stop') : t('export.record')}</span>
      </button>
      <output title={t('export.frameCountHint')}>
        {t('export.frameCount', { count: frames.length, max: MAX_TIMELAPSE_FRAMES })}
      </output>
      <button
        disabled={!supported || recording || exporting || frames.length < 2}
        onClick={() => void exportWebm()}
        title={!supported ? unavailableTitle : t('export.timelapseHint')}
      >
        {EXPORT_ICONS.video}
        <span className="visually-hidden">{t('export.timelapse')}</span>
      </button>
      {status && (
        <span className="visually-hidden" role="status">
          {status}
        </span>
      )}
    </div>
  );
}
