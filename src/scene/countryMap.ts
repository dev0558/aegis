import type { Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-110m.json';
import { decodeCountries, rasterizeCountries, sampleIndex, type GeoCountry } from '../data/geo';

export const MAP_W = 2048;
export const MAP_H = 1024;

/** Country polygons rasterized into an index map for O(1) lat/lon → country lookup. */
export class CountryMap {
  readonly countries: GeoCountry[];
  readonly raster: Uint8Array;
  private readonly byIso = new Map<string, GeoCountry>();

  constructor() {
    this.countries = decodeCountries(atlas as unknown as Topology);
    this.raster = rasterizeCountries(this.countries, MAP_W, MAP_H);
    for (const c of this.countries) this.byIso.set(c.iso, c);
  }

  indexAt(lat: number, lon: number): number {
    return sampleIndex(this.raster, MAP_W, MAP_H, lat, lon);
  }

  byIndex(index: number): GeoCountry | undefined {
    return this.countries[index - 1];
  }

  byIsoCode(iso: string): GeoCountry | undefined {
    return this.byIso.get(iso);
  }
}
