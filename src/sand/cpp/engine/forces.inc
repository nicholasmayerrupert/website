  // Spatial forces are rebuilt from compact emitters once per world tick. The
  // implementation lives in forces_impl.inc after Engine is complete.
  ForceSystem forces{*this};
