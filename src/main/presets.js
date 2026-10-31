'use strict';
const profiles = require('./profiles');
const versions = require('./versions');
const modrinth = require('./modrinth');
const content = require('./content');

const FAST = { graphicsMode: 0, fancyGraphics: 'false', particles: 2, biomeBlendRadius: 1 };

const PRESETS = [
  { id: 'performance', name: 'Performance', blurb: 'Sodium, Lithium and friends for a smooth, stable framerate without changing how the game looks.', glyph: 'zap', color: '#6fa3e0', loader: 'fabric',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'memoryleakfix'], jvm: 'balanced', mem: [3072, 1024], options: { ...FAST, renderDistance: 10, simulationDistance: 8, entityDistanceScaling: 0.75, maxFps: 144 } },
  { id: 'maxfps', name: 'Max FPS', blurb: 'Everything in Performance plus culling and render tweaks, tuned for the highest framerate.', glyph: 'gauge', color: '#d4b04a', loader: 'fabric',
    mods: ['fabric-api', 'sodium', 'sodium-extra', 'reeses-sodium-options', 'lithium', 'ferrite-core', 'entityculling', 'moreculling', 'immediatelyfast', 'modernfix', 'dynamic-fps', 'badoptimizations'], jvm: 'balanced', mem: [3072, 1024], options: { ...FAST, renderDistance: 8, simulationDistance: 6, entityDistanceScaling: 0.5, mipmapLevels: 2, maxFps: 260 } },
  { id: 'shaders', name: 'Shaders', blurb: 'Iris with Sodium, ready for shader packs. Install packs from the Shaders tab.', glyph: 'sparkles', color: '#9b86e6', loader: 'fabric',
    mods: ['fabric-api', 'sodium', 'iris', 'reeses-sodium-options', 'sodium-extra', 'lithium', 'ferrite-core', 'immediatelyfast'], jvm: 'balanced', mem: [6144, 2048], options: { renderDistance: 12, maxFps: 120 } },
  { id: 'qol', name: 'Quality of life', blurb: 'Minimap, world map, tooltips and inventory helpers on top of a light optimization base.', glyph: 'wrench', color: '#46b39b', loader: 'fabric',
    mods: ['fabric-api', 'sodium', 'lithium', 'modmenu', 'appleskin', 'xaeros-minimap', 'xaeros-world-map', 'jade', 'mouse-tweaks'], jvm: 'balanced', mem: [4096, 1024], options: {} },
  { id: 'lowend', name: 'Low-end PC', blurb: 'Small memory footprint and short render distance for older laptops and 4 GB machines.', glyph: 'hard-drive', color: '#8a95a3', loader: 'fabric',
    mods: ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'modernfix', 'memoryleakfix'], jvm: 'lowmem', mem: [2048, 512], options: { ...FAST, renderDistance: 5, simulationDistance: 5, entityDistanceScaling: 0.5, mipmapLevels: 0, biomeBlendRadius: 0, maxFps: 60 } },
  { id: 'forge-opt', name: 'Forge optimized', blurb: 'Embeddium, FerriteCore and ModernFix for modded Forge play.', glyph: 'flame', color: '#cf8a4b', loader: 'forge',
    mods: ['embeddium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast', 'memoryleakfix'], jvm: 'balanced', mem: [4096, 1024], options: { ...FAST, renderDistance: 10 } },
  { id: 'neoforge-opt', name: 'NeoForge optimized', blurb: 'Sodium, Lithium and ModernFix on NeoForge.', glyph: 'rocket', color: '#d45b72', loader: 'neoforge',
    mods: ['sodium', 'lithium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast', 'memoryleakfix'], jvm: 'balanced', mem: [4096, 1024], options: { ...FAST, renderDistance: 10 } },
  { id: 'pvp18', name: 'PvP 1.8.9', blurb: 'Vanilla 1.8.9 on Java 8 with fast graphics and a high framerate cap.', glyph: 'swords', color: '#d45b72', loader: 'vanilla', mc: '1.8.9',
    mods: [], jvm: 'balanced', mem: [2048, 512], options: { fancyGraphics: 'false', particles: 2, renderDistance: 8, maxFps: 260 } },
  { id: 'vanilla', name: 'Clean vanilla', blurb: 'Latest release with no mods and default settings.', glyph: 'box', color: '#8a95a3', loader: 'vanilla',
    mods: [], jvm: 'default', mem: [4096, 512], options: {} },
];

function list() { return PRESETS.map(({ mods, options, ...p }) => ({ ...p, modCount: mods.length })); }

async function newestSupported(loader) {
  const [m, supported] = await Promise.all([versions.minecraft(), versions.supportedGameVersions(loader)]);
  const releases = m.versions.filter((v) => v.type === 'release');
  const hit = releases.find((v) => !supported || supported.has(v.id));
  return hit ? hit.id : m.latest.release;
}

/** Create a profile from a preset and install its mods. */
async function create(id, { mcVersion, name } = {}, job) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error('Unknown preset.');
  const mc = mcVersion || p.mc || await newestSupported(p.loader);
  const profile = profiles.save({
    name: name || p.name, mcVersion: mc, loader: p.loader, icon: { glyph: p.glyph, color: p.color },
    jvmPreset: p.jvm, memory: { mode: 'custom', max: p.mem[0], min: p.mem[1] }, notes: p.blurb,
  });
  if (Object.keys(p.options).length) await content.writeOptions(profile, p.options);
  const warnings = [];
  let n = 0;
  for (const slug of p.mods) {
    n++;
    job.update({ stage: 'Installing mods', text: slug, total: p.mods.length, current: n - 1 });
    try { await modrinth.install(profile, { projectId: slug, type: 'mod', deps: true }, job); } catch (e) {
      if (job.signal.aborted) throw e;
      warnings.push(`${slug}: ${e.message}`);
    }
  }
  job.update({ stage: 'Installing mods', total: p.mods.length, current: p.mods.length });
  return { profile, warnings };
}

module.exports = { list, create };
