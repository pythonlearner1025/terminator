/** Two continuous photographic fields at the publisher's 2 m scan scale.
 * No per-tile discontinuities, UV fract seams, synthesized relief, or displacement.
 * Normal XY uses the inverse of the UV rotation before either field is blended.
 */
export const V2_SUBSTRATE_GLSL = /* glsl */`
  uniform sampler2D v2GroundAlbedo;
  uniform sampler2D v2GroundNormal;
  uniform sampler2D v2GroundSurface;
  void v2SampleSubstrate(vec3 p, out vec3 albedo, out vec3 detailNormal,
                         out vec3 packed, out float dust) {
    vec2 q=vec2(p.x,-p.z)/2.;
    // R(angle) UV, R(-angle) normal. Both bases keep +Y surface handedness.
    mat2 a=mat2(.9171208,.3986093,-.3986093,.9171208);
    mat2 ai=mat2(.9171208,-.3986093,.3986093,.9171208);
    mat2 b=mat2(.4266598,-.9044122,.9044122,.4266598);
    mat2 bi=mat2(.4266598,.9044122,-.9044122,.4266598);
    vec2 qa=a*q+vec2(.17,.63), qb=b*q+vec2(3.71,8.19);
    // Broad connected patches break repetition without stamping cells or edges.
    float blend=smoothstep(.38,.62,v2Noise(p*.19+vec3(13.1,2.7,9.3)));
    vec3 ca=texture2D(v2GroundAlbedo,qa).rgb;
    vec3 cb=texture2D(v2GroundAlbedo,qb).rgb;
    vec3 na=texture2D(v2GroundNormal,qa).xyz*2.-1.;
    vec3 nb=texture2D(v2GroundNormal,qb).xyz*2.-1.;
    na.xy=ai*na.xy; nb.xy=bi*nb.xy;
    detailNormal=normalize(mix(na,nb,blend));
    packed=mix(texture2D(v2GroundSurface,qa).rgb,texture2D(v2GroundSurface,qb).rgb,blend);
    // Metre-scale elongated deposits, leaving continuous aggregate in cleaner lanes.
    dust=smoothstep(.40,.78,v2Noise(p*vec3(.12,.17,.39)+vec3(21.3,4.1,6.7)));
    // Pilot06 exposed pale demolition dust against dark scan chunks. Soot
    // reduces mineral reflectance locally while retaining every photo feature.
    float soot=smoothstep(.25,.77,v2Noise(p*.23+vec3(4.9,7.1,18.3)));
    albedo=mix(ca,cb,blend)*mix(.36,.19,soot)*(.55+.45*packed.r);
    albedo=mix(albedo,vec3(.045,.043,.039),dust*.24);
    // Native photographed slopes break grazing highlights; dust still softens them.
    detailNormal.xy*=mix(1.,.65,dust);
    detailNormal=normalize(detailNormal);
  }
`
