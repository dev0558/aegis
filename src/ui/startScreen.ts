import type { TrackerErrorKind } from '../input/handTracker';

const MESSAGES: Record<TrackerErrorKind, string> = {
  insecure: 'Camera access needs a secure page. Open Aegis over https or on localhost.',
  unsupported:
    'This browser cannot access the camera. Try a recent Chrome, Edge, Firefox or Safari.',
  denied:
    'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.',
  notfound: 'No camera was found. Connect one and try again, or continue with the mouse.',
  inuse: 'Your camera is being used by another app. Close it and try again.',
  model: 'The hand-tracking model failed to load. Check your connection and try again.',
  unknown: 'The camera could not be started.',
};

/** Intro overlay: enable camera, continue with mouse, and clear error states. */
export class StartScreen {
  private readonly el: HTMLElement;
  private readonly camBtn: HTMLButtonElement;
  private readonly mouseBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;
  private readonly detail: HTMLElement;

  constructor(handlers: { onCamera: () => void; onMouse: () => void }) {
    this.el = document.getElementById('start')!;
    this.camBtn = document.getElementById('startCam') as HTMLButtonElement;
    this.mouseBtn = document.getElementById('startMouse') as HTMLButtonElement;
    this.msg = document.getElementById('startMsg')!;
    this.detail = document.getElementById('startDetail')!;
    this.camBtn.addEventListener('click', handlers.onCamera);
    this.mouseBtn.addEventListener('click', handlers.onMouse);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hide');
  }

  show(): void {
    this.el.classList.remove('hide');
    this.el.removeAttribute('inert');
    this.reset();
    this.camBtn.focus();
  }

  hide(): void {
    this.el.classList.add('hide');
    this.el.setAttribute('inert', '');
  }

  busy(text: string): void {
    this.camBtn.disabled = true;
    this.camBtn.textContent = 'Starting…';
    this.msg.className = 'start-msg';
    this.msg.textContent = text;
    this.detail.textContent = '';
  }

  error(kind: TrackerErrorKind, detail = ''): void {
    this.camBtn.disabled = kind === 'insecure' || kind === 'unsupported';
    this.camBtn.textContent = 'Try again';
    this.msg.className = 'start-msg err';
    this.msg.textContent = MESSAGES[kind];
    this.detail.textContent = kind === 'model' || kind === 'unknown' ? detail : '';
    this.mouseBtn.focus();
  }

  private reset(): void {
    this.camBtn.disabled = false;
    this.camBtn.textContent = 'Enable camera';
    this.msg.className = 'start-msg';
    this.msg.textContent = '';
    this.detail.textContent = '';
  }
}
