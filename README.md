# Aegis

A gesture-controlled 3D cyber threat visualization that runs in the browser.

> Work in progress. Full README (features, gesture table, architecture, deploy) lands in phase 5.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run lint && npm run typecheck
npm run build      # production build in dist/
```

Dev-only render switches: `?debug=nobloom,noatmo,ldr,opaque`.

## Privacy

Camera frames are processed entirely on your device. Nothing is uploaded.
