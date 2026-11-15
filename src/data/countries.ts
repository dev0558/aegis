/**
 * Curated countries for the simulated feed. Weights are loosely shaped by
 * public threat-intelligence reporting (who scans, who hosts C2, who is
 * targeted); they are illustrative, not measurements.
 *
 * `hubs` are representative network locations (major IX / data-centre cities)
 * so large countries don't send every arc from a single point.
 */
import type { AttackType, CountryCode } from './types';

export interface Hub {
  lat: number;
  lon: number;
}

export interface CountryInfo {
  iso: CountryCode;
  name: string;
  /** ISO alpha-2, used in compact log rows. */
  a2: string;
  hubs: Hub[];
  /** Relative likelihood of being an attack source / target. */
  src: number;
  dst: number;
  /** Optional per-type bias for attacks originating here. */
  mix?: Partial<Record<AttackType, number>>;
}

const h = (lat: number, lon: number): Hub => ({ lat, lon });

export const COUNTRIES: CountryInfo[] = [
  { iso: '840', name: 'United States', a2: 'US', src: 9, dst: 30, hubs: [h(39.04, -77.49), h(37.34, -121.89), h(32.78, -96.8), h(41.88, -87.63), h(40.71, -74.0), h(47.61, -122.33)], mix: { portscan: 0.45, ddos: 0.2, bruteforce: 0.15, c2: 0.12, phishing: 0.08 } },
  { iso: '156', name: 'China', a2: 'CN', src: 16, dst: 5, hubs: [h(39.9, 116.4), h(31.23, 121.47), h(22.54, 114.06), h(30.27, 120.15)], mix: { portscan: 0.36, bruteforce: 0.3, c2: 0.14, ddos: 0.1, phishing: 0.1 } },
  { iso: '643', name: 'Russia', a2: 'RU', src: 13, dst: 4, hubs: [h(55.76, 37.62), h(59.93, 30.34), h(56.84, 60.6)], mix: { c2: 0.3, ddos: 0.24, phishing: 0.2, bruteforce: 0.16, portscan: 0.1 } },
  { iso: '076', name: 'Brazil', a2: 'BR', src: 5, dst: 4, hubs: [h(-23.55, -46.63), h(-22.91, -43.17)], mix: { bruteforce: 0.4, ddos: 0.25, portscan: 0.2, phishing: 0.15 } },
  { iso: '356', name: 'India', a2: 'IN', src: 5, dst: 7, hubs: [h(19.08, 72.88), h(12.97, 77.59), h(28.61, 77.21)], mix: { bruteforce: 0.35, portscan: 0.3, phishing: 0.2, ddos: 0.15 } },
  { iso: '704', name: 'Vietnam', a2: 'VN', src: 4, dst: 1.5, hubs: [h(21.03, 105.85), h(10.82, 106.63)], mix: { bruteforce: 0.42, portscan: 0.33, ddos: 0.15, c2: 0.1 } },
  { iso: '528', name: 'Netherlands', a2: 'NL', src: 5, dst: 3, hubs: [h(52.37, 4.9)], mix: { portscan: 0.38, c2: 0.32, ddos: 0.15, bruteforce: 0.15 } },
  { iso: '276', name: 'Germany', a2: 'DE', src: 3.5, dst: 8, hubs: [h(50.11, 8.68), h(52.52, 13.4)], mix: { portscan: 0.4, c2: 0.25, bruteforce: 0.2, ddos: 0.15 } },
  { iso: '364', name: 'Iran', a2: 'IR', src: 4, dst: 2, hubs: [h(35.69, 51.39)], mix: { phishing: 0.35, c2: 0.3, ddos: 0.2, bruteforce: 0.15 } },
  { iso: '408', name: 'North Korea', a2: 'KP', src: 2, dst: 0.1, hubs: [h(39.04, 125.76)], mix: { c2: 0.5, phishing: 0.42, bruteforce: 0.08 } },
  { iso: '410', name: 'South Korea', a2: 'KR', src: 2.5, dst: 6, hubs: [h(37.57, 126.98), h(35.18, 129.08)] },
  { iso: '360', name: 'Indonesia', a2: 'ID', src: 3, dst: 2, hubs: [h(-6.21, 106.85)], mix: { bruteforce: 0.4, portscan: 0.3, ddos: 0.2, phishing: 0.1 } },
  { iso: '804', name: 'Ukraine', a2: 'UA', src: 2, dst: 6, hubs: [h(50.45, 30.52), h(49.84, 24.03)] },
  { iso: '642', name: 'Romania', a2: 'RO', src: 2, dst: 1.5, hubs: [h(44.43, 26.1)], mix: { bruteforce: 0.35, phishing: 0.3, portscan: 0.2, c2: 0.15 } },
  { iso: '566', name: 'Nigeria', a2: 'NG', src: 2.5, dst: 1, hubs: [h(6.52, 3.38)], mix: { phishing: 0.82, bruteforce: 0.18 } },
  { iso: '792', name: 'Turkey', a2: 'TR', src: 2, dst: 2.5, hubs: [h(41.01, 28.98)] },
  { iso: '158', name: 'Taiwan', a2: 'TW', src: 1.5, dst: 5, hubs: [h(25.03, 121.57)] },
  { iso: '702', name: 'Singapore', a2: 'SG', src: 3, dst: 4, hubs: [h(1.35, 103.82)], mix: { portscan: 0.4, c2: 0.3, ddos: 0.15, bruteforce: 0.15 } },
  { iso: '344', name: 'Hong Kong', a2: 'HK', src: 3, dst: 3, hubs: [h(22.32, 114.17)], mix: { portscan: 0.35, c2: 0.3, bruteforce: 0.2, ddos: 0.15 } },
  { iso: '764', name: 'Thailand', a2: 'TH', src: 2, dst: 1.5, hubs: [h(13.76, 100.5)] },
  { iso: '100', name: 'Bulgaria', a2: 'BG', src: 1.5, dst: 1, hubs: [h(42.7, 23.32)], mix: { c2: 0.35, portscan: 0.3, bruteforce: 0.2, ddos: 0.15 } },
  { iso: '826', name: 'United Kingdom', a2: 'GB', src: 2.5, dst: 9, hubs: [h(51.51, -0.13), h(53.48, -2.24)] },
  { iso: '392', name: 'Japan', a2: 'JP', src: 2, dst: 7, hubs: [h(35.68, 139.69), h(34.69, 135.5)] },
  { iso: '250', name: 'France', a2: 'FR', src: 2.5, dst: 6, hubs: [h(48.86, 2.35), h(43.3, 5.37)] },
  { iso: '124', name: 'Canada', a2: 'CA', src: 2, dst: 5, hubs: [h(43.65, -79.38), h(45.5, -73.57), h(49.28, -123.12)] },
  { iso: '036', name: 'Australia', a2: 'AU', src: 1.5, dst: 5, hubs: [h(-33.87, 151.21), h(-37.81, 144.96)] },
  { iso: '376', name: 'Israel', a2: 'IL', src: 1.5, dst: 4, hubs: [h(32.09, 34.78)] },
  { iso: '380', name: 'Italy', a2: 'IT', src: 1.5, dst: 4, hubs: [h(45.46, 9.19), h(41.9, 12.5)] },
  { iso: '724', name: 'Spain', a2: 'ES', src: 1.5, dst: 3.5, hubs: [h(40.42, -3.7)] },
  { iso: '682', name: 'Saudi Arabia', a2: 'SA', src: 0.8, dst: 4, hubs: [h(24.71, 46.68)] },
  { iso: '784', name: 'United Arab Emirates', a2: 'AE', src: 1, dst: 3.5, hubs: [h(25.2, 55.27)] },
  { iso: '616', name: 'Poland', a2: 'PL', src: 1.5, dst: 3.5, hubs: [h(52.23, 21.01)] },
  { iso: '586', name: 'Pakistan', a2: 'PK', src: 2, dst: 2, hubs: [h(24.86, 67.0), h(33.68, 73.05)], mix: { phishing: 0.35, bruteforce: 0.3, ddos: 0.2, c2: 0.15 } },
  { iso: '484', name: 'Mexico', a2: 'MX', src: 1.2, dst: 2.5, hubs: [h(19.43, -99.13)] },
  { iso: '710', name: 'South Africa', a2: 'ZA', src: 1, dst: 2, hubs: [h(-26.2, 28.05)] },
  { iso: '818', name: 'Egypt', a2: 'EG', src: 1.2, dst: 1.5, hubs: [h(30.04, 31.24)] },
  { iso: '032', name: 'Argentina', a2: 'AR', src: 1, dst: 1.5, hubs: [h(-34.6, -58.38)] },
  { iso: '170', name: 'Colombia', a2: 'CO', src: 1, dst: 1.2, hubs: [h(4.71, -74.07)] },
  { iso: '752', name: 'Sweden', a2: 'SE', src: 0.8, dst: 2, hubs: [h(59.33, 18.07)] },
  { iso: '756', name: 'Switzerland', a2: 'CH', src: 0.6, dst: 3, hubs: [h(47.38, 8.54)] },
  { iso: '398', name: 'Kazakhstan', a2: 'KZ', src: 1, dst: 0.8, hubs: [h(43.24, 76.89)] },
  { iso: '458', name: 'Malaysia', a2: 'MY', src: 1.2, dst: 1.5, hubs: [h(3.14, 101.69)] },
  { iso: '608', name: 'Philippines', a2: 'PH', src: 1.2, dst: 1.5, hubs: [h(14.6, 120.98)] },
  { iso: '050', name: 'Bangladesh', a2: 'BD', src: 1, dst: 0.8, hubs: [h(23.81, 90.41)] },
  { iso: '112', name: 'Belarus', a2: 'BY', src: 1, dst: 0.6, hubs: [h(53.9, 27.57)], mix: { ddos: 0.35, c2: 0.3, phishing: 0.2, portscan: 0.15 } },
  { iso: '440', name: 'Lithuania', a2: 'LT', src: 0.6, dst: 1.5, hubs: [h(54.69, 25.28)] },
  { iso: '233', name: 'Estonia', a2: 'EE', src: 0.5, dst: 1.5, hubs: [h(59.44, 24.75)] },
  { iso: '404', name: 'Kenya', a2: 'KE', src: 0.6, dst: 1, hubs: [h(-1.29, 36.82)] },
  { iso: '152', name: 'Chile', a2: 'CL', src: 0.6, dst: 1, hubs: [h(-33.45, -70.67)] },
  { iso: '372', name: 'Ireland', a2: 'IE', src: 0.8, dst: 3, hubs: [h(53.35, -6.26)] },
  { iso: '246', name: 'Finland', a2: 'FI', src: 0.5, dst: 1.5, hubs: [h(60.17, 24.94)] },
  { iso: '554', name: 'New Zealand', a2: 'NZ', src: 0.3, dst: 1, hubs: [h(-36.85, 174.76)] },
  { iso: '634', name: 'Qatar', a2: 'QA', src: 0.3, dst: 1.5, hubs: [h(25.29, 51.53)] },
  { iso: '504', name: 'Morocco', a2: 'MA', src: 0.8, dst: 0.8, hubs: [h(33.57, -7.59)] },
]; // prettier-ignore

