// Keep the composition ids fixed while making authored DOM ids usable in Studio.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
const directory = fileURLToPath(new URL('../compositions/frames', import.meta.url));
for (const name of readdirSync(directory).filter(file => file.endsWith('.html'))) {
  const slug = basename(name, '.html');
  const file = join(directory, name);
  let source = readFileSync(file, 'utf8');
  if (!/^\s*<template[\s>]/.test(source) || !/<\/template>\s*$/.test(source)) throw new Error(`Not a bare template: ${name}`);
  source = source.replace(new RegExp(`(?<![\\w-])${slug}-`, 'g'), `f${slug}-`);
  let clip = 0;
  source = source.replace(/<([a-z][a-z0-9-]*)([^<>]*\bclass\s*=\s*["'][^"']*\bclip\b[^"']*["'][^<>]*)>/gi, (tag, element, attributes) => {
    clip++;
    if (!/\bdata-start\s*=/.test(attributes) || !/\bdata-duration\s*=/.test(attributes)) throw new Error(`Untimed clip: ${name}`);
    return /\bid\s*=/.test(attributes) ? tag : `<${element} id="f${slug}-clip-${clip}"${attributes}>`;
  });
  for (const asset of source.matchAll(/(?:src=|url\()\s*["'](assets\/[\w./-]+)["']/g)) {
    if (!existsSync(fileURLToPath(new URL(`../${asset[1]}`, import.meta.url)))) throw new Error(`Missing asset ${asset[1]}`);
  }
  writeFileSync(file, source, 'utf8');
  console.log(`${name}: bare template, ${clip} timed clips, staged assets present`);
}
