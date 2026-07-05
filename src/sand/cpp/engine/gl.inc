  // WebGL compositor (GLPresenter, glpresenter.hpp) — composed here; method
  // bodies in glpresenter_impl.inc.
  GLPresenter glp{*this};
  // Shims for internal callers (streamWorld texture slide, the Engine dtor).
  void glShift(int dx) { glp.glShift(dx); }
  void glShiftV(int dy) { glp.glShiftV(dy); }
  void glDestroy() { glp.glDestroy(); }
