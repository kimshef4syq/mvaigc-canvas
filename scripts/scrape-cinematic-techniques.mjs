// 从 melies.co 抓取「电影技法」内容，产出随包提交的 JSON。
// 运行：node scripts/scrape-cinematic-techniques.mjs
// 测试：LIMIT=5 node scripts/scrape-cinematic-techniques.mjs
//
// 站点无 JSON/API（Nuxt SSR），故从 HTML 抽取。运行时不再抓取，视频/缩略图走直链。

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INDEX_URL = 'https://melies.co/cinematic-techniques';
const ORIGIN = 'https://melies.co';
const OUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/features/cinematicTechniques/bundledCinematicTechniques.json'
);
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenStoryboardCanvas/1.0)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
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
        poster: match[2],
        name: decodeEntities(match[3]).trim(),
      });
    }
    if (items.length > 0) {
      categories.push({ id: categorySlug, name: categoryName, items });
    }
  }

  return categories;
}

function parseDetail(html, slug) {
  const video = (html.match(/<video[^>]*src="([^"]+\.mp4)"/) || [])[1] || null;

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

  // 部分技法（灯光/类型/氛围类）无视频，站点用静帧代替。
  const still = (html.match(/asset\.melies\.co\/cinematic-techniques\/still\/[^"']+\.(?:jpg|jpeg|png|webp)/) || [])[0] || null;

  return { video, still, prompt, definition };
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
      return { ...item, video: null, still: null, prompt: null, definition: null };
    }
  });

  const enriched = await runPool(tasks, CONCURRENCY);

  const byCategory = new Map(categories.map((category) => [category.id, []]));
  for (const entry of enriched) {
    byCategory.get(entry.categoryId).push({
      id: `${entry.categoryId}/${entry.slug}`,
      slug: entry.slug,
      name: entry.name,
      poster: entry.poster,
      video: entry.video,
      still: entry.still,
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
  const missingPrompt = enriched.filter((entry) => !entry.prompt).length;
  const missingMedia = enriched.filter((entry) => !entry.video && !entry.still).length;
  console.log(`写入 ${OUT_FILE}`);
  console.log(`缺失提示词 ${missingPrompt} 条，无视频且无静图 ${missingMedia} 条`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
