varying vec3 vColor;
varying float vAlpha;
varying float vSide;

void main() {
  float edge = 1.0 - vSide * vSide;
  float a = vAlpha * edge;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}
