#pragma once
// Shared WebGL context + program registry for the sand renderer.
//
// The GL *presentation* (upscale the cell texture, draw the gutter grid, the
// player overlay, and the draft preview) runs in C++ via emscripten/WebGL2. The
// material->RGBA pixel generation still happens on the CPU (render.inc); the
// renderPixels buffer is uploaded into a cell texture and composited here.
//
// A GL context is tied to a <canvas>, not to an Engine. The Engine is recreated
// on resize, but the canvas (and thus its context) persists, and a canvas can
// only hand out ONE context. So the context + the (context-global) shader
// program live in this per-target registry, keyed by the canvas selector, and
// survive engine recreation. Per-engine GL objects (the cell textures + FBOs)
// live on the Engine itself (gl.inc) and are rebuilt with it.

#include <emscripten/html5.h>
#include <GLES3/gl3.h>
#include <string>
#include <unordered_map>
#include <cstdio>

namespace sandgl {

struct Ctx {
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE handle = 0;
  GLuint prog = 0, vbo = 0, vao = 0;
  GLint uClipRect = -1, uTexRect = -1, uQuadDev = -1, uTex = -1,
        uCellDev = -1, uGutter = -1, uMode = -1, uColor = -1, uTint = -1;
  bool ready = false;
};

inline std::unordered_map<std::string, Ctx>& registry() {
  static std::unordered_map<std::string, Ctx> m;
  return m;
}

// One quad covering the visible window or a solid rect. The dest rect is given
// in clip space (uClipRect: xy=top-left, zw=bottom-right) and the texture span
// in uTexRect; vDev carries the device-px position within the quad so the
// fragment shader can carve the 1px gutter on exact cell boundaries.
inline const char* VERT() {
  return "#version 300 es\n"
         "precision highp float;\n"
         "layout(location=0) in vec2 aPos;\n"
         "uniform vec4 uClipRect;\n"
         "uniform vec4 uTexRect;\n"
         "uniform vec2 uQuadDev;\n"
         "out vec2 vUV;\n"
         "out vec2 vDev;\n"
         "void main(){\n"
         "  vec2 p = mix(uClipRect.xy, uClipRect.zw, aPos);\n"
         "  gl_Position = vec4(p, 0.0, 1.0);\n"
         "  vUV = mix(uTexRect.xy, uTexRect.zw, aPos);\n"
         "  vDev = aPos * uQuadDev;\n"
         "}\n";
}
inline const char* FRAG() {
  return "#version 300 es\n"
         "precision highp float;\n"
         "in vec2 vUV;\n"
         "in vec2 vDev;\n"
         "uniform sampler2D uTex;\n"
         "uniform float uCellDev;\n"
         "uniform int uGutter;\n"
         "uniform int uMode;\n"   // 0 = textured cells, 1 = solid uColor
         "uniform vec4 uColor;\n"
         "uniform float uTint;\n" // brightness multiplier (background drawn darker)
         "out vec4 frag;\n"
         "void main(){\n"
         "  if (uGutter == 1) {\n"
         "    if (mod(vDev.x, uCellDev) >= uCellDev - 1.0 ||\n"
         "        mod(vDev.y, uCellDev) >= uCellDev - 1.0) discard;\n"
         "  }\n"
         "  vec4 c = (uMode == 0) ? texture(uTex, vUV) : uColor;\n"
         "  if (c.a <= 0.0) discard;\n"
         "  frag = vec4(c.rgb * uTint * c.a, c.a);\n"  // premultiplied (context is premultipliedAlpha)
         "}\n";
}

inline GLuint compileShader(GLenum type, const char* src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[512];
    glGetShaderInfoLog(s, sizeof(log), nullptr, log);
    printf("sandgl: shader compile failed: %s\n", log);
    glDeleteShader(s);
    return 0;
  }
  return s;
}

inline void buildProgram(Ctx& c) {
  GLuint vs = compileShader(GL_VERTEX_SHADER, VERT());
  GLuint fs = compileShader(GL_FRAGMENT_SHADER, FRAG());
  if (!vs || !fs) return;
  GLuint p = glCreateProgram();
  glAttachShader(p, vs);
  glAttachShader(p, fs);
  glBindAttribLocation(p, 0, "aPos");
  glLinkProgram(p);
  glDeleteShader(vs);
  glDeleteShader(fs);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[512];
    glGetProgramInfoLog(p, sizeof(log), nullptr, log);
    printf("sandgl: program link failed: %s\n", log);
    glDeleteProgram(p);
    return;
  }
  c.prog = p;
  c.uClipRect = glGetUniformLocation(p, "uClipRect");
  c.uTexRect = glGetUniformLocation(p, "uTexRect");
  c.uQuadDev = glGetUniformLocation(p, "uQuadDev");
  c.uTex = glGetUniformLocation(p, "uTex");
  c.uCellDev = glGetUniformLocation(p, "uCellDev");
  c.uGutter = glGetUniformLocation(p, "uGutter");
  c.uMode = glGetUniformLocation(p, "uMode");
  c.uColor = glGetUniformLocation(p, "uColor");
  c.uTint = glGetUniformLocation(p, "uTint");

  // Unit quad as a triangle strip: (0,0)(1,0)(0,1)(1,1). Bound on a dedicated
  // VAO (required by WebGL2) so the draw path just binds the VAO + program.
  static const float quad[8] = {0, 0, 1, 0, 0, 1, 1, 1};
  glGenVertexArrays(1, &c.vao);
  glBindVertexArray(c.vao);
  glGenBuffers(1, &c.vbo);
  glBindBuffer(GL_ARRAY_BUFFER, c.vbo);
  glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, (void*)0);
}

// Create-or-get the context for `target` (a canvas selector, resolved through
// emscripten's specialHTMLTargets so it works inside a shadow root), make it
// current, and ensure the shader program is built. Returns nullptr on failure.
inline Ctx* acquire(const char* target) {
  auto& reg = registry();
  std::string key(target);
  auto it = reg.find(key);
  if (it != reg.end() && it->second.ready) {
    emscripten_webgl_make_context_current(it->second.handle);
    return &it->second;
  }
  EmscriptenWebGLContextAttributes attrs;
  emscripten_webgl_init_context_attributes(&attrs);
  attrs.majorVersion = 2;  // WebGL2 (FULL_ES3): glTexSubImage2D unpack + blit
  attrs.minorVersion = 0;
  attrs.alpha = true;
  attrs.depth = false;
  attrs.stencil = false;
  attrs.antialias = false;          // crisp nearest-neighbour cells (no MSAA)
  attrs.premultipliedAlpha = true;  // we emit premultiplied colors
  attrs.preserveDrawingBuffer = true; // bench reads pixels back between frames
  attrs.failIfMajorPerformanceCaveat = false;
  EMSCRIPTEN_WEBGL_CONTEXT_HANDLE h = emscripten_webgl_create_context(target, &attrs);
  if (h <= 0) {
    printf("sandgl: failed to create WebGL2 context for %s\n", target);
    return nullptr;
  }
  emscripten_webgl_make_context_current(h);
  Ctx c;
  c.handle = h;
  buildProgram(c);
  c.ready = (c.prog != 0);
  reg[key] = c;
  return c.ready ? &reg[key] : nullptr;
}

}  // namespace sandgl
