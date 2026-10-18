#!/usr/bin/env bash
set -e

SOURCE_DIR="/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/classified"
SOURCE_PDF="/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/MiniMax-Design全流程架构与提示词资产手册.pdf"
SOURCE_MD="/Users/spic007/Downloads/07-项目文件/minimax-design-prompts-extracted/MiniMax-Design全流程架构与提示词资产手册.md"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$PROJECT_ROOT/resources/agent-profiles"
MANIFEST_DIR="$PROJECT_ROOT/src/generated"
MANIFEST_FILE="$MANIFEST_DIR/profiles-manifest.json"

echo "=========================================================="
echo "🚀 开始将 MiniMax Design 202 篇规约资产同步至 mvaigc-canvas"
echo "=========================================================="

# 1. 创建目标目录
mkdir -p "$TARGET_DIR"
mkdir -p "$MANIFEST_DIR"

# 2. 增量同步分类文件
echo "📦 正在同步 12 个分类目录文件..."
rsync -av --delete "$SOURCE_DIR/" "$TARGET_DIR/"

# 3. 复制白皮书总册参考
if [ -f "$SOURCE_PDF" ]; then
  cp "$SOURCE_PDF" "$PROJECT_ROOT/docs/"
  echo "📄 已同步完整版 PDF 技术手册到 docs/MiniMax-Design全流程架构与提示词资产手册.pdf"
fi

# 4. 生成 profiles-manifest.json 索引文件
echo "🔍 正在扫描并生成结构化索引 manifest..."
node -e "
const fs = require('fs');
const path = require('path');

const baseDir = '$TARGET_DIR';
const manifestFile = '$MANIFEST_FILE';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(walk(full));
    } else if (item.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      results.push({
        id: path.relative(baseDir, full).replace(/\.md$/, ''),
        name: titleMatch ? titleMatch[1].trim() : item.name.replace(/\.md$/, ''),
        category: path.relative(baseDir, path.dirname(full)) || 'root',
        relativePath: path.relative(baseDir, full),
        sizeBytes: content.length
      });
    }
  }
  return results;
}

const manifest = walk(baseDir);
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log('✅ 已生成 profiles-manifest.json，包含', manifest.length, '个规约实体');
"

echo "=========================================================="
echo "🎉 资产同步与索引完成！"
echo "目标路径: $TARGET_DIR"
echo "索引清单: $MANIFEST_FILE"
echo "=========================================================="
