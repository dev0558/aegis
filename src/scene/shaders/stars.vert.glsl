uniform float uTime;
uniform float uPixelRatio;
uniform float uMotion;
attribute float aSeed;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = 0.25 + 0.35 * fract(aSeed * 13.7) + 0.2 * sin(uTime * (0.5 + aSeed) + aSeed * 40.0) * uMotion;
  gl_PointSize = (1.0 + 1.6 * fract(aSeed * 7.3)) * uPixelRatio;
}
