# Space campaign sprite references

These transparent pixel-art sheets define the visual direction for the IRIS
crew, mission entities, bosses, reactor, and mining manipulator. The WebGL
presenter implements the in-game sprites as code-native pixel grids in
`cpp/engine/glpresenter_impl.inc`, where they can animate with actor state
without adding a texture-loading path to the engine.
