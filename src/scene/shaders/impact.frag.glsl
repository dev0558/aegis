varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vAlpha;

void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float ring = smoothstep(0.72, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
  float core = (1.0 - smoothstep(0.0, 0.35, d)) * (1.0 - smoothstep(0.0, 0.35, vAge));
  float fade = 1.0 - vAge;
  float a = (ring * fade * fade + core) * vAlpha;
  gl_FragColor = vec4(vColor * (1.4 + 2.0 * core), a);
}
