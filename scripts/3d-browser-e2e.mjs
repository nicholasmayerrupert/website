import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startTestServer } from './browser-harness.mjs';

const server = await startTestServer({ production: !process.argv.includes('--dev') });
const artifacts = resolve(process.env.SAND_TEST_ARTIFACTS || '.sand-artifacts/3d-browser');
mkdirSync(artifacts, { recursive: true });
let browser;
const hardware = process.argv.includes('--hardware') || (process.platform === 'win32' && !process.argv.includes('--software'));
try {
  browser = await chromium.launch({ headless: true, args: hardware ? ['--use-angle=d3d11'] : ['--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|Error compiling.*executable/.test(message.text())) errors.push(message.text());
  });
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${server.baseURL}/`, { waitUntil: 'networkidle' });
  assert.ok(!requests.some(url => /voxelDemo|sand3d/.test(url)), 'home does not request any 3D code or WASM');
  assert.equal(await page.evaluate(() => window.__voxelDemo), undefined);
  console.log('Home: no 3D requests or runtime.');
  await page.goto('about:blank');
  requests.length = 0; errors.length = 0;
  await page.goto(`${server.baseURL}/3d?test`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#voxel-canvas[data-ready="true"]', { timeout: 60000 });
  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('voxel-canvas').getContext('webgl2');
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  });
  if (hardware) assert.match(renderer, /Direct3D11/, 'hardware regression runs on the D3D11 backend');
  console.log(`Renderer: ${renderer}`);
  assert.ok(requests.some(url => /voxelDemo.*\.wasm/.test(url)), '3D navigation loads its WASM');
  assert.ok(!requests.some(url => /sandEngine.*\.wasm|worldWorker/.test(url)), '3D does not start the 2D engine');
  await page.screenshot({ path: resolve(artifacts, 'desktop-intro.png') });
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.__voxelDemo.stats()[0] > 5);
  const before = await page.evaluate(() => window.__voxelDemo.stats());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  assert.ok((await page.evaluate(() => window.__voxelDemo.stats()))[7] < before[7] - 0.3, 'keyboard moves the camera');
  const colors = await page.evaluate(() => {
    window.__voxelDemo.render();
    const canvas = document.getElementById('voxel-canvas');
    const gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const distinct = new Set();
    for (let i = 0; i < pixels.length; i += 128) distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return { count: distinct.size, error: gl.getError() };
  });
  assert.equal(colors.error, 0, 'drawing and readback succeed on the selected graphics backend');
  assert.ok(colors.count > 50, 'raycaster renders a non-uniform material scene');
  await page.screenshot({ path: resolve(artifacts, 'desktop-quarry.png') });
  await page.keyboard.press('Digit5');
  await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up();
  await page.waitForFunction(() => window.__voxelDemo.stats()[1] > 0);
  console.log('Desktop: camera, tool selection, and throwing work through DOM input.');

  await page.locator('#brush').fill('10');
  await page.locator('#brush').dispatchEvent('input');
  await page.evaluate(() => {
    const d = window.__voxelDemo; d.menu(true); d.reset(); d.tool(0);
    for (const x of [-1.75, 1.75]) {
      d.camera(x, 1, 2, 0, 0); d.use();
    }
    d.pause(false); d.step(120); d.pause(true); d.render();
  });
  const mined = await page.evaluate(() => window.__voxelDemo.stats());
  assert.ok(mined[3] > 0 && mined[1] > 0, 'mining detaches structures in the browser');
  await page.evaluate(() => { const d = window.__voxelDemo; d.camera(0, 4, 8, 0, -0.18); d.render(); });
  await page.locator('#intro').evaluate(el => { el.hidden = true; });
  await page.screenshot({ path: resolve(artifacts, 'desktop-mined.png') });
  await page.evaluate(() => window.__voxelDemo.menu(true));
  const paused = await page.evaluate(() => window.__voxelDemo.stats()[0]);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__voxelDemo.stats()[0]), paused);
  assert.equal(await page.evaluate(() => window.__voxelDemo.running), false, 'menu cancels RAF processing');
  await page.screenshot({ path: resolve(artifacts, 'desktop-paused.png') });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  // A material-specific readback catches an occupancy mip view that silently skips fine terrain.
  const timber = await page.evaluate(() => {
    const d=window.__voxelDemo;d.reset();d.camera(-1.75,1,2,0,0);d.render();
    const canvas=document.getElementById('voxel-canvas'),gl=canvas.getContext('webgl2'),pixel=new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return {pixel:Array.from(pixel),material:d.stats()[9],error:gl.getError()};
  });
  assert.equal(timber.material,4);
  assert.equal(timber.error,0);
  assert.ok(timber.pixel[0]>timber.pixel[1] && timber.pixel[1]>timber.pixel[2],'nearby timber renders through all occupancy hierarchy levels');
  // Exercise arbitrary edited materials, not just procedural terrain, at every
  // detail level. Single-cell placements catch non-conservative downsampling.
  await page.locator('#brush').evaluate(el=>{el.value='6';el.dispatchEvent(new Event('input'));});
  const distantMaterials=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);
    d.camera(3.03125,5,3.03125,0,-Math.PI/2);d.tool(1);d.use();d.pause(false);d.step(180);d.pause(true);
    d.camera(.03125,3,3.03125,0,-Math.PI/2);d.tool(2);d.use();
    d.camera(1.03125,3,3.03125,0,-Math.PI/2);d.tool(3);d.use();d.render();
    const points=[[3.03125,.25,3.03125],[.03125,.03125,3.03125],[1.03125,.03125,3.03125],[.03125,-.03125,5.03125]];
    const near=points.map(p=>d.cell(...p));
    d.camera(3.03125,15,18,0,-Math.atan2(14.5,18-3.03125));d.render();
    const levels=[1,2,3].map(level=>points.map(p=>d.renderCell(...p,level)));
    const c=document.getElementById('voxel-canvas'),gl=c.getContext('webgl2'),pixels=new Uint8Array(11*11*4);
    gl.readPixels(Math.floor(c.width/2)-5,Math.floor(c.height/2)-5,11,11,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let sandPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>pixels[i+1]*1.06&&pixels[i+1]>pixels[i+2]*1.06)sandPixels++;
    return {near,levels,sandPixels,evicted:d.cell(...points[0])===0};
  });
  assert.deepEqual(distantMaterials.near,[1,3,4,5]);
  assert.equal(distantMaterials.evicted,true,'sand is outside the simulation window');
  assert.deepEqual(distantMaterials.levels,[[1,3,4,5],[1,3,4,5],[1,3,4,5]],'sand, stone, timber, and grass survive all distant detail levels');
  assert.ok(distantMaterials.sandPixels>20,'GPU still draws poured sand after its simulation chunk is evicted');
  await page.locator('#intro').evaluate(el=>{el.hidden=true;});
  await page.screenshot({path:resolve(artifacts,'desktop-distant-materials.png')});
  await page.locator('#brush').evaluate(el=>{el.value='16';el.dispatchEvent(new Event('input'));});
  const removed=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.camera(3.03125,5,3.03125,0,-Math.PI/2);d.tool(0);d.use();d.render();
    const near=d.cell(3.03125,.25,3.03125);
    d.camera(3.03125,15,18,0,-Math.atan2(14.5,18-3.03125));d.render();
    return [near,...[1,2,3].map(level=>d.renderCell(3.03125,.25,3.03125,level))];
  });
  assert.deepEqual(removed,[0,0,0,0],'mining invalidates every detail level, including cached empty cells');
  const bodyPersistence=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.camera(3.03125,5,3.03125,0,-Math.PI/2);d.tool(4);d.use();d.pause(false);d.step(240);d.pause(true);
    const before=d.stats()[11];d.render();
    const c=document.getElementById('voxel-canvas'),gl=c.getContext('webgl2'),pixels=new Uint8Array(11*11*4);
    // Aim at the settled body's actual centre; angular contact can move it sideways.
    const program=gl.getParameter(gl.CURRENT_PROGRAM),uniform=name=>{
      if(!name.startsWith('body'))return gl.getUniform(program,gl.getUniformLocation(program,name));
      const index=gl.getUniformIndices(program,[name]);
      const offset=gl.getActiveUniforms(program,index,gl.UNIFORM_OFFSET)[0];
      const binding=gl.getActiveUniformBlockParameter(program,gl.getUniformBlockIndex(program,'BodyTransforms'),gl.UNIFORM_BLOCK_BINDING);
      gl.bindBuffer(gl.UNIFORM_BUFFER,gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,binding));
      const value=new Float32Array(4);gl.getBufferSubData(gl.UNIFORM_BUFFER,offset,value);return value;
    };
    const p=uniform('bodyPosition[0]'),q=uniform('bodyRotation[0]'),size=uniform('bodySize[0]'),origin=uniform('worldPhase');
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const v=Array.from(size).slice(0,3).map(a=>a/2),a=cross(q,v),b=cross(q,a.map((a,i)=>a+q[3]*v[i]));
    const center=v.map((v,i)=>(origin[i]+p[i]+v+2*b[i])*.0625);
    d.camera(center[0],center[1]+14,center[2]+17,0,-Math.atan2(14,17));d.render();
    gl.readPixels(Math.floor(c.width/2)-5,Math.floor(c.height/2)-5,11,11,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let stonePixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>pixels[i]*1.1&&pixels[i+2]>pixels[i]*1.1)stonePixels++;
    return {before,after:d.stats()[11],active:d.stats()[1],archived:d.stats()[24],stonePixels,center};
  });
  assert.equal(bodyPersistence.active,1);assert.equal(bodyPersistence.archived,0);
  assert.equal(bodyPersistence.after,bodyPersistence.before,'visible bodies retain their geometry beyond the simulation window');
  await page.screenshot({path:resolve(artifacts,'desktop-distant-body.png')});
  assert.ok(bodyPersistence.stonePixels>10,`GPU draws the rigid body after the terrain window moves away: ${JSON.stringify(bodyPersistence)}`);
  console.log('Continuity: sand, single-voxel edits, grass surfaces, mined air, and rigid bodies survive detail boundaries.');
  const expandedBodies=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);d.tool(4);
    for(let i=0;i<32;++i)d.use();
    d.camera(8,12,8,0,0);d.use();d.camera(8,12,8,0,0);d.render();
    const c=document.getElementById('voxel-canvas'),gl=c.getContext('webgl2'),visible=new Uint8Array(11*11*4),hidden=new Uint8Array(visible.length);
    const read=pixels=>gl.readPixels(Math.floor(c.width/2)-5,Math.floor(c.height/2)-5,11,11,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    read(visible);
    gl.uniform1i(gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),'bodyCount'),0);gl.drawArrays(gl.TRIANGLES,0,3);read(hidden);
    let changed=0;for(let i=0;i<visible.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(visible[i+k]-hidden[i+k])))>20)++changed;
    d.render();return {bodies:d.stats()[1],material:d.stats()[9],changed,error:gl.getError()};
  });
  assert.equal(expandedBodies.bodies,33,'new rigid bodies exceed the old 32-body limit');
  assert.equal(expandedBodies.material,3);
  assert.ok(expandedBodies.changed>100,`a body in the second atlas bank renders at its own pose: ${JSON.stringify(expandedBodies)}`);
  assert.equal(expandedBodies.error,0,'body uniform buffer and texture-array uploads are valid');
  await page.evaluate(()=>window.__voxelDemo.reset());
  const distantTimber=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.camera(1.75,20,80,0,-Math.atan2(18.5,80.75));d.render();
    const c=document.getElementById('voxel-canvas'),gl=c.getContext('webgl2'),pixel=new Uint8Array(4);
    gl.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return {pixel:Array.from(pixel),material:d.renderCell(1.75,1.5,-.75,3),error:gl.getError()};
  });
  await page.screenshot({path:resolve(artifacts,'desktop-expanded-distance.png')});
  assert.equal(distantTimber.error,0);assert.equal(distantTimber.material,4);
  assert.ok(distantTimber.pixel[0]>distantTimber.pixel[1]&&distantTimber.pixel[1]>distantTimber.pixel[2],`timber remains visible more than 80 m away: ${JSON.stringify(distantTimber)}`);
  await page.evaluate(() => {const d=window.__voxelDemo;d.camera(0,6,8,Math.PI/2,0);d.menu(false);});
  const flightStart=await page.evaluate(()=>window.__voxelDemo.stats());
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');await page.waitForTimeout(4500);
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');
  const flight=await page.evaluate(()=>window.__voxelDemo.stats());
  assert.ok(flight[5]>flightStart[5]+32,'DOM flight crosses the original full-detail window');
  assert.ok(flight[18]>flightStart[18]+4,'terrain streams while flying');
  await page.screenshot({path:resolve(artifacts,'desktop-streamed.png')});
  await page.evaluate(()=>window.__voxelDemo.menu(true));
  assert.deepEqual(errors,[]);
  console.log(`Streaming: flew ${(flight[5]-flightStart[5]).toFixed(1)} m through ${flight[18]-flightStart[18]} window shifts.`);
  const fluidLevels=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);
    const points=Array.from({length:7},(_,i)=>[-6+i*2+.03125,1.03125,8.03125]);
    points.forEach((p,i)=>d.edit(...p,8+i));d.render();
    const near=points.map(p=>d.cell(...p));
    d.camera(0,15,18,0,-.7);d.render();
    return {near,levels:[1,2,3].map(level=>points.map(p=>d.renderCell(...p,level)))};
  });
  assert.deepEqual(fluidLevels.near,[8,9,10,11,12,13,14]);
  assert.deepEqual(fluidLevels.levels,Array.from({length:3},()=>[8,9,10,11,12,13,14]),'every fluid and reaction product survives every distant detail level');
  const clipmapParity=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);d.render();
    const points=[];
    for(let z=3;z<=5;z+=.5)for(let x=-6;x<=6;x+=.5)points.push([x+.03125,1.03125,z+.03125]);
    points.forEach((p,i)=>d.edit(...p,1+i%14));d.render();
    points.forEach((p,i)=>{if(i%3===0)d.edit(...p,0);else if(i%3===1)d.edit(...p,8+i%7);});d.render();
    const sample=()=>[1,2,3].map(level=>points.map(p=>d.renderCell(...p,level)));
    const incremental=sample();
    d.camera(200,20,200,0,0);d.render();d.camera(0,4,8,0,-.18);d.render();
    return {incremental,regenerated:sample()};
  });
  assert.deepEqual(clipmapParity.incremental,clipmapParity.regenerated,'incremental clipmap edits, replacements, and deletions exactly match a full rebuild');
  const illumination=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);d.camera(4.5,2,-3.6,0,-.65);d.render();
    const canvas=document.getElementById('voxel-canvas'),gl=canvas.getContext('webgl2');
    const program=gl.getParameter(gl.CURRENT_PROGRAM),location=gl.getUniformLocation(program,'lightCount');
    const count=gl.getUniform(program,location),lit=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,lit);
    gl.uniform1i(location,0);gl.drawArrays(gl.TRIANGLES,0,3);
    const dark=new Uint8Array(lit.length);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,dark);
    // A source inside the resistant tray floor must not illuminate through it.
    const eye=gl.getUniform(program,gl.getUniformLocation(program,'eye')),stats=d.stats();
    gl.uniform1i(location,1);
    gl.uniform4f(gl.getUniformLocation(program,'lightPosition[0]'),eye[0]+(4.5-stats[5])*16,eye[1]+(-1.125-stats[6])*16,eye[2]+(-6-stats[7])*16,128);
    gl.uniform4f(gl.getUniformLocation(program,'lightColor[0]'),1,.3,.025,4);
    gl.drawArrays(gl.TRIANGLES,0,3);const buried=new Uint8Array(lit.length);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,buried);
    let warmed=0,maxRed=0,blockedDelta=0;
    for(let i=0;i<lit.length;i+=4){const red=lit[i]-dark[i];if(red>5)warmed++;maxRed=Math.max(maxRed,red);}
    for(let i=0;i<lit.length;++i)blockedDelta=Math.max(blockedDelta,Math.abs(buried[i]-dark[i]));
    d.render();return {count,warmed,maxRed,blockedDelta,error:gl.getError()};
  });
  assert.ok(illumination.count>0&&illumination.count<=24,'lava creates a bounded set of clustered sources');
  assert.ok(illumination.warmed>100&&illumination.maxRed>20,'lava casts warm light onto nearby surfaces');
  assert.equal(illumination.blockedDelta,0,'solid terrain blocks emissive light');
  assert.equal(illumination.error,0,'clustered lighting uniforms and draws succeed');
  console.log('Lighting: clustered lava illuminates nearby material and solid terrain blocks light.');
  const fluidColors=await page.evaluate(()=>{
    const d=window.__voxelDemo;d.reset();d.pause(true);
    const canvas=document.getElementById('voxel-canvas'),gl=canvas.getContext('webgl2');
    return [-4.5,0,4.5].map(x=>{
      // Aim inside a voxel face, clear of the gold selection outline.
      d.camera(x+.03125,3,-6+.03125,0,-Math.PI/2);d.render();const pixel=new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return Array.from(pixel);
    });
  });
  assert.ok(fluidColors[0][2]>fluidColors[0][0],'water has a translucent blue surface');
  assert.ok(fluidColors[1][1]>fluidColors[1][0]&&fluidColors[1][1]>fluidColors[1][2],'acid is visibly green');
  assert.ok(fluidColors[2][0]>fluidColors[2][1]*1.5,'lava remains visibly emissive');
  const dustBefore=await page.evaluate(()=>window.__voxelDemo.count(13));
  await page.evaluate(()=>window.__voxelDemo.menu(false));
  await page.locator('#voxel-canvas').press('Digit6');
  assert.equal(await page.locator('[data-tool="5"]').getAttribute('aria-pressed'),'true');
  await page.mouse.move(640,400);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
  await page.waitForFunction(before=>window.__voxelDemo.count(13)>before,dustBefore,{timeout:10000});
  await page.locator('#voxel-canvas').press('KeyL');
  await page.screenshot({path:resolve(artifacts,'desktop-material-lab.png')});
  assert.deepEqual(errors,[],'fluid shading and interaction run without GPU or runtime errors');
  console.log('Materials: water, acid, and lava render; keyboard pouring quenches lava; the lab shortcut works.');
  await page.evaluate(() => document.getElementById('voxel-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => !document.getElementById('retry').hidden);
  assert.equal(await page.evaluate(() => window.__voxelDemo.running), false, 'context loss stops processing and offers recovery');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const touch = await mobile.newPage();
  const mobileErrors = [];
  touch.on('pageerror', error => mobileErrors.push(error.message));
  await touch.goto(`${server.baseURL}/3d/?test`);
  await touch.waitForSelector('#voxel-canvas[data-ready="true"]', { timeout: 60000 });
  await touch.locator('#enter').tap();
  await touch.waitForFunction(() => window.__voxelDemo.stats()[0] > 2);
  assert.equal(await touch.locator('#touch-controls').isVisible(), true);
  await touch.locator('[data-tool="1"]').tap();
  assert.equal(await touch.locator('#touch-use').textContent(), 'POUR');
  const initialSand = await touch.evaluate(() => window.__voxelDemo.stats()[4]);
  // Hold and cancel a touch using DOM pointer events; cancellation must release input.
  const client = await mobile.newCDPSession(touch);
  const useBounds = await touch.locator('#touch-use').boundingBox();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: useBounds.x + useBounds.width / 2, y: useBounds.y + useBounds.height / 2 }] });
  await touch.waitForTimeout(300);
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.ok((await touch.evaluate(() => window.__voxelDemo.stats()))[4] > initialSand, 'touch tool pours sand');
  await touch.waitForTimeout(100);
  const stoppedSand = await touch.evaluate(() => window.__voxelDemo.stats()[4]);
  await touch.waitForTimeout(250);
  assert.equal(await touch.evaluate(() => window.__voxelDemo.stats()[4]), stoppedSand, 'cancel releases the tool');
  await touch.locator('[data-tool="5"]').tap();
  const waterBefore=await touch.evaluate(()=>window.__voxelDemo.count(8));
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:useBounds.x+useBounds.width/2,y:useBounds.y+useBounds.height/2}]});
  await touch.waitForTimeout(250);await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  assert.ok(await touch.evaluate(()=>window.__voxelDemo.count(8))>waterBefore,'touch controls pour water');
  assert.equal(await touch.locator('[data-tool]').count(),9,'all material tools are available on mobile');
  await touch.screenshot({ path: resolve(artifacts, 'mobile-quarry.png') });
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile controls fit');
  await touch.locator('#menu').tap();
  assert.equal(await touch.evaluate(() => window.__voxelDemo.running), false);
  assert.deepEqual(mobileErrors, []);
  await mobile.close();
  console.log(`3D browser checks passed. Screenshots: ${artifacts}`);
} finally { await browser?.close(); server.close(); }
