uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  // Back faces of a slightly larger sphere. Facing away from the viewer
  // (-dot) is largest just outside the planet's limb and falls to zero at the
  // shell's own silhouette, giving a halo that hugs the planet.
  float f = clamp(-dot(vNormal, vView) * 2.1, 0.0, 1.0);
  float glow = pow(f, 2.6) * uIntensity;
  gl_FragColor = vec4(uColor * glow, glow);
}
