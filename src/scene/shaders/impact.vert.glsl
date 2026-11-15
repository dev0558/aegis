// Expanding ring lying flat on the globe surface.
uniform float uTime;
uniform float uSelected;
uniform float uTypeMask[5];

attribute vec3 aPos;      // unit vector
attribute vec3 aColor;
attribute vec4 aTiming;   // start, life, max radius, kind (1 = impact, 0 = launch)
attribute vec2 aMeta;     // country idx, type idx

varying vec2 vUv;
varying vec3 vColor;
varying float vAge;
varying float vAlpha;

void main() {
  float age = (uTime - aTiming.x) / aTiming.y;
  if (age < 0.0 || age > 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec3 n = normalize(aPos);
  vec3 ref = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(n, ref));
  vec3 v = cross(n, u);
  float r = aTiming.z * (0.15 + 0.85 * (1.0 - pow(1.0 - age, 3.0)));
  vec3 p = n * 1.004 + (u * position.x + v * position.y) * r;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  float dim = 1.0;
  if (uSelected > 0.5) dim = mix(0.15, 1.6, 1.0 - step(0.5, abs(aMeta.x - uSelected)));
  vUv = position.xy;
  vColor = aColor;
  vAge = age;
  vAlpha = dim * uTypeMask[int(aMeta.y + 0.5)];
}
