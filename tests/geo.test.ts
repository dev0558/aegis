import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-110m.json';
import {
  angularDistance,
  decodeCountries,
  latLonToVec3,
  rasterizeCountries,
  sampleIndex,
  vec3ToLatLon,
} from '../src/data/geo';

const countries = decodeCountries(atlas as unknown as Topology);
const W = 1024;
const H = 512;
const raster = rasterizeCountries(countries, W, H);
const nameAt = (lat: number, lon: number) =>
  countries[sampleIndex(raster, W, H, lat, lon) - 1]?.name ?? 'ocean';

describe('geo', () => {
  it('round-trips lat/lon through the unit sphere', () => {
    for (const [lat, lon] of [
      [0, 0],
      [45, 90],
      [-33.9, 151.2],
      [64, -150],
    ] as const) {
      const [x, y, z] = latLonToVec3(lat, lon);
      const r = vec3ToLatLon(x, y, z);
      expect(r.lat).toBeCloseTo(lat, 6);
      expect(r.lon).toBeCloseTo(lon, 6);
    }
  });

  it('puts lon 0 / lat 0 on +Z and east on +X', () => {
    expect(latLonToVec3(0, 0).map((v) => Math.round(v))).toEqual([0, 0, 1]);
    expect(latLonToVec3(0, 90).map((v) => Math.round(v))).toEqual([1, 0, 0]);
  });

  it('rasterizes countries at known locations', () => {
    expect(nameAt(48.85, 2.35)).toBe('France');
    expect(nameAt(40.7, -100)).toBe('United States of America');
    expect(nameAt(-25, 134)).toBe('Australia');
    expect(nameAt(-80, 0)).toBe('Antarctica');
    expect(nameAt(0, -150)).toBe('ocean');
  });

  it('handles enclaves (Lesotho inside South Africa)', () => {
    expect(nameAt(-29.5, 28.2)).toBe('Lesotho');
    expect(nameAt(-30.5, 24)).toBe('South Africa');
  });

  it('handles rings crossing the antimeridian without stray rows', () => {
    expect(nameAt(66, 179.5)).toBe('Russia');
    // Before the fix, a full-width band was filled at Russia's/Fiji's latitudes.
    expect(nameAt(66, -40)).not.toBe('Russia');
    expect(nameAt(-16.5, -60)).not.toBe('Fiji');
  });

  it('computes great-circle distances', () => {
    expect(angularDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(Math.PI / 2, 6);
    expect(angularDistance({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(Math.PI, 6);
  });
});
