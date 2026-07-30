#pragma once
// Material pixels and lighting. Render animation uses a separate RNG, and grain
// is keyed to absolute world position so rendering cannot perturb simulation.

struct Engine;

// Render-only entity emission. Positions are buffer-local grid cells so the
// ordinary terrain-aware flood can treat moving actors exactly like emissive
// materials without putting presentation state into saves or checksums.
struct RenderLightSource {
  int x = 0, y = 0;
  uint8_t intensity = 0;
};

// Brighten/darken a packed ABGR color by delta on each channel (alpha kept).
static inline uint32_t jitterShade(uint32_t packed, int delta) {
  if (packed == 0) return 0;
  uint32_t a = packed & 0xff000000u;
  int r = (int)(packed & 0xff), g = (int)((packed >> 8) & 0xff), b = (int)((packed >> 16) & 0xff);
  r += delta; g += delta; b += delta;
  if (r < 0) r = 0; else if (r > 255) r = 255;
  if (g < 0) g = 0; else if (g > 255) g = 255;
  if (b < 0) b = 0; else if (b > 255) b = 255;
  return a | ((uint32_t)b << 16) | ((uint32_t)g << 8) | (uint32_t)r;
}

class Renderer {
 public:
  explicit Renderer(Engine& e) : E(e) {}

  static constexpr bool RENDER_LIGHTING_ENABLED = true;
  // Keep unlit caves readable, but dark enough that nearby light sources carry
  // visibly stronger contrast.
  static constexpr uint8_t LIGHT_AMBIENT = 20;
  static constexpr uint8_t CROSS_LAYER_EMISSIVE_LOSS = 28;

  // Renderer tables (material -> RGBA). Shared (layer-agnostic).
  uint32_t renderVariants[TABLE * 8]; // 8 brightness-shifted shades per material
  uint32_t renderAlphaMask[TABLE];     // schema transparency converted to packed ABGR alpha
  uint8_t renderLightLoss[TABLE];      // material -> propagation loss (lighting hot loop)
  uint8_t renderLightTransparent[TABLE];
  uint8_t renderFaceLit[TABLE];
  uint8_t renderNoise[64 * 64];       // stable per-cell grain selector (0..7)
  uint32_t renderRngState = 0;
  // Shared render-only animation clock. The GL presenter sets this from a
  // wall-clock cadence; headless renderFull() advances it explicitly.
  uint32_t renderFrameSalt = 0;
  uint8_t renderSkyLight = 255;       // render-only day/night input; 255 = full day
  std::vector<RenderLightSource> dynamicLights;
  // Packed [x:k] entries avoid dividing k by cols for every flood-fill pop.
  std::vector<uint64_t> lightQueue;   // render-only flood-fill scratch
  // Snapshot storage used by exact lighting patches. A patch solves with a
  // propagation margin, keeps its exact inner rect, then restores the margin.
  std::vector<uint8_t> lightPatchScratch;

  void init(uint32_t seed) { renderRngState = seed ^ 0x9e3779b9u; buildRenderTables(); }
  inline double renderRand() {
    renderRngState = (renderRngState + 0x6d2b79f5u);
    uint32_t a = renderRngState;
    uint32_t t = a ^ (a >> 15); t = t * (1u | a);
    uint32_t t2 = t ^ (t >> 7); t = (t + (t2 * (61u | t))) ^ t;
    return (double)(t ^ (t >> 14)) / 4294967296.0;
  }

  static inline uint32_t renderCellHash(int wx, int wy) {
    uint32_t h = (uint32_t)wx * 0x9e3779b1u;
    h ^= (uint32_t)wy * 0x85ebca77u;
    h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
    return h;
  }
  static inline bool myceliumNoduleAt(int wx, int wy) {
    uint32_t h = renderCellHash(wx, wy);
    return (h % 19u) == 0u || (((h >> 8) % 53u) == 0u);
  }
  // Baseline emission strength comes from the schema (MAT_EMISSION); CRYSTAL and
  // MYCELIUM emit from sparse positional pockets rather than every cell.
  static inline uint8_t emissionForCell(uint8_t m, int wx, int wy) {
    uint8_t e = MAT_EMISSION[m];
    if (!e) return 0;
    if (m == CRYSTAL) return (((wx * 17 + wy * 31) & 3) == 0) ? e : 0;
    if (m == MYCELIUM) return (((wx * 13 + wy * 29) & 31) == 0) ? e : 0;
    return e;
  }
  static inline uint8_t crossLayerEmissionFor(uint8_t m, int wx, int wy) {
    uint8_t e = emissionForCell(m, wx, wy);
    if (!e) return 0;
    int v = (int)e - CROSS_LAYER_EMISSIVE_LOSS;
    return v > LIGHT_AMBIENT ? (uint8_t)v : 0;
  }
  inline uint8_t edgeSkyLight() const {
    return (uint8_t)(((int)renderSkyLight * 220 + 127) / 255);
  }
  static inline uint32_t applyLight(uint32_t packed, uint8_t light) {
    if (packed == 0) return 0;
    uint32_t a = packed & 0xff000000u;
    uint32_t r = packed & 0xffu, g = (packed >> 8) & 0xffu, b = (packed >> 16) & 0xffu;
    r = (r * light + 127u) / 255u;
    g = (g * light + 127u) / 255u;
    b = (b * light + 127u) / 255u;
    return a | (b << 16) | (g << 8) | r;
  }

  inline bool transparentForLight(uint8_t m) const { return renderLightTransparent[m] != 0; }
  inline int lightLossFor(uint8_t m) const { return renderLightLoss[m]; }
  inline bool faceLitMaterial(uint8_t m) const { return renderFaceLit[m] != 0; }
  bool topRayStartsInSky(Layer* lay, int x);
  bool sideRayStartsInSky(Layer* lay, int x, int y);
  bool directSkyCurrent(Layer* lay) const;
  // Lighting solves take an inclusive cell region [rx0,ry0..rx1,ry1]. Light
  // influence dies within ceil((255 - LIGHT_AMBIENT) / minLoss) = 59 cells of its
  // source (min loss 4/cell through air) and the cross-layer projection is
  // cell-to-cell, so a solve over window+margin is EXACT inside the window
  // for any margin > 60 (+1 for the face-lit neighbour ring). Values in the
  // margin ring may underestimate (their far sources are cut off) — they are
  // never sampled. The GL present path solves the visible window + margin;
  // shifts/day-night/canvas renderFull still solve the full buffer.
  void remapSkyTopInput(Layer* lay);
  void computeDirectSky(Layer* lay, int rx0, int ry0, int rx1, int ry1);
  void computeLightingBase(Layer* lay, int rx0, int ry0, int rx1, int ry1);
  void projectCrossLayerLight(Layer* lay, Layer* crossLay, int rx0, int ry0, int rx1, int ry1);
  void computeLighting(Layer* lay, Layer* crossLay = nullptr);
  void computeLightingBoth(int rx0, int ry0, int rx1, int ry1);
  void computeLightingBothPatch(int sx0, int sy0, int sx1, int sy1,
                                int keepX0, int keepY0, int keepX1, int keepY1);
  uint8_t renderLightForCell(const uint8_t* light, int k, int x, int y, uint8_t m) const;
  void buildRenderTables();
  bool fillRenderSpan(uint8_t* g, uint32_t* p, int x0, int y0, int x1, int y1);
  void renderFull();
  void renderDirtyRects();

 private:
  Engine& E;
};
