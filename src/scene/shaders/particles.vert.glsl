uniform float uTime;
uniform float uSize;          // world-space size
uniform float uScale;         // viewport height / (2 tan(fov/2)), in device px
uniform float uHover;         // hovered country index, 0 = none
uniform float uSelected;      // selected country index, 0 = none
uniform float uBurstAge;      // seconds since purge burst (negative / large = none)
uniform float uBurstStrength; // 0..1
uniform float uCharge;        // 0..1 purge charge
uniform float uMotion;        // 1 = full motion, 0 = reduced motion

attribute float aCountry;     // 0 = ocean, else 1-based country index
attribute vec4 aRand;         // per-particle randoms in [0,1)

varying vec3 vColor;
varying float vAlpha;

const vec3 LAND = vec3(0.80, 0.86, 0.98);
const vec3 OCEAN = vec3(0.20, 0.34, 0.62);
const vec3 HOVER = vec3(0.55, 0.88, 1.00);
const vec3 SELECT = vec3(1.00, 0.80, 0.48);

void main() {
  vec3 base = normalize(position);
  vec3 p = position;
  float land = step(0.5, aCountry);

  // Gentle breathing so the surface feels alive.
  p *= 1.0 + 0.004 * sin(uTime * 1.6 + aRand.x * 6.2831) * uMotion;

  // Charging: contract and shiver.
  float ce = uCharge * uCharge * (3.0 - 2.0 * uCharge);
  p *= 1.0 - 0.16 * ce;
  p += (aRand.yzw - 0.5) * 0.035 * ce * sin(uTime * 37.0 + aRand.x * 90.0) * uMotion;

  // Purge burst: analytic impulse + staggered spring return (ported from the 2D prototype).
  float burst = 0.0;
  if (uBurstAge >= 0.0 && uBurstAge < 4.5) {
    vec3 dir = normalize(base + (aRand.yzw - 0.5) * 1.4);
    float speed = (0.35 + aRand.x * 1.05) * uBurstStrength;
    float outT = 1.0 - exp(-uBurstAge * 2.8);
    float delay = 0.55 + aRand.w * 0.75;
    float back = smoothstep(delay, delay + 1.5, uBurstAge);
    // Damped overshoot as particles settle back.
    float wobble = back * (1.0 - back) * 0.25 * sin((uBurstAge - delay) * 9.0);
    p += dir * speed * 2.6 * (outT * (1.0 - back) + wobble) * uMotion;
    burst = 1.0 - back;
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Fade the far hemisphere so the map reads clearly (relaxed during a burst).
  vec3 nView = normalize(normalMatrix * base);
  float facing = dot(nView, normalize(-mv.xyz));
  float front = mix(smoothstep(-0.25, 0.35, facing), 1.0, burst);

  float hovered = land * (1.0 - step(0.5, abs(aCountry - uHover)));
  float selected = land * (1.0 - step(0.5, abs(aCountry - uSelected)));
  float pulse = 0.85 + 0.15 * sin(uTime * 4.0) * uMotion;

  vec3 col = mix(OCEAN * 0.8, LAND * (0.85 + 0.35 * aRand.x), land);
  col = mix(col, HOVER * 1.9, hovered);
  col = mix(col, SELECT * 2.2 * pulse, selected);
  vColor = col;
  vAlpha = mix(0.04, 1.0, front) * mix(0.7, 1.0, land);

  float size = uSize * mix(0.7, 1.0, land) * (0.75 + 0.5 * aRand.y);
  size *= 1.0 + 0.6 * max(hovered, selected);
  gl_PointSize = max(1.0, size * uScale / -mv.z);
}