/**
 * Directed pair multipliers for geopolitically "hot" relationships.
 * Key: `${sourceIso}>${targetIso}`.
 */
export const PAIR_AFFINITY: Record<string, number> = {
  '643>804': 7, // Russia → Ukraine
  '112>804': 4, // Belarus → Ukraine
  '156>158': 6, // China → Taiwan
  '408>410': 7, // North Korea → South Korea
  '408>840': 2, // North Korea → US
  '408>392': 2.5, // North Korea → Japan
  '364>376': 6, // Iran → Israel
  '364>682': 4, // Iran → Saudi Arabia
  '364>784': 3, // Iran → UAE
  '586>356': 4, // Pakistan → India
  '356>586': 2.5, // India → Pakistan
  '643>616': 2.5, // Russia → Poland
  '643>440': 3, // Russia → Lithuania
  '643>233': 3, // Russia → Estonia
  '643>276': 1.8, // Russia → Germany
  '643>840': 1.6, // Russia → US
  '156>840': 1.6, // China → US
  '156>392': 1.8, // China → Japan
  '156>356': 1.6, // China → India
};

export const DEFAULT_MIX: Record<AttackType, number> = {
  portscan: 0.32,
  bruteforce: 0.26,
  ddos: 0.14,
  c2: 0.14,
  phishing: 0.14,
};

const byIso = new Map(COUNTRIES.map((c) => [c.iso, c]));
export const countryInfo = (iso: CountryCode): CountryInfo | undefined => byIso.get(iso);
