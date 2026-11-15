/**
 * Dev-only landmark recorder. Shift+R starts/stops recording raw tracker
 * frames; on stop the sequence downloads as JSON. Drop the file into
 * tests/fixtures/recorded/ and fill in `meta.expect` / `meta.forbid` to turn
 * a real gesture into a regression test. Recordings stay on your machine.
 */
import type { TrackerFrame } from './handTracker';

export interface RecordedFixture {
  meta: {
    label: string;
    recordedAt: string;
    /** Gesture event types that must occur during replay. */
    expect: string[];
    /** Gesture event types that must not occur. */
    forbid: string[];
  };
  frames: {
    t: number;
    videoWidth: number;
    videoHeight: number;
    hands: { landmarks: number[]; handedness: string; score: number }[];
  }[];
}

export class LandmarkRecorder {
  private frames: RecordedFixture['frames'] | null = null;
  onChange: (recording: boolean) => void = () => undefined;

  get recording(): boolean {
    return this.frames !== null;
  }

  push(f: TrackerFrame): void {
    if (!this.frames) return;
    this.frames.push({
      t: Math.round(f.t * 10) / 10,
      videoWidth: f.videoWidth,
      videoHeight: f.videoHeight,
      hands: f.hands.map((h) => ({
        landmarks: Array.from(h.landmarks, (v) => Math.round(v * 1e5) / 1e5),
        handedness: h.handedness,
        score: Math.round(h.score * 1000) / 1000,
      })),
    });
  }

  toggle(): void {
    if (!this.frames) {
      this.frames = [];
      this.onChange(true);
      return;
    }
    const frames = this.frames;
    this.frames = null;
    this.onChange(false);
    if (!frames.length) return;
    const label = (window.prompt('Label for this gesture recording', 'open-hand-rotate') ?? '')
      .trim()
      .replace(/[^a-z0-9-]+/gi, '-');
    if (!label) return;
    const fixture: RecordedFixture = {
      meta: { label, recordedAt: new Date().toISOString(), expect: [], forbid: [] },
      frames,
    };
    const blob = new Blob([JSON.stringify(fixture)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${label}.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }
}
