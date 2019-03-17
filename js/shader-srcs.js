var vertShader =
`#version 300 es
#line 4
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform vec3 eye_pos;
uniform vec3 volume_scale;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main(void) {
	// TODO: For non-uniform size volumes we need to transform them differently as well
	// to center them properly
	vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1);
	transformed_eye = (eye_pos - volume_translation) / volume_scale;
	vray_dir = pos - transformed_eye;
}`;

var fragShader =
`#version 300 es
#line 24
precision highp int;
precision highp float;
uniform highp sampler3D volume;
uniform highp sampler2D colormap;
uniform highp sampler2D depth;
uniform ivec3 volume_dims;
uniform vec3 eye_pos;
uniform vec3 volume_scale;
uniform float dt_scale;
uniform mat4 inv_proj;
uniform mat4 inv_view;
uniform int highlight_trace;

in vec3 vray_dir;
flat in vec3 transformed_eye;
out vec4 color;

vec2 intersect_box(vec3 orig, vec3 dir) {
	const vec3 box_min = vec3(0);
	const vec3 box_max = vec3(1);
	vec3 inv_dir = 1.0 / dir;
	vec3 tmin_tmp = (box_min - orig) * inv_dir;
	vec3 tmax_tmp = (box_max - orig) * inv_dir;
	vec3 tmin = min(tmin_tmp, tmax_tmp);
	vec3 tmax = max(tmin_tmp, tmax_tmp);
	float t0 = max(tmin.x, max(tmin.y, tmin.z));
	float t1 = min(tmax.x, min(tmax.y, tmax.z));
	return vec2(t0, t1);
}

// Pseudo-random number gen from
// http://www.reedbeta.com/blog/quick-and-easy-gpu-random-numbers-in-d3d11/
// with some tweaks for the range of values
float wang_hash(int seed) {
	seed = (seed ^ 61) ^ (seed >> 16);
	seed *= 9;
	seed = seed ^ (seed >> 4);
	seed *= 0x27d4eb2d;
	seed = seed ^ (seed >> 15);
	return float(seed % 2147483647) / float(2147483647);
}

// Linearize the depth value passed in
// TODO: Encode/decode via http://aras-p.info/blog/2009/07/30/encoding-floats-to-rgba-the-final/
// what do people do for shadow mapping? it's the same thing..
// use webgl depth texture extension for this
float linearize(float d) {
	float near = 0.0;
	float far = 1.0;
	return (2.f * d - near - far) / (far - near);
}

// Reconstruct the view-space depth
vec4 compute_view_pos(float z) {
	vec4 pos = vec4(gl_FragCoord.xy / vec2(640, 480) * 2.f - 1.f, z, 1.f);
	pos = inv_proj * pos;
	return pos / pos.w;
}

void main(void) {
	vec3 ray_dir = normalize(vray_dir);
	vec2 t_hit = intersect_box(transformed_eye, ray_dir);
	if (t_hit.x > t_hit.y) {
		discard;
	}

	t_hit.x = max(t_hit.x, 0.0);

	float z = linearize(texelFetch(depth, ivec2(gl_FragCoord), 0).x);
	if (z < 1.0) {
		vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
		vec3 geom_pos = (inv_view * compute_view_pos(z)).xyz;
		geom_pos = (geom_pos - volume_translation) / volume_scale;
		t_hit.y = min(length(geom_pos - transformed_eye), t_hit.y);

		// Highlighting the trace just skips properly compositing it in the volume
		if (highlight_trace != 0) {
			color = vec4(0);
			return;
		}
	}

	vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
	float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));
	float offset = wang_hash(int(gl_FragCoord.x + 640.0 * gl_FragCoord.y));
	vec3 p = transformed_eye + (t_hit.x + offset * dt) * ray_dir;
	for (float t = t_hit.x; t < t_hit.y; t += dt) {
		float val = texture(volume, p).r;
		vec4 val_color = vec4(texture(colormap, vec2(val, 0.5)).rgb, val);
		color.rgb += (1.0 - color.a) * val_color.a * val_color.rgb;
		color.a += (1.0 - color.a) * val_color.a;
		if (color.a >= 0.95) {
			break;
		}
		p += ray_dir * dt;
	}
}`;

var swcVertShader =
`#version 300 es
#line 127
layout(location=0) in vec3 pos;

uniform mat4 proj_view;
uniform vec3 volume_scale;
uniform ivec3 volume_dims;

void main(void) {
	vec3 volume_translation = vec3(0.5) - volume_scale * 0.5;
	gl_Position = proj_view * vec4((pos / vec3(volume_dims)) * volume_scale + volume_translation, 1);
}`;

var swcFragShader =
`#version 300 es
#line 139
precision highp float;

uniform vec3 swc_color;

out vec4 color;

void main(void) {
	color = vec4(swc_color, 1);
}`;

var quadVertShader =
`#version 300 es
#line 152
const vec4 pos[4] = vec4[4](
	vec4(-1, 1, 0.5, 1),
	vec4(-1, -1, 0.5, 1),
	vec4(1, 1, 0.5, 1),
	vec4(1, -1, 0.5, 1)
);
void main(void){
	gl_Position = pos[gl_VertexID];
}`;

var quadFragShader =
`#version 300 es
#line 165
precision highp int;
precision highp float;

uniform sampler2D colors;
out vec4 color;

void main(void){ 
	ivec2 uv = ivec2(gl_FragCoord.xy);
	color = texelFetch(colors, uv, 0);
}`;

