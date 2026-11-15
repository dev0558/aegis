// One instanced ribbon per attack. Vertices are distributed only over the
// currently visible span [tail, head] so the trail is always smooth.
uniform float uTime;
uniform float uTrail;
uniform float uSelected;   // country index, 0 = none
uniform float uMotion;     // 0 = reduced motion
uniform float uTypeMask[5];

attribute float aT;        // 0 = tail end of strip, 1 = head end
attribute float aSide;     // -1 / +1
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec3 aColor;
attribute vec4 aTiming;    // start time, travel seconds, height, width
attribute vec4 aMeta;      // src country idx, dst country idx, type idx, severity 0..1

varying vec3 vColor;
varying float vAlpha;
varying float vSide;

vec3 arcPoint(float t) {
  float d = clamp(dot(aStart, aEnd), -0.9995, 0.9995);
  float th = acos(d);
  vec3 p = (sin((1.0 - t) * th) * aStart + sin(t * th) * aEnd) / sin(th);
  return p * (1.0 + aTiming.z * sin(3.14159265 * t));
}

void main() {
  float age = uTime - aTiming.x;
  float s = age / aTiming.y;
  float head = clamp(s, 0.0, 1.0);
  float tail = clamp(s - uTrail, 0.0, 1.0);
  float fade = 1.0;
  if (uMotion < 0.5) {
    // Reduced motion: draw the whole arc at once and fade it out.
    head = 1.0;
    tail = 0.0;
    fade = 1.0 - smoothstep(0.5, 1.0, age / (aTiming.y * (1.0 + uTrail)));
  }
  float alive = step(0.0, age) * step(s, 1.0 + uTrail);
  if (alive < 0.5 || head - tail < 1e-4) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume
    return;
  }

  float t = mix(tail, head, aT);
  vec3 p = arcPoint(t);
  vec3 tangent = arcPoint(min(t + 0.01, 1.0)) - arcPoint(max(t - 0.01, 0.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tanV = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
  vec3 side = normalize(cross(tanV, normalize(-mv.xyz)));

  float sel = 0.0;
  float dim = 1.0;
  if (uSelected > 0.5) {
    sel = max(1.0 - step(0.5, abs(aMeta.x - uSelected)), 1.0 - step(0.5, abs(aMeta.y - uSelected)));
    dim = mix(0.12, 1.0, sel);
  }
  float mask = uTypeMask[int(aMeta.z + 0.5)];

  float w = aTiming.w * (0.3 + 0.7 * aT) * (1.0 + 0.7 * sel);
  mv.xyz += side * aSide * w;
  gl_Position = projectionMatrix * mv;

  // Brightness ramps toward the head; values > 1 feed the bloom.
  float headGlow = pow(aT, 8.0);
  vColor = aColor * (0.9 + 0.5 * aMeta.w + 2.6 * headGlow) * (1.0 + 0.8 * sel);
  vAlpha = pow(aT, 1.4) * dim * mask * fade;
  vSide = aSide;
}
