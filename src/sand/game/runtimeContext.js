/**
 * Shared state composed by the browser runtime modules.
 *
 * @typedef {Object} SandRuntimeContext
 * @property {HTMLElement} container
 * @property {HTMLCanvasElement} canvas
 * @property {*} parallax
 * @property {*} audio
 * @property {boolean} survival
 * @property {boolean} debugHitboxes
 * @property {number} planetId
 * @property {number|undefined} gravityScale
 * @property {number} missionId
 * @property {Array<*>} missionLoadout
 * @property {number} worldSeed
 * @property {number} baselineDpr
 * @property {number} maxTextureSize
 * @property {*|null} engine
 * @property {number} cols
 * @property {number} rows
 * @property {number} cellSize
 * @property {number} cellDev
 * @property {number} dpr
 * @property {number} viewCols
 * @property {number} viewRows
 * @property {number} requestedViewCols
 * @property {number} requestedViewRows
 * @property {number} requestedBufferCols
 * @property {number} requestedBufferRows
 * @property {{width: number, height: number}|null} stableCssSize
 * @property {number} zoom
 * @property {number} lastCamX
 * @property {number} lastCamY
 * @property {boolean} forceFullRender
 * @property {boolean} previewDirty
 * @property {number} perfRenderMs
 * @property {*|null} dayNight
 * @property {number} dayVisualKey
 * @property {number|null} dayPhaseOverride
 * @property {number} appliedSkyLight
 * @property {string} currentToolName
 * @property {boolean} drawModeOn
 * @property {boolean} playMode
 * @property {number} localPlayerId
 * @property {*|null} worldWorker
 * @property {number} creativeKind
 * @property {number} creativeValue
 * @property {number|null} lastCreativeMaterial
 * @property {boolean} creatureSimulationRequested
 * @property {number} inputSeq
 * @property {number} clientX
 * @property {number} clientY
 * @property {number} px
 * @property {number} py
 * @property {boolean} inside
 * @property {number} mouseButtons
 * @property {number} touchButton
 * @property {number} stickX
 * @property {number} stickY
 * @property {{left: number, right: number, top: number, bottom: number}} wrapBounds
 * @property {boolean} testPaused
 * @property {boolean} gutterOn
 * @property {boolean} snapOff
 * @property {*|null} net
 * @property {boolean} reduced
 * @property {boolean} viewportActive
 * @property {boolean} audioEnabled
 * @property {{actorSteps: number, actorDebtMs: number, actorDroppedMs: number,
 *   worldStepped: boolean}|null} timingStats
 * @property {() => boolean} netClientReady
 * @property {() => number} zoomFactor
 * @property {() => number} bgZoomScale
 * @property {{render?: (forceFull?: boolean) => void}} fns
 * @property {(() => *)|null} startLocalAuthority
 * @property {(() => void)|null} stopLocalAuthority
 * @property {((message: string|null) => void)|null} setAuthorityError
 */

export {};
