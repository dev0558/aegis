varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha;
  gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * a, a);
}
