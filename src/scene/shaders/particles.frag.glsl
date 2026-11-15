varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  // Bright core with a soft skirt.
  float core = smoothstep(1.0, 0.0, d);
  float a = (core * core * 0.75 + core * 0.25) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
