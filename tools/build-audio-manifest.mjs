// Rebuilds audio/manifest.json from the mp3 files on disk:
//   audio/<voice>/<lineKey>.mp3              -> manifest["<voice>"] = [lineKey, ...]
//   audio/names/<template>/<name-slug>.mp3   -> manifest.names["<template>"] = [slug, ...]
// Run after adding or removing clips:  node tools/build-audio-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(process.cwd(), 'audio');
const mp3s = dir => fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp3')).map(f => f.slice(0, -4)).sort();
const dirs = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

const manifest = {};
for (const voice of dirs(root)) {
  if (voice === 'names') continue;
  if (voice === 'villains') {   // audio/villains/<villain id>/<key>.mp3  ->  manifest["villains/<villain id>"]
    for (const v of dirs(path.join(root, voice))) { const keys = mp3s(path.join(root, voice, v)); if (keys.length) manifest['villains/' + v] = keys; }
    continue;
  }
  const keys = mp3s(path.join(root, voice));
  if (keys.length) manifest[voice] = keys;
}
const namesDir = path.join(root, 'names');
if (fs.existsSync(namesDir)) {
  const names = {};
  for (const tpl of dirs(namesDir)) {
    const slugs = mp3s(path.join(namesDir, tpl));
    if (slugs.length) names[tpl] = slugs;
  }
  if (Object.keys(names).length) manifest.names = names;
}
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
for (const [v, k] of Object.entries(manifest)) {
  if (v === 'names') for (const [t, s] of Object.entries(k)) console.log(`names/${t}: ${s.length} clips`);
  else console.log(`${v}: ${k.length} clips`);
}
if (!Object.keys(manifest).length) console.log('no clips found');
