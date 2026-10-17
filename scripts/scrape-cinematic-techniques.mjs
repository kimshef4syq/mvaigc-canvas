// 从 melies.co 抓取「电影技法」内容，产出随包提交的 JSON + 本地缩略图/静图。
// 运行：node scripts/scrape-cinematic-techniques.mjs
// 测试：LIMIT=5 node scripts/scrape-cinematic-techniques.mjs
//
// 站点无 JSON/API（Nuxt SSR），故从 HTML 抽取。
// 缩略图/静图下载到 public/cinematic-techniques/ 本地（进入即显示，不依赖外部 CDN）；
// 视频仍走 melies CDN 直链（仅在悬停时单个加载）。

import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INDEX_URL = 'https://melies.co/cinematic-techniques';
const ORIGIN = 'https://melies.co';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(
  PROJECT_ROOT,
  'src/features/cinematicTechniques/bundledCinematicTechniques.json'
);
// Vite 公共目录：本地图片放这里，运行时用绝对路径 /cinematic-techniques/... 引用。
const PUBLIC_IMAGE_DIR = path.join(PROJECT_ROOT, 'public/cinematic-techniques');
const PUBLIC_IMAGE_PREFIX = '/cinematic-techniques';
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const IMAGE_CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY || 12);

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; OpenStoryboardCanvas/1.0)' };

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(url) {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/\//, '')}`;
}

function extensionOf(url) {
  const match = new URL(normalizeUrl(url)).pathname.match(/\.(webp|jpe?g|png|gif)$/i);
  return match ? match[1].toLowerCase() : 'webp';
}

// 下载一张图到 public/，返回运行时可用的绝对路径（如 /cinematic-techniques/lighting/key-light-poster.webp）。
async function downloadImage(categoryId, slug, role, url) {
  const ext = extensionOf(url);
  const fileName = `${slug}-${role}.${ext}`;
  const localPath = path.join(PUBLIC_IMAGE_DIR, categoryId, fileName);
  const publicPath = `${PUBLIC_IMAGE_PREFIX}/${categoryId}/${fileName}`;

  if (await exists(localPath)) {
    return publicPath;
  }

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(normalizeUrl(url), { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, buffer);
      return publicPath;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  console.warn(`  图片下载失败: ${url} -> ${lastError?.message}`);
  return null;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseIndex(html) {
  const chunks = html.split(/<h2 class="cinematic-section__heading"/).slice(1);
  const categories = [];

  for (const chunk of chunks) {
    const head = chunk.match(
      /<a href="\/cinematic-techniques\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>/
    );
    if (!head) continue;
    const categorySlug = head[1];
    const categoryName = stripTags(head[2]);

    const tileRe =
      /<a href="\/cinematic-techniques\/[a-z0-9-]+\/([a-z0-9-]+)" class="cinematic-tile"[\s\S]*?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;
    const items = [];
    for (const match of chunk.matchAll(tileRe)) {
      items.push({
        slug: match[1],
        poster: normalizeUrl(match[2]),
        name: decodeEntities(match[3]).trim(),
      });
    }
    if (items.length > 0) {
      categories.push({ id: categorySlug, name: categoryName, items });
    }
  }

  return categories;
}

// 只取「本技法自己」的视频：class 含 cinematic-shot__video（技法预览）或 melies-video-player__media（hero）。
// 页面里还会出现其它 <video>（相关推荐/导航轮播），取第一个会配错——必须靠 class 区分。
function extractOwnVideo(html) {
  for (const match of html.matchAll(/<video\b[^>]*>/g)) {
    const tag = match[0];
    const className = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    if (/cinematic-shot__video|melies-video-player__media/.test(className)) {
      const src = (tag.match(/src="([^"]+)"/) || [])[1];
      if (src) return normalizeUrl(src);
    }
  }
  return null;
}

function parseDetail(html, slug) {
  const video = extractOwnVideo(html);

  // 「Prompt it」技法提示词 = 该标题后紧跟的第一个 <p>（无专属 class）。
  let prompt = null;
  const promptAnchor = html.indexOf('Prompt it');
  if (promptAnchor !== -1) {
    const after = html.slice(promptAnchor);
    const match = after.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (match) prompt = stripTags(match[1]);
  }

  const term = html.match(/"@type":\s*"DefinedTerm",\s*"name":\s*"([^"]*)",\s*"description":\s*"([^"]*)"/);
  const definition = term ? decodeEntities(term[2]).trim() : null;

  // 部分技法（灯光/类型/氛围类）无视频，站点用静帧代替——卡片统一用缩略图 poster，故不再单独取 still。

  return { video, prompt, definition };
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function main() {
  console.log(`抓取索引页: ${INDEX_URL}`);
  const indexHtml = await getText(INDEX_URL);
  const categories = parseIndex(indexHtml);
  const totalItems = categories.reduce((sum, category) => sum + category.items.length, 0);
  console.log(`分类 ${categories.length} 个，条目 ${totalItems} 条`);

  const flat = [];
  for (const category of categories) {
    for (const item of category.items) {
      flat.push({ categoryId: category.id, ...item });
    }
  }
  const targets = LIMIT > 0 ? flat.slice(0, LIMIT) : flat;

  let done = 0;
  const tasks = targets.map((item) => async () => {
    const url = `${ORIGIN}/cinematic-techniques/${item.categoryId}/${item.slug}`;
    try {
      const detailHtml = await getText(url);
      const detail = parseDetail(detailHtml, item.slug);
      done += 1;
      if (done % 25 === 0 || done === targets.length) {
        console.log(`  ${done}/${targets.length}`);
      }
      return { ...item, ...detail };
    } catch (error) {
      console.warn(`  失败: ${url} -> ${error.message}`);
      return { ...item, video: null, prompt: null, definition: null };
    }
  });

  const enriched = await runPool(tasks, CONCURRENCY);

  // 只下载缩略图（.webp，每张约 7KB）到本地 public/，JSON 存本地路径。
  // 静帧 hero.jpg 是高清原图（每张数百 KB），卡片用缩略图即可，故不下载——无视频的条目也用其缩略图。
  let imageDone = 0;
  const imageTasks = enriched.map((entry) => async () => {
    const localPoster = entry.poster
      ? await downloadImage(entry.categoryId, entry.slug, 'poster', entry.poster)
      : null;
    imageDone += 1;
    if (imageDone % 50 === 0 || imageDone === enriched.length) {
      console.log(`  图片 ${imageDone}/${enriched.length}`);
    }
    return {
      ...entry,
      poster: localPoster ?? entry.poster,
    };
  });
  const withImages = await runPool(imageTasks, IMAGE_CONCURRENCY);

  const byCategory = new Map(categories.map((category) => [category.id, []]));
  for (const entry of withImages) {
    byCategory.get(entry.categoryId).push({
      id: `${entry.categoryId}/${entry.slug}`,
      slug: entry.slug,
      name: entry.name,
      poster: entry.poster,
      video: entry.video,
      prompt: entry.prompt,
      definition: entry.definition,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: INDEX_URL,
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      items: byCategory.get(category.id),
    })),
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const missingPrompt = withImages.filter((entry) => !entry.prompt).length;
  const remoteImages = withImages.filter((entry) => entry.poster.startsWith('http')).length;
  console.log(`写入 ${OUT_FILE}`);
  console.log(`缺失提示词 ${missingPrompt} 条，仍指向远程的 poster ${remoteImages} 条`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
