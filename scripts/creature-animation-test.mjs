import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import art from '../src/sand/content/creatureArt.js';
import { attackAnimation, creaturePreviewClip } from '../src/sand/content/creatureAnimations.js';

// Exercise the actual C++ controller without a browser or a second implementation.
const dir = mkdtempSync(join(tmpdir(), 'creature-animation-'));
try {
  writeFileSync(join(dir, 'test.cpp'), `
#include "${resolve('src/sand/cpp/engine/creature_animation.hpp')}"
#include <cassert>
#include <iostream>
int main() {
  ContentCreatureArt art;
  int offset = 0;
  for (auto& clip : art.clips) {
    clip.count = 4; clip.offset = offset; clip.durations = {2,2,2,2}; clip.duration = 8; offset += 4;
  }
  for (auto& attack : art.attacks) for (int phase = 0; phase < 3; phase++) attack[phase] = {CC_WINDUP + phase,0,4,false};
  CreatureAnimationController controller;
  CreatureAnimationController::Input input;
  input.id = 1; input.tick = 50; input.vx = .15;
  auto first = controller.sample(art,input);
  assert(first.clip == CC_MOVE && first.frame == art.clips[CC_MOVE].offset);
  input.tick += 2;
  auto next = controller.sample(art,input);
  assert(next.frame == first.frame + 1);
  assert(controller.sample(art,input).frame == next.frame); // repeated draw cannot advance
  input.id = 2;
  assert(controller.sample(art,input).frame == first.frame); // independent start phase
  input.id = 1; input.tick = 0;
  assert(controller.sample(art,input).frame == first.frame); // rewind resets
  input.tick = 2; input.vx = .075;
  assert(controller.sample(art,input).frame == first.frame); // half speed, half distance
  input.tick = 4;
  assert(controller.sample(art,input).frame == first.frame + 1);
  for (int tick = 5; tick < 40; tick++) {
    input.tick = tick; input.vx = tick % 2 ? .038 : 0;
    auto pose = controller.sample(art,input);
    if (tick > 23) assert(pose.clip == CC_IDLE);
  }
  input.tick = 40; input.vx = .15;
  for (; input.tick < 44; input.tick++) next = controller.sample(art,input);
  assert(next.clip == CC_MOVE);
  input.stage = CC_ATTACK; input.progress = .5; input.tick++;
  art.clips[CC_ATTACK].durations = {1,1,6,2};
  assert(controller.sample(art,input).frame == art.clips[CC_ATTACK].offset + 2);
  art.attacks[1][1] = {CC_SPECIAL,1,2,false}; input.pattern = 1; input.progress = 1;
  assert(controller.sample(art,input).frame == art.clips[CC_SPECIAL].offset + 2);
  input.hurtAge = 0;
  assert(controller.sample(art,input).clip == CC_HURT);
  input.alive = false; input.deathFrame = 3;
  assert(controller.sample(art,input).frame == art.clips[CC_DEATH].offset + 3);
  input = {}; input.id = 3; input.motion = CreatureAnimationController::FLY;
  assert(controller.sample(art,input).clip == CC_MOVE); // hovering still flaps
  input.tick = 2;
  assert(controller.sample(art,input).frame == art.clips[CC_MOVE].offset + 1);
  input = {}; input.id = 6; input.vx = (float).23; input.referenceSpeed = .23;
  controller.sample(art,input); input.tick = 2;
  assert(controller.sample(art,input).frame == art.clips[CC_MOVE].offset + 1);
  input = {}; input.id = 4; input.motion = CreatureAnimationController::SWIM; input.vy = .2;
  assert(controller.sample(art,input).clip == CC_SWIM); // vertical swimming
  const auto swimStart = controller.sample(art,input); input.tick = 3;
  assert(controller.sample(art,input).frame != swimStart.frame);
  input.vy = 0; input.tick = 9;
  const auto tread = controller.sample(art,input); input.tick = 11;
  assert(tread.clip == CC_SWIM && controller.sample(art,input).frame != tread.frame);
  input.stage = CC_ATTACK; input.progress = .5;
  assert(controller.sample(art,input).clip == CC_ATTACK); // reuse the attack in water
  input.hurtAge = 0;
  assert(controller.sample(art,input).clip == CC_HURT);
  input = {}; input.id = 8; input.motion = CreatureAnimationController::SWIM;
  controller.sample(art,input); input.tick = 6; input.motion = CreatureAnimationController::GROUND;
  assert(controller.sample(art,input).clip == CC_IDLE); // bank transition
  input = {}; input.id = 5; input.tick = 10;
  auto idle = controller.sample(art,input);
  input.tick = 11;
  for (int i = 0; i < 10; i++) assert(controller.sample(art,input).frame == idle.frame);
  std::cout << "PASS: local phase, speed, pause, rewind, wall settling, attack ranges, reactions, flight and swimming\\n";
}
`);
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', join(dir, 'test.cpp'), '-o', join(dir, 'test')], { stdio: 'inherit' });
  execFileSync(join(dir, 'test'), { stdio: 'inherit' });
} finally { rmSync(dir, { recursive: true, force: true }); }
for (const [key, sprite] of Object.entries(art)) for (let pattern = 0; pattern < 3; pattern++) for (const phase of ['windup','attack','recover']) {
  const range = attackAnimation(key, sprite, pattern, phase), preview = creaturePreviewClip(key, sprite, phase, pattern);
  assert.equal(preview.frames.length, range.count);
  assert.ok(range.start >= 0 && range.start + range.count <= sprite.clips[range.clip].frames.length);
}
assert.equal(attackAnimation('FROST_GIANT',art.FROST_GIANT,0,'attack').clip,'special');
assert.equal(attackAnimation('FROST_GIANT',art.FROST_GIANT,2,'recover').start,6);
console.log('PASS: attack mappings and viewer ranges for all 30 creature appearances');
