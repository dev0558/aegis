/**
 * Pure geographic helpers: TopoJSON decoding, exact (non-antialiased) country
 * rasterization into an index map, and lat/lon <-> unit-sphere conversion.
 *
 * Convention: lon 0 / lat 0 faces +Z, east is +X, north is +Y.
 *   x = cos(lat) sin(lon), y = sin(lat), z = cos(lat) cos(lon)
 */
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';

export interface GeoCountry {
  /** 1-based index used in the raster and in shaders (0 = ocean). */
  index: number;
  /** ISO 3166-1 numeric code as a zero-padded string, or a synthetic "X.." id. */
  iso: string;
  name: string;
  /** Polygons → rings → flat [lon, lat, lon, lat, …] */
  polygons: Float64Array[][];
  /** Label/arc anchor: area-weighted centroid of the largest polygon. */
  centroid: { lat: number; lon: number };
}

export interface LatLon {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

export function latLonToVec3(lat: number, lon: number, r = 1): [number, number, number] {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
}

export function vec3ToLatLon(x: number, y: number, z: number): LatLon {
  const len = Math.hypot(x, y, z) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG,
    lon: Math.atan2(x, z) / DEG,
  };
}

interface CountryProps {
  name?: string;
}

type Ring = [number, number][];

/** Decode world-atlas TopoJSON into countries with flat ring arrays. */
export function decodeCountries(topo: Topology): GeoCountry[] {
  const obj = topo.objects['countries'] as GeometryCollection<CountryProps>;
  const fc = feature(topo, obj);
  const out: GeoCountry[] = [];
  let synthetic = 0;
  for (const f of fc.features) {
    const g = f.geometry as { type: string; coordinates: unknown } | null;
    if (!g) continue;
    let polys: Ring[][];
    if (g.type === 'Polygon') polys = [g.coordinates as Ring[]];
    else if (g.type === 'MultiPolygon') polys = g.coordinates as Ring[][];
    else continue;
    const polygons = polys.map((rings) =>
      rings.map((ring) => {
        const a = new Float64Array(ring.length * 2);
        ring.forEach(([lon, lat], i) => {
          a[i * 2] = lon;
          a[i * 2 + 1] = lat;
        });
        return a;
      }),
    );
    const id = f.id === undefined ? `X${String(++synthetic).padStart(2, '0')}` : String(f.id);
    out.push({
      index: out.length + 1,
      iso: id,
      name: (f.properties as CountryProps | null)?.name ?? id,
      polygons,
      centroid: largestPolygonCentroid(polygons),
    });
  }
  return out;
}

/** Signed planar area + centroid of a ring in lon/lat space. */
function ringCentroid(r: Float64Array): { a: number; x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = r[j * 2]!;
    const y0 = r[j * 2 + 1]!;
    const x1 = r[i * 2]!;
    const y1 = r[i * 2 + 1]!;
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) return { a: 0, x: r[0]!, y: r[1]! };
  return { a, x: cx / (6 * a), y: cy / (6 * a) };
}

function largestPolygonCentroid(polygons: Float64Array[][]): LatLon {
  let best = { a: -1, x: 0, y: 0 };
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer) continue;
    const c = ringCentroid(outer);
    if (Math.abs(c.a) > best.a) best = { a: Math.abs(c.a), x: c.x, y: c.y };
  }
  return { lat: best.y, lon: best.x };
}

/**
 * Rasterize countries into an equirectangular index map (row 0 = north).
 * Exact scanline fill with even-odd rule so holes (enclaves, lakes) work and
 * there is no antialiasing to corrupt indices at borders.
 */
export function rasterizeCountries(countries: GeoCountry[], w: number, h: number): Uint8Array {
  if (countries.length > 255) throw new Error('Too many countries for an 8-bit index map');
  const out = new Uint8Array(w * h);
  const xs: number[] = [];
  for (const c of countries) {
    // Collect edges and the country's latitude extent.
    const edges: number[] = [];
    let minLat = 90;
    let maxLat = -90;
    for (const rings of c.polygons) {
      for (const src of rings) {
        // Rings crossing the antimeridian jump ±360°; unwrap them so edges are
        // continuous, then add copies shifted by ±360° to cover the wrap.
        const r = unwrapRing(src);
        let minLon = Infinity;
        let maxLon = -Infinity;
        for (let i = 0; i < r.length; i += 2) {
          minLon = Math.min(minLon, r[i]!);
          maxLon = Math.max(maxLon, r[i]!);
        }
        const shifts = [0];
        if (minLon < -180) shifts.push(360);
        if (maxLon > 180) shifts.push(-360);
        const n = r.length / 2;
        for (const s of shifts) {
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const lat0 = r[j * 2 + 1]!;
            const lat1 = r[i * 2 + 1]!;
            if (lat0 === lat1) continue;
            edges.push(r[j * 2]! + s, lat0, r[i * 2]! + s, lat1);
            if (lat0 < minLat) minLat = lat0;
            if (lat0 > maxLat) maxLat = lat0;
          }
        }
      }
    }
    const y0 = Math.max(0, Math.floor(((90 - maxLat) / 180) * h));
    const y1 = Math.min(h - 1, Math.ceil(((90 - minLat) / 180) * h));
    for (let y = y0; y <= y1; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      xs.length = 0;
      for (let e = 0; e < edges.length; e += 4) {
        const la0 = edges[e + 1]!;
        const la1 = edges[e + 3]!;
        if (la0 > lat !== la1 > lat) {
          const lo0 = edges[e]!;
          const lo1 = edges[e + 2]!;
          xs.push(lo0 + ((lat - la0) / (la1 - la0)) * (lo1 - lo0));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const row = y * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Fill pixels whose centres fall inside [xs[k], xs[k+1]].
        const a = Math.ceil(((xs[k]! + 180) / 360) * w - 0.5);
        const b = Math.floor(((xs[k + 1]! + 180) / 360) * w - 0.5);
        for (let x = Math.max(0, a); x <= Math.min(w - 1, b); x++) out[row + x] = c.index;
      }
    }
  }
  return out;
}

function unwrapRing(r: Float64Array): Float64Array {
  let jumped = false;
  for (let i = 2; i < r.length; i += 2) {
    if (Math.abs(r[i]! - r[i - 2]!) > 180) {
      jumped = true;
      break;
    }
  }
  if (!jumped) return r;
  const out = new Float64Array(r);
  for (let i = 2; i < out.length; i += 2) {
    let d = r[i]! - r[i - 2]!;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    out[i] = out[i - 2]! + d;
  }
  return out;
}

/** Look up the country index at a lat/lon in a raster produced above. */
export function sampleIndex(raster: Uint8Array, w: number, h: number, lat: number, lon: number) {
  let x = Math.floor(((lon + 180) / 360) * w);
  let y = Math.floor(((90 - lat) / 180) * h);
  x = ((x % w) + w) % w;
  y = y < 0 ? 0 : y >= h ? h - 1 : y;
  return raster[y * w + x]!;
}

/** Great-circle angle (radians) between two lat/lon points. */
export function angularDistance(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
