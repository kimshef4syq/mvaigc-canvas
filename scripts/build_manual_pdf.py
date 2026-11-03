#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate comprehensive mvaigc Canvas user operation manual (HTML, Markdown & PDF).
Updated to feature:
- mvaigc 融媒视界 (mvaigc.cn) full integration
- In-depth introduction to the Infinite Visual Canvas
- Removed legacy external vendors (KIE, PPIO, fal.ai, GRSAI)
"""

import os
import subprocess
import base64
import sys

def get_base64_icon(svg_path):
    if os.path.exists(svg_path):
        with open(svg_path, 'rb') as f:
            return "data:image/svg+xml;base64," + base64.b64encode(f.read()).decode('utf-8')
    return ""

def generate_manual_html():
    svg_icon_path = os.path.abspath("docs/brand/mvaigc-canvas-icon.svg")
    icon_data_url = get_base64_icon(svg_icon_path)

    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>mvaigc 桌面画布 — 用户操作手册</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 16mm 15mm 16mm 15mm;
  }}

  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  body {{
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
    color: #1e293b;
    line-height: 1.6;
    font-size: 9.8pt;
    margin: 0;
    padding: 0;
  }}

  .page-break {{
    page-break-before: always;
    break-before: page;
  }}

  .avoid-break {{
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  h1, h2, h3 {{
    page-break-after: avoid;
    break-after: avoid;
  }}

  /* Cover Page */
  .cover-container {{
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 245mm;
    padding: 15mm 10mm 10mm 10mm;
    text-align: center;
  }}

  .cover-header {{
    margin-top: 10mm;
  }}

  .cover-logo {{
    width: 90px;
    height: 90px;
    margin: 0 auto 18px auto;
    display: block;
    border-radius: 20px;
    box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.4);
  }}

  .cover-title {{
    font-size: 30pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.5px;
    margin: 0 0 10px 0;
  }}

  .cover-subtitle {{
    font-size: 14pt;
    font-weight: 500;
    color: #2563eb;
    margin: 0 0 20px 0;
    line-height: 1.4;
  }}

  .cover-desc {{
    font-size: 10.5pt;
    color: #64748b;
    max-width: 530px;
    margin: 0 auto 30px auto;
    line-height: 1.6;
  }}

  .cover-badges {{
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-bottom: 30px;
  }}

  .cover-badge {{
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 9pt;
    font-weight: 500;
  }}

  .cover-footer {{
    border-top: 1px solid #e2e8f0;
    padding-top: 15px;
    font-size: 8.5pt;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
  }}

  /* Typography */
  h1 {{
    font-size: 15pt;
    font-weight: 700;
    color: #0f172a;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 5px;
    margin-top: 20px;
    margin-bottom: 10px;
  }}

  h2 {{
    font-size: 11.5pt;
    font-weight: 600;
    color: #1e3a8a;
    margin-top: 14px;
    margin-bottom: 6px;
    padding-left: 8px;
    border-left: 3.5px solid #3b82f6;
  }}

  h3 {{
    font-size: 10pt;
    font-weight: 600;
    color: #334155;
    margin-top: 10px;
    margin-bottom: 4px;
  }}

  p {{
    margin: 0 0 8px 0;
    color: #334155;
    text-align: justify;
  }}

  ul, ol {{
    margin: 0 0 8px 0;
    padding-left: 20px;
    color: #334155;
  }}

  li {{
    margin-bottom: 3px;
  }}

  strong {{
    color: #0f172a;
  }}

  /* Callouts */
  .callout {{
    border-radius: 6px;
    padding: 8px 12px;
    margin: 9px 0;
    font-size: 8.8pt;
    line-height: 1.5;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .callout-info {{
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    color: #1e40af;
  }}

  .callout-tip {{
    background: #ecfdf5;
    border-left: 4px solid #10b981;
    color: #065f46;
  }}

  .callout-warn {{
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    color: #92400e;
  }}

  .callout-title {{
    font-weight: 700;
    margin-bottom: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
  }}

  /* Tables */
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 12px 0;
    font-size: 8.8pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  th, td {{
    border: 1px solid #cbd5e1;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }}

  th {{
    background-color: #f1f5f9;
    color: #0f172a;
    font-weight: 600;
  }}

  tr:nth-child(even) td {{
    background-color: #f8fafc;
  }}

  /* Cards & Grids */
  .grid-2 {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
    margin: 8px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .grid-3 {{
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 7px;
    margin: 8px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .card {{
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    padding: 9px 11px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .card-title {{
    font-weight: 600;
    font-size: 9.5pt;
    color: #1e3a8a;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }}

  .card-desc {{
    font-size: 8.4pt;
    color: #64748b;
    line-height: 1.4;
  }}

  /* Steps Workflow */
  .step-flow {{
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin: 9px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .step-box {{
    flex: 1;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 8px;
    position: relative;
  }}

  .step-number {{
    display: inline-block;
    width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    background: #2563eb;
    color: white;
    font-weight: bold;
    border-radius: 50%;
    font-size: 8pt;
    margin-right: 5px;
  }}

  .step-title {{
    font-weight: 600;
    font-size: 8.8pt;
    color: #0f172a;
    margin-bottom: 3px;
  }}

  .step-text {{
    font-size: 8pt;
    color: #475569;
    line-height: 1.35;
  }}

  /* Keyboard keys */
  kbd {{
    display: inline-block;
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 7.8pt;
    font-weight: 600;
    line-height: 1.2;
    color: #1e293b;
    background-color: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 3px;
    box-shadow: 0 1px 1px rgba(0,0,0,0.1);
  }}

  /* Table of Contents */
  .toc {{
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 14px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }}

  .toc-title {{
    font-size: 11.5pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 8px;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 5px;
  }}

  .toc-list {{
    columns: 2;
    column-gap: 20px;
    list-style: none;
    padding: 0;
    margin: 0;
  }}

  .toc-item {{
    font-size: 8.8pt;
    line-height: 1.7;
    color: #334155;
    break-inside: avoid;
  }}

  .toc-number {{
    color: #2563eb;
    font-weight: 600;
    margin-right: 5px;
  }}
</style>
</head>
<body>

<!-- 封面 -->
<div class="cover-container">
  <div class="cover-header">
    <img src="{icon_data_url}" alt="mvaigc 徽标" class="cover-logo" />
    <div class="cover-title">mvaigc 桌面画布</div>
    <div class="cover-subtitle">全流程 AI 影视 / 视频 / 分镜创作桌面操作手册</div>
    <div class="cover-desc">
      融媒视界 (mvaigc.cn) 官方出品。面向影视动画与视听创作者的本地可视化节点画布。集成原生模型中枢、3D 高斯泼溅 (3DGS)、导演台 3D 预演与具身 Agent 创作生态。
    </div>
    <div class="cover-badges">
      <span class="cover-badge">🎨 无限可视创作画布</span>
      <span class="cover-badge">⚡ mvaigc 融媒视界模型中枢</span>
      <span class="cover-badge">🎬 3D 导演预演台</span>
      <span class="cover-badge">🧊 3D 高斯泼溅 (3DGS)</span>
      <span class="cover-badge">🤖 画布 Agent 协同</span>
      <span class="cover-badge">🔒 本地安全与免泄露</span>
    </div>
  </div>

  <div class="cover-footer">
    <span>软件版本：v2.0 (macOS / Windows 桌面通用版)</span>
    <span>编制单位：mvaigc 融媒视界</span>
    <span>状态：生产交付版</span>
  </div>
</div>

<div class="page-break"></div>

<!-- 目录 -->
<div class="toc">
  <div class="toc-title">📖 操作手册目录导航</div>
  <div class="toc-list">
    <div class="toc-item"><span class="toc-number">01</span> 软件定位与核心架构特性</div>
    <div class="toc-item"><span class="toc-number">02</span> 3分钟快速上手与首个工程</div>
    <div class="toc-item"><span class="toc-number">03</span> 无限可视创作画布深度解析</div>
    <div class="toc-item"><span class="toc-number">04</span> 模型中枢：mvaigc 融媒视界</div>
    <div class="toc-item"><span class="toc-number">05</span> 核心节点全解析与创作工作流</div>
    <div class="toc-item"><span class="toc-number">06</span> 3D 高斯泼溅 (3DGS) 深度工作流</div>
    <div class="toc-item"><span class="toc-number">07</span> 导演台与 3D 预演动画系统</div>
    <div class="toc-item"><span class="toc-number">08</span> 画布智能助理 (Canvas Agent)</div>
    <div class="toc-item"><span class="toc-number">09</span> 提示词库、影视语典与批量导入</div>
    <div class="toc-item"><span class="toc-number">10</span> 工程持久化、迁移与安全备份</div>
    <div class="toc-item"><span class="toc-number">11</span> 故障排查 (FAQ) 与快捷键总表</div>
  </div>
</div>

<!-- 第 1 章 -->
<div>
  <h1>01. 软件定位与核心架构特性</h1>
  <p>
    <strong>mvaigc 桌面画布</strong>（基于 Open Storyboard Canvas 深度演进二次开发，由<strong>融媒视界</strong>联合打造）是一套专为影视编导、分镜师、动画团队与数字创作者量身定制的本地可视化创作工作流工具。不同于传统单次单向的网页生成器，mvaigc 桌面画布把创作者所有的参考素材、灵感草图、3D 空间预演、镜头走位、多格分镜与视频成片编织在同一张<strong>无限扩展的可视化节点画布</strong>中。
  </p>

  <div class="grid-3">
    <div class="card">
      <div class="card-title">🌐 融媒视界官方服务</div>
      <div class="card-desc">内置 mvaigc 专属反向代理，账号密码一键打通全线顶级文生图、图生视频模型。</div>
    </div>
    <div class="card">
      <div class="card-title">🔗 连续可溯的节点图</div>
      <div class="card-desc">任何下游视频或衍生图均可溯源至原始母本素材与参数，支持分支创作与多级派生。</div>
    </div>
    <div class="card">
      <div class="card-title">🔒 本地安全与私密</div>
      <div class="card-desc">工程数据全部持久化存储在本机 SQLite 中，无需担心创作资产泄露或商业凭据丢失。</div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-title">💡 为什么采用本地桌面节点架构？</div>
    影视制作是复杂的系统工程，极度依赖“角色面容一致性、美术风格连续性与镜头运动可控性”。节点网状架构允许创作者将单张角色设定图连线至数个分镜与生视频节点，实现跨镜头资产的高效复用。
  </div>
</div>

<!-- 第 2 章 -->
<div>
  <h1>02. 3分钟快速上手与首个工程</h1>
  <p>首次运行软件，仅需完成以下 3 步即可跑通“文生图 → 图生视频”完整创作链路：</p>

  <div class="step-flow">
    <div class="step-box">
      <div class="step-title"><span class="step-number">1</span>新建工程</div>
      <div class="step-text">在主页「画布工程」标签页中点击「新建工程」，输入工程名称（如：科幻短片01），进入工作画布。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">2</span>登录融媒视界</div>
      <div class="step-text">点击右上角设置图标 ⚙️，进入「融媒视界 mvaigc」，填入账号密码并保存，系统将一键自动装配全部模型！</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">3</span>建点并生成</div>
      <div class="step-text">左侧栏点击「生图」生成节点，输入提示词与画面比例，生成后直接连线至「生视频」节点完成动态演绎！</div>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-title">🎯 快捷小技巧</div>
    如果您拥有本地或远程 ComfyUI 实例，在设置中开启「ComfyUI 连接」，无需购买云端额度即可直接调用本地显卡算力出图与生视频！
  </div>
</div>

<div class="page-break"></div>

<!-- 第 3 章：无限可视创作画布深度解析 -->
<div>
  <h1>03. 无限可视创作画布深度解析</h1>
  <p>
    <strong>画布 (Canvas)</strong> 是 mvaigc 的绝对核心。它不仅是一个绘图板，更是一套集成了<strong>视口漫游、拓扑连线、跨节点引用与多选排版</strong>的非线性视听生产系统。
  </p>

  <h2>3.1 画布的核心价值与创作范式</h2>
  <p>
    传统 AI 聊天窗口只能以单一时间流展示成果，历史记录繁杂难找，不同镜头的角色和机位彼此割裂。而在 mvaigc 画布中：
  </p>
  <ul>
    <li><strong>全景总览全局视角：</strong>全片所有分镜、垫图与生成结果在二维平面一览无余，镜头节奏与色调一目了然；</li>
    <li><strong>非线性分支创作：</strong>以一张主角概念图为中心，可分叉延伸出白天场景、雨夜场景、战斗场景等多条独立支线；</li>
    <li><strong>参数与素材沿袭：</strong>上游节点的图片或提示词改动，下游连线节点可瞬间无缝继承，大幅降低重复配置时间。</li>
  </ul>

  <h2>3.2 视口空间与漫游导航系统</h2>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">🕹️ 平移漫游方式</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><strong>鼠标中键 / 右键拖拽：</strong>按住中键或右键即可在画布上无极自由平移。</li>
        <li><strong>空格键协同：</strong>按住 <kbd>Space</kbd> + 鼠标左键拖拽平移，符合专业影视剪辑软件手感。</li>
        <li><strong>WASD 键盘漫游：</strong>专为 3D/游戏用户定制，在画布获得焦点时，按 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 快速平移。</li>
      </ul>
    </div>
    <div class="card">
      <div class="card-title">🔍 缩放与视口控制</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><strong>鼠标滚轮缩放：</strong>以鼠标指针所在位置为中心，实现亚像素平滑无级缩放。</li>
        <li><strong>自适应居中 (Fit View)：</strong>点击顶部浮动栏「自适应」按钮，一键纵览全部节点。</li>
        <li><strong>画布锁定保护：</strong>点击顶部「锁头」图标，冻结画布移动与节点位置，防止误拖拽。</li>
      </ul>
    </div>
  </div>

  <h2>3.3 节点拓扑、交互连线与跨节点 `@` 语法</h2>
  <p>
    节点之间通过<strong>数据端口 (Handles)</strong> 建立父子依赖关系：
  </p>
  <ul>
    <li><strong>端口直观连线：</strong>节点右侧圆点为「输出端」，左侧圆点为「输入端」。从上传图片节点的输出圆点按住左键拖拽连线至生图节点的输入端，即可完成垫图绑定。</li>
    <li><strong>拖线即时建点：</strong>从任意节点的输出端口拉出连线，拖到画布空白处松开，系统会自动弹出与该素材兼容的下游节点菜单，一秒新建下游任务！</li>
    <li><strong>跨节点 `@` 联想注入：</strong>在任意生图、生视频或文本节点的提示词框中输入 <kbd>@</kbd>，即可快速检索并挂载画布中的其他图片或剧本节点作为多模态参考，无需反复复制图片。</li>
  </ul>

  <h2>3.4 多选框选与批量操作工具条</h2>
  <div class="grid-2">
    <div class="card">
      <div class="card-title">📦 框选手势与批量选中</div>
      <div class="card-desc">按住 <kbd>Shift</kbd> 键并在空白处拖动鼠标拉出虚线框，即可批量框选区域内的所有节点；或按住 <kbd>Shift</kbd> 连续单击追加单选节点。</div>
    </div>
    <div class="card">
      <div class="card-title">⚡ 批量浮动工具条</div>
      <div class="card-desc">多选节点后，画布上方自动弹出专属批量操作条，支持<strong>批量横向排开、纵向对齐、统一移动位置、批量修改生成参数与一键批量删除</strong>。</div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<!-- 第 4 章：模型中枢：mvaigc 融媒视界 -->
<div>
  <h1>04. 模型中枢：mvaigc 融媒视界</h1>
  <p>
    <strong>mvaigc 融媒视界 (mvaigc.cn)</strong> 是平台官方内置的一站式全模态 AI 算力服务中枢。彻底免除传统工具需要逐一申请 Key、频繁充值及手动调试反代路由的繁琐成本。
  </p>

  <h2>4.1 一键免配置装配机制</h2>
  <div class="step-flow">
    <div class="step-box">
      <div class="step-title"><span class="step-number">1</span>打开设置</div>
      <div class="step-text">在界面右上角点击齿轮 ⚙️ 打开系统设置面板，切换到「融媒视界 mvaigc」菜单项。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">2</span>填写账号密码</div>
      <div class="step-text">输入您的 mvaigc 账号与密码（本地端口可选，默认 19000），点击「保存」。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">3</span>自动装配完成</div>
      <div class="step-text">底层自动启动安全代理服务，全线图片与视频模型库即刻激活，节点下拉菜单自动刷新！</div>
    </div>
  </div>

  <h2>4.2 豪华多模态模型矩阵一览</h2>
  <p>融媒视界服务整合了当前 AI 图像与视频生成领域的顶级商业模型，按品牌梯队提供全方位选择：</p>

  <table>
    <thead>
      <tr>
        <th style="width:20%;">模型分类</th>
        <th style="width:25%;">涵盖品牌与系列</th>
        <th style="width:30%;">代表模型名称</th>
        <th style="width:25%;">核心能力与规格</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td rowspan="4"><strong>AI 生图模型矩阵</strong></td>
        <td><strong>GPT 品牌</strong></td>
        <td>GPT-Image-2.5-Pro / Fast / GPT-Image-2</td>
        <td>超强构图理解，1K/2K/4K 分辨率，多画幅比</td>
      </tr>
      <tr>
        <td><strong>Nano-Banana 品牌</strong></td>
        <td>Nano-Banana-2.1 / 2 / Nano-Banana-Pro</td>
        <td>极速渲染出图，电影质感与写实细节卓越</td>
      </tr>
      <tr>
        <td><strong>Seedream 品牌</strong></td>
        <td>Seedream-5.0-Pro (豆包)</td>
        <td>人像美学细腻，二次元与国风氛围感出众</td>
      </tr>
      <tr>
        <td><strong>Qwen / WAN 品牌</strong></td>
        <td>Qwen-3.0-Pro / WAN-2.7 / WAN-2.7-Pro</td>
        <td>中文语义理解精准，文字渲染与排版稳定性好</td>
      </tr>
      <tr>
        <td rowspan="6"><strong>AI 视频模型矩阵</strong></td>
        <td><strong>Seedance 品牌</strong></td>
        <td>Seedance-2.5 / Seedance-2.0 / Fast</td>
        <td>支持 4-30 秒超长连贯生成，多参考图控制强</td>
      </tr>
      <tr>
        <td><strong>WAN 品牌</strong></td>
        <td>WAN-3.0-Prime (高速版) / WAN-3.0 / HappyHorse</td>
        <td>超高运镜帧率，复杂物理碰撞与光影动态逼真</td>
      </tr>
      <tr>
        <td><strong>MiniMax 品牌</strong></td>
        <td>MiniMax-H3 (海螺视频)</td>
        <td>原生 2K 影视级画质，微表情与人物表演极佳</td>
      </tr>
      <tr>
        <td><strong>Kling 品牌</strong></td>
        <td>kling-v3 / kling-v3-omni</td>
        <td>快手可灵大模型，大动态稳定与多镜头连续性</td>
      </tr>
      <tr>
        <td><strong>Vidu 品牌</strong></td>
        <td>Vidu-Q4-Preview</td>
        <td>高动态镜头转换与特殊视听特效生成</td>
      </tr>
      <tr>
        <td><strong>Veo 品牌</strong></td>
        <td>Veo-3.1 / Veo-3.1-Fast</td>
        <td>好莱坞级电影景深感，专业摄影机运镜还原</td>
      </tr>
    </tbody>
  </table>

  <h2>4.3 支持的核心生成场景</h2>
  <div class="grid-3">
    <div class="card">
      <div class="card-title">📝 文生图 / 文生视频</div>
      <div class="card-desc">纯文本驱动（start2video），将生动提示词直接具象化为电影单帧或动态镜头。</div>
    </div>
    <div class="card">
      <div class="card-title">🖼️ 图生图 / 首帧生视频</div>
      <div class="card-desc">输入垫图或分镜单帧，模型精准锁定人物形态与光影，赋予其自然流畅的动态演绎。</div>
    </div>
    <div class="card">
      <div class="card-title">🎞️ 首尾帧平滑过渡</div>
      <div class="card-desc">start-end2video 模式，输入起始帧与终止帧，模型智能演算补全中间所有过渡过程。</div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<!-- 第 5 章 -->
<div>
  <h1>05. 核心节点全解析与创作工作流</h1>
  <p>画布内置 10+ 种专为视听生产打造的专业节点，涵盖从输入到终验的全部环节：</p>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">📥 素材上传节点 (Upload Node)</div>
      <div class="card-desc">
        <strong>用途：</strong>导入外部图片、实拍素材或参考音频。<br>
        <strong>操作：</strong>拖拽文件落盘，保留原始色彩空间与分辨率，作为下游节点初始母本。
      </div>
    </div>
    <div class="card">
      <div class="card-title">🎨 AI 生图节点 (Image Node)</div>
      <div class="card-desc">
        <strong>用途：</strong>文生图、单图/多图参考垫图、局部重绘。<br>
        <strong>功能：</strong>支持选择长宽比（16:9、9:16、1:1 等）、分辨率（1K/2K/4K）。配备多角度机位与打光工具条。
      </div>
    </div>
    <div class="card">
      <div class="card-title">🎬 AI 视频节点 (AI Video Node)</div>
      <div class="card-desc">
        <strong>用途：</strong>文生视频、图生视频、首尾帧过渡。<br>
        <strong>功能：</strong>输入起始帧与结束帧连线，调节运镜幅度 (Motion)、时长与相机运动指令。
      </div>
    </div>
    <div class="card">
      <div class="card-title">📝 AI 文本与音频节点 (Text & Audio)</div>
      <div class="card-desc">
        <strong>用途：</strong>文本节点调用 LLM 润色剧本与扩写提示词；音频节点支持语音合成 (TTS) 与音效生成。
      </div>
    </div>
    <div class="card">
      <div class="card-title">🎞️ 分镜拆解节点 (Storyboard Split)</div>
      <div class="card-desc">
        <strong>用途：</strong>将一张九宫格分镜大图一键切分为 9 个独立的单帧镜头节点，分别连接生视频节点。
      </div>
    </div>
    <div class="card">
      <div class="card-title">🌐 全景图节点 (Panorama Node)</div>
      <div class="card-desc">
        <strong>用途：</strong>生成或浏览 360° 球面全景图。内置交互式全景查看器，旋转机位后一键截取构图画面！
      </div>
    </div>
  </div>

  <h2>高级节点：标签组 (Tag Group) 的收纳妙用</h2>
  <p>
    当项目包含数十张主角服装、面部和道具参考图时，杂乱的连线会污染画布。
  </p>
  <div class="callout callout-tip">
    <div class="callout-title">💡 标签组的使用规则</div>
    新建「标签组节点」，将某角色的所有参考图拖放进标签组进行封装。连接标签组到下游生图节点时，系统会自动聚合全组素材给模型，且<strong>绝不会向提示词中注入额外的无用标签描述</strong>，确保提示词纯净不漂移。
  </div>
</div>

<div class="page-break"></div>

<!-- 第 6 章 -->
<div>
  <h1>06. 3D 高斯泼溅 (3DGS) 深度工作流</h1>
  <p>
    本版本特别引入了业界前沿的 <strong>3D Gaussian Splatting (3DGS)</strong> 节点技术，将三维现实空间重建技术与 2D AI 生图无缝连接。
  </p>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">📦 支持的主流 3DGS 资产格式</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><code>.ply</code>：标准 3D 扫描点云与高斯点数据</li>
        <li><code>.splat</code> / <code>.spz</code>：紧凑型高效高斯文件</li>
        <li><code>.sog</code> / <code>.ksplat</code>：针对 WebGPU 优化的流式格式</li>
        <li><code>.ssproj</code>：SuperSplat 完整空间工程包</li>
      </ul>
    </div>
    <div class="card">
      <div class="card-title">✨ 核心功能亮点</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><strong>本地资产库统一管理：</strong>导入后本地持久化，支持重命名。</li>
        <li><strong>Chrome 深度编辑：</strong>一键拉起独立 SuperSplat 3D 空间。</li>
        <li><strong>视角自动回传：</strong>在 3D 空间中截取的镜头自动返回画布。</li>
        <li><strong>无缝衔接生图：</strong>截取的 3D 视角作为后续生图的绝对基准！</li>
      </ul>
    </div>
  </div>

  <h2>3D 高斯节点完整操作流程</h2>
  <div class="step-flow">
    <div class="step-box">
      <div class="step-title"><span class="step-number">1</span>导入 3D 资产</div>
      <div class="step-text">在画布中创建「3D 高斯」节点，点击「导入 3DGS」，选择本地扫描的 ply 或 splat 文件。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">2</span>Chrome 编辑</div>
      <div class="step-text">点击「在 Chrome 中编辑」，桌面端将安全拉起集成的 SuperSplat 空间编辑器。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">3</span>摆角度与截屏</div>
      <div class="step-text">在 3D 视窗中自由漫游、裁剪场景噪点，找到最佳机位，点击截取视角 (Capture View)。</div>
    </div>
    <div class="step-box">
      <div class="step-title"><span class="step-number">4</span>回传画布生成</div>
      <div class="step-text">快照自动以「3D 高斯视角」派生图片节点形式出现在画布中，直接连线喂给生图或生视频节点！</div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<!-- 第 7 章 -->
<div>
  <h1>07. 导演台与 3D 预演动画系统</h1>
  <p>
    为了彻底解决 AI 视频生成中常见的“机位随机抽卡、角色动态不稳定、视听语言难以受控”等行业痛点，软件内置了<strong>导演台 (Director Studio) 与预演台 (Previsualization)</strong>。
  </p>

  <h2>7.1 导演台与预演台的区别</h2>
  <table>
    <thead>
      <tr>
        <th style="width:20%;">工作模式</th>
        <th style="width:40%;">主要工作任务</th>
        <th style="width:40%;">输出结果与用途</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>静态导演台</strong><br>(Director Studio)</td>
        <td>在 3D 空间中摆放角色模型、编辑骨骼肢体姿态、配置场景道具、布置主光/辅光位置，设置全景背景。</td>
        <td>拍摄单张关键构图快照 (Snapshot)，作为 AI 文生图或垫图生图的精确姿态与光影参考。</td>
      </tr>
      <tr>
        <td><strong>动态预演台</strong><br>(Previs Studio)</td>
        <td>使用 24fps 专业动画时间轴，绘制地面走位轨迹，赋予角色行走/奔跑动作，安排摄影机运镜运动轨道。</td>
        <td>录制一段低成本 3D 动态视频或关键帧序列，送回画布作为 AI 图生视频的最高权重控制源！</td>
      </tr>
    </tbody>
  </table>

  <h2>7.2 预演台实操：做一段 5 秒镜头预演</h2>
  <ol>
    <li><strong>添加角色：</strong>在左侧面板点击「人物」添加 3D 人形角色，或在右侧对象列表中选中已有角色。</li>
    <li><strong>绘制走位轨迹：</strong>点击「绘制」，按住鼠标左键在地面拖动勾勒行走路线（或点「标记」逐点定位）。路径片段会自动呈现在底部多轨时间轴上。</li>
    <li><strong>匹配动作库：</strong>点击「动作库」，从本地预置的高质量人体运动库中挑选（如：慢步走、拔枪射击、转身惊恐等），动作将平滑附着在角色关键帧上。</li>
    <li><strong>机位运镜调度：</strong>点击「摄影机」，选择经典运镜模板（推近、摇移、环绕），或开启「跟拍人物」让镜头自动锁定主角面部或全身。</li>
    <li><strong>成片录制与回传：</strong>在「看成片」模式下确认构图无误后，点击顶部「录制」，渲染生成的 3D 预演视频将自动插入到当前画布，成为 AI 视频生成的起点！</li>
  </ol>

  <div class="callout callout-info">
    <div class="callout-title">🎮 摄影机自由运镜控制快捷键</div>
    在摄影机模板面板内点击「自由运镜」，可用游戏级第一人称视角摆镜头：<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 空间移动机位，鼠标右键拖动视角，<kbd>F</kbd> 键快速锁定画面中心人物，<kbd>Enter</kbd> 打下一个机位关键帧，按 <kbd>Esc</kbd> 退出自由摆镜。
  </div>
</div>

<div class="page-break"></div>

<!-- 第 8 章 -->
<div>
  <h1>08. 画布智能助理 (Canvas Agent)</h1>
  <p>
    画布右上角的 <strong>Agent</strong> 是您的全能创作副驾。它不是孤立的网页聊天框，而是深度整合了画布上下文与工具调用协议的具身智能体。
  </p>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">🧠 Agent 能为您做什么？</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><strong>理解画布上下文：</strong>识别当前选中的节点、已上传的参考图和连线关系。</li>
        <li><strong>自然语言建图：</strong>说出您的剧本设想，Agent 自动为您排布 4-8 个分镜节点。</li>
        <li><strong>批量整理排版：</strong>自动计算节点几何间距，规整排列杂乱画布。</li>
        <li><strong>任务跟进与定位：</strong>生成任务完成后，在对话流中直接点击按钮定位到结果节点。</li>
      </ul>
    </div>
    <div class="card">
      <div class="card-title">🛡️ 安全控制模式</div>
      <ul style="font-size:8.2pt; margin-bottom:0;">
        <li><strong>手动模式 (Manual)：</strong>Agent 提出的每一项改动均以批准卡呈现，待您确认后方才执行。</li>
        <li><strong>自动模式 (Auto)：</strong>自主执行创建、连线与生成。<strong>注意：在执行“删除节点”等破坏性操作前，仍会强制请求您的手动许可！</strong></li>
        <li><strong>防重复扣费保障：</strong>任务状态不明确时，不会自动重复下发可能计费的 API 请求。</li>
      </ul>
    </div>
  </div>

  <h2>智能诊断功能：当生成报错时</h2>
  <p>
    如果生图或视频任务出现失败红标，您不必打开控制台摸索。直接在右侧对 Agent 说：“<em>帮我看看刚刚生图为什么失败？</em>”
  </p>
  <p>
    Agent 将自动调取本地<strong>脱敏诊断日志</strong>，过滤掉敏感密钥后，直接为您翻译上游服务商的报错原因（如：余额不足、提示词触发上游安全词拦截、上传图片尺寸超限等），并提供精准的修改建议。
  </p>
</div>

<div class="page-break"></div>

<!-- 第 9 章 -->
<div>
  <h1>09. 提示词库、影视语典与批量导入</h1>
  <p>为了让创作者摆脱“词穷”和反复手工复制粘贴的低效劳动，软件在主页与侧栏提供了强大的资产工具集。</p>

  <h2>9.1 提示词库 (Prompt Library)</h2>
  <p>在首页切换至「提示词库」，内置上千条影视行业级双语提示词资产，覆盖六大专业维度：</p>
  <ul>
    <li><strong>画面风格：</strong>赛博朋克、新海诚动漫、胶片复古、中世纪油画、暗黑哥特、极简未来等。</li>
    <li><strong>影视机位：</strong>极端仰拍、鸟瞰上帝视角、航拍大广角、微距浅景深、荷兰倾斜角等。</li>
    <li><strong>电影光影：</strong>伦勃朗光、丁达尔光线、赛博霓虹顶光、黄昏体积光、逆光轮廓剪影等。</li>
    <li><strong>材质工艺：</strong>8K 细致纹理、毛发微绒毛、湿润雨水倒影、陈旧羊皮纸、磨砂亚克力等。</li>
  </ul>

  <h2>9.2 电影视听语言图鉴 (Cinematic Techniques)</h2>
  <p>
    位于主页第三个标签页。这是一部互动式影视专业辞书，图文并茂展示了从电影大师提炼出的视听语法，可直接作为分镜设计的标准教科书。
  </p>

  <h2>9.3 表格批量导入提示词 (Bulk Prompt Import)</h2>
  <p>在左侧工具栏点击「批量导入」图标，上传预先整理好的 CSV 或 Excel 脚本表格：</p>
  <ul>
    <li>自由映射列标题（例如：将“镜头提示词”列映射到生成文本，将“画面比例”映射到长宽比）；</li>
    <li>点击确定，系统会自动在画布视口中心批量生成规整排列的生图任务卡；</li>
    <li>大幅节省数十个分镜重复点选与输入时间的 90% 以上！</li>
  </ul>
</div>

<div class="page-break"></div>

<!-- 第 10 章 -->
<div>
  <h1>10. 工程持久化、迁移与安全备份</h1>
  <p>创作者的资产安全与工程便携性是 mvaigc 桌面画布最坚守的设计原则。</p>

  <h2>10.1 本地 SQLite 自动保存机制</h2>
  <p>
    画布中的每一个节点坐标、连线拓扑、提示词历史、媒体文件引用与视口缩放均实时保存在本机应用数据目录下的 SQLite 数据库中。无需担心意外断电或程序崩溃，重新打开项目自动精准还原至最后一秒的编辑状态。
  </p>

  <h2>10.2 工程导出与跨设备迁移</h2>
  <p>
    在首页「画布工程」卡片上，点击「导出」按钮，工程将打包为 <code>.mvaigc</code> 格式文件。通过移动硬盘或即时通讯工具发送给同事后，对方在首页点击「导入工程」即可完整复现工程的所有节点与素材。
  </p>

  <h2>10.3 凭据安全防泄露原则</h2>
  <div class="callout callout-warn">
    <div class="callout-title">🔒 绝对安全的凭据保护规则</div>
    <strong>工程文件 (.mvaigc) 默认绝不包含任何 API 密钥或账户密码！</strong><br>
    当您分享工程给他人时，对方使用的是其自己设置中配置的账号密码，绝不用担心您的商业额度被盗刷。而在设置备份中，只有在您明确勾选并知晓风险的情况下，凭据才会包含在系统备份包中。
  </div>
</div>

<div class="page-break"></div>

<!-- 第 11 章 -->
<div>
  <h1>11. 故障排查 (FAQ) 与快捷键总表</h1>

  <h2>11.1 常见问题与快速排查</h2>
  <table>
    <thead>
      <tr>
        <th style="width:25%;">常见现象</th>
        <th style="width:35%;">根本原因分析</th>
        <th style="width:40%;">推荐解决对策</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>融媒视界模型列表未显示或生成报错</strong></td>
        <td>1. mvaigc 账号或密码输入有误；<br>2. 本地代理端口被其他软件占用。</td>
        <td>前往「设置 → 融媒视界 mvaigc」重新核对账号密码并点击保存；若端口冲突可尝试修改端口为 19001。</td>
      </tr>
      <tr>
        <td><strong>生成任务一直卡在 submitting 或 queued</strong></td>
        <td>1. 云端排队队列繁忙；<br>2. 本地防火墙阻止了本机代理访问。</td>
        <td>打开左侧「日志」查看请求状态码，确认本地网络与代理通道正常连接。</td>
      </tr>
      <tr>
        <td><strong>3D 高斯节点「在 Chrome 中编辑」无反应</strong></td>
        <td>1. 系统未安装 Google Chrome 浏览器；<br>2. 导入的文件损坏或非标准 ply/splat。</td>
        <td>确保系统已安装标准版 Chrome 浏览器；重新导入合规的点云或高斯格式资产。</td>
      </tr>
      <tr>
        <td><strong>ComfyUI 连接失败</strong></td>
        <td>1. ComfyUI 启动参数未开启跨域；<br>2. 服务端口非默认 8188。</td>
        <td>启动 ComfyUI 时添加启动参数：<code>--enable-cors-header * --listen</code>，并在设置中确认端口。</td>
      </tr>
      <tr>
        <td><strong>图片节点显示白块或加载失败</strong></td>
        <td>本地临时缓存被清理软件误删。</td>
        <td>打开左侧「日志」，找到对应生成成功的任务，点击「重新获取素材」自动重新拉取落盘。</td>
      </tr>
    </tbody>
  </table>

  <h2>11.2 全局核心操作快捷键速查</h2>
  <table>
    <thead>
      <tr>
        <th style="width:20%;">操作分类</th>
        <th style="width:35%;">快捷键 / 手势</th>
        <th style="width:45%;">功能效果说明</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>画布导航</strong></td>
        <td><kbd>Space</kbd> + 鼠标左键拖拽 / 鼠标中键</td>
        <td>自由无极平移漫游当前工作画布</td>
      </tr>
      <tr>
        <td><strong>键盘平移</strong></td>
        <td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 键盘按键</td>
        <td>在画布获焦状态下极速进行游戏级视口漫游</td>
      </tr>
      <tr>
        <td><strong>画布缩放</strong></td>
        <td>鼠标滚轮上下滚动</td>
        <td>以鼠标指针为中心进行平滑缩放放大与缩小</td>
      </tr>
      <tr>
        <td><strong>节点管理</strong></td>
        <td><kbd>Delete</kbd> / <kbd>Backspace</kbd></td>
        <td>快速删除所有当前选中的节点及其连线</td>
      </tr>
      <tr>
        <td><strong>节点连选</strong></td>
        <td><kbd>Shift</kbd> + 鼠标左键点选 / 框选</td>
        <td>多选节点，支持批量拖动移动与批量配置</td>
      </tr>
      <tr>
        <td><strong>预演台微调</strong></td>
        <td><kbd>←</kbd> / <kbd>→</kbd> 方向键</td>
        <td>时间轴微调 1 帧；按住 <kbd>Shift</kbd> 步进 10 帧 (24fps)</td>
      </tr>
      <tr>
        <td><strong>时间轴吸附</strong></td>
        <td>拖拽关键帧时按住 <kbd>Alt</kbd> 键</td>
        <td>临时关闭关键帧网格吸附，进行亚像素自由精修</td>
      </tr>
      <tr>
        <td><strong>自由运镜</strong></td>
        <td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + 鼠标转向</td>
        <td>以第一人称视点飞行调整摄影机机位</td>
      </tr>
      <tr>
        <td><strong>运镜记录</strong></td>
        <td><kbd>Enter</kbd>（在自由摆镜面板中）</td>
        <td>在当前时间点记录摄影机机位关键帧</td>
      </tr>
      <tr>
        <td><strong>角色焦点</strong></td>
        <td><kbd>F</kbd>（在自由摆镜面板中）</td>
        <td>将摄影机镜头视心瞬间聚焦锁定至画面中心人物</td>
      </tr>
    </tbody>
  </table>

  <div class="callout callout-tip" style="margin-top:14px;">
    <div class="callout-title">🎉 祝您创作顺利！</div>
    mvaigc 桌面画布将持续更新，为您带来更多沉浸式 AI 视听生成体验与强大的工业级导演预演能力。
  </div>
</div>

</body>
</html>
"""
    return html_content

def generate_markdown():
    md = """# mvaigc 桌面画布 — 用户操作手册 (User Operation Manual)

> **版本**：v2.0 (macOS / Windows 桌面通用版)  
> **出品**：mvaigc 融媒视界 (mvaigc.cn)  
> **定位**：面向 AI 影视、视频、分镜创作与 3D 预演的专业本地桌面画布  
> **文档编制**：2026 年 11 月

---

## 📖 目录导航

- [01. 软件定位与核心架构特性](#01-软件定位与核心架构特性)
- [02. 3分钟快速上手与首个工程](#02-3分钟快速上手与首个工程)
- [03. 无限可视创作画布深度解析](#03-无限可视创作画布深度解析)
- [04. 模型中枢：mvaigc 融媒视界](#04-模型中枢mvaigc-融媒视界)
- [05. 核心节点全解析与创作工作流](#05-核心节点全解析与创作工作流)
- [06. 3D 高斯泼溅 (3DGS) 深度工作流](#06-3d-高斯泼溅-3dgs-深度工作流)
- [07. 导演台与 3D 预演动画系统](#07-导演台与-3d-预演动画系统)
- [08. 画布智能助理 (Canvas Agent)](#08-画布智能助理-canvas-agent)
- [09. 提示词库、影视语典与批量导入](#09-提示词库影视语典与批量导入)
- [10. 工程持久化、迁移与安全备份](#10-工程持久化迁移与安全备份)
- [11. 故障排查 (FAQ) 与快捷键总表](#11-故障排查-faq-与快捷键总表)

---

## 01. 软件定位与核心架构特性

**mvaigc 桌面画布**（基于 Open Storyboard Canvas 深度演进二次开发，由**融媒视界**联合打造）是一套专为影视编导、分镜师、动画团队与数字创作者量身定制的本地可视化创作工作流工具。不同于传统单次单向的网页生成器，mvaigc 桌面画布把创作者所有的参考素材、灵感草图、3D 空间预演、镜头走位、多格分镜与视频成片编织在同一张**无限扩展的可视化节点画布**中。

### 核心亮点
1. **融媒视界官方服务**：内置 mvaigc 专属反向代理，账号密码一键打通全线顶级文生图、图生视频模型。
2. **连续可溯的节点图**：任何下游视频或衍生图均可溯源至原始母本素材与参数，支持分支创作与多级派生。
3. **本地安全与私密**：工程数据全部持久化存储在本机 SQLite 中，无需担心创作资产泄露或商业凭据丢失。

---

## 02. 3分钟快速上手与首个工程

首次运行软件，仅需完成以下 3 步即可跑通“文生图 → 图生视频”完整创作链路：

1. **新建工程**：在主页「画布工程」标签页中点击「新建工程」，输入工程名称（如：科幻短片01），进入工作画布。
2. **登录融媒视界**：点击右上角设置图标 ⚙️，进入「融媒视界 mvaigc」，填入账号密码并保存，系统将一键自动装配全部模型！
3. **建点并生成**：左侧栏点击「生图」生成节点，输入提示词与画面比例，生成后直接连线至「生视频」节点完成动态演绎！

> **快捷小技巧**：如果您拥有本地或远程 ComfyUI 实例，在设置中开启「ComfyUI 连接」，无需购买云端额度即可直接调用本地显卡算力出图与生视频！

---

## 03. 无限可视创作画布深度解析

**画布 (Canvas)** 是 mvaigc 的绝对核心。它不仅是一个绘图板，更是一套集成了**视口漫游、拓扑连线、跨节点引用与多选排版**的非线性视听生产系统。

### 3.1 画布的核心价值与创作范式
传统 AI 聊天窗口只能以单一时间流展示成果，历史记录繁杂难找，不同镜头的角色和机位彼此割裂。而在 mvaigc 画布中：
- **全景总览全局视角**：全片所有分镜、垫图与生成结果在二维平面一览无余，镜头节奏与色调一目了然；
- **非线性分支创作**：以一张主角概念图为中心，可分叉延伸出白天场景、雨夜场景、战斗场景等多条独立支线；
- **参数与素材沿袭**：上游节点的图片或提示词改动，下游连线节点可瞬间无缝继承，大幅降低重复配置时间。

### 3.2 视口空间与漫游导航系统
- **鼠标中键 / 右键拖拽**：按住中键或右键即可在画布上无极自由平移。
- **空格键协同**：按住 `Space` + 鼠标左键拖拽平移，符合专业影视剪辑软件手感。
- **WASD 键盘漫游**：专为 3D/游戏用户定制，在画布获得焦点时，按 `W` `A` `S` `D` 快速平移。
- **鼠标滚轮缩放**：以鼠标指针所在位置为中心，实现亚像素平滑无级缩放。
- **自适应居中 (Fit View)**：点击顶部浮动栏「自适应」按钮，一键纵览全部节点。
- **画布锁定保护**：点击顶部「锁头」图标，冻结画布移动与节点位置，防止误拖拽。

### 3.3 节点拓扑、交互连线与跨节点 `@` 语法
- **端口直观连线**：节点右侧圆点为「输出端」，左侧圆点为「输入端」。从上传图片节点的输出圆点按住左键拖拽连线至生图节点的输入端，即可完成垫图绑定。
- **拖线即时建点**：从任意节点的输出端口拉出连线，拖到画布空白处松开，系统会自动弹出与该素材兼容的下游节点菜单，一秒新建下游任务！
- **跨节点 `@` 联想注入**：在任意生图、生视频或文本节点的提示词框中输入 `@`，即可快速检索并挂载画布中的其他图片或剧本节点作为多模态参考，无需反复复制图片。

### 3.4 多选框选与批量操作工具条
- **智能框选**：按住 `Shift` 键并在空白处拖动鼠标拉出虚线框，即可批量框选区域内的所有节点；或按住 `Shift` 连续单击追加单选节点。
- **批量浮动工具条**：多选节点后，画布上方自动弹出专属批量操作条，支持**批量横向排开、纵向对齐、统一移动位置、批量修改生成参数与一键批量删除**。

---

## 04. 模型中枢：mvaigc 融媒视界

**mvaigc 融媒视界 (mvaigc.cn)** 是平台官方内置的一站式全模态 AI 算力服务中枢。彻底免除传统工具需要逐一申请 Key、频繁充值及手动调试反代路由的繁琐成本。

### 4.1 一键免配置装配机制
1. 在界面右上角点击齿轮 ⚙️ 打开系统设置面板，切换到「融媒视界 mvaigc」菜单项。
2. 输入您的 mvaigc 账号与密码（本地端口可选，默认 19000），点击「保存」。
3. 底层自动启动安全代理服务，全线图片与视频模型库即刻激活，节点下拉菜单自动刷新！

### 4.2 豪华多模态模型矩阵一览
| 模型分类 | 涵盖品牌与系列 | 代表模型名称 | 核心能力与规格 |
| :--- | :--- | :--- | :--- |
| **AI 生图模型矩阵** | **GPT 品牌** | GPT-Image-2.5-Pro / Fast / GPT-Image-2 | 超强构图理解，1K/2K/4K 分辨率，多画幅比 |
| | **Nano-Banana 品牌** | Nano-Banana-2.1 / 2 / Nano-Banana-Pro | 极速渲染出图，电影质感与写实细节卓越 |
| | **Seedream 品牌** | Seedream-5.0-Pro (豆包) | 人像美学细腻，二次元与国风氛围感出众 |
| | **Qwen / WAN 品牌** | Qwen-3.0-Pro / WAN-2.7 / WAN-2.7-Pro | 中文语义理解精准，文字渲染与排版稳定性好 |
| **AI 视频模型矩阵** | **Seedance 品牌** | Seedance-2.5 / Seedance-2.0 / Fast | 支持 4-30 秒超长连贯生成，多参考图控制强 |
| | **WAN 品牌** | WAN-3.0-Prime (高速版) / WAN-3.0 / HappyHorse | 超高运镜帧率，复杂物理碰撞与光影动态逼真 |
| | **MiniMax 品牌** | MiniMax-H3 (海螺视频) | 原生 2K 影视级画质，微表情与人物表演极佳 |
| | **Kling 品牌** | kling-v3 / kling-v3-omni | 快手可灵大模型，大动态稳定与多镜头连续性 |
| | **Vidu 品牌** | Vidu-Q4-Preview | 高动态镜头转换与特殊视听特效生成 |
| | **Veo 品牌** | Veo-3.1 / Veo-3.1-Fast | 好莱坞级电影景深感，专业摄影机运镜还原 |

### 4.3 支持的核心生成场景
- **文生图 / 文生视频**：纯文本驱动（`start2video`），将生动提示词直接具象化为电影单帧或动态镜头。
- **图生图 / 首帧生视频**：输入垫图或分镜单帧，模型精准锁定人物形态与光影，赋予其自然流畅的动态演绎。
- **首尾帧平滑过渡**：`start-end2video` 模式，输入起始帧与终止帧，模型智能演算补全中间所有过渡过程。

---

## 05. 核心节点全解析与创作工作流

画布内置 10+ 种专为视听生产打造的专业节点：
- **📥 素材上传节点 (Upload Node)**：导入外部图片、实拍素材或参考音频。作为下游节点初始母本。
- **🎨 AI 生图节点 (Image Node)**：文生图、单图/多图参考垫图、局部重绘。支持选择长宽比（16:9、9:16、1:1 等）、分辨率（1K/2K/4K）。配备多角度机位与打光工具条。
- **🎬 AI 视频节点 (AI Video Node)**：文生视频、图生视频、首尾帧过渡。输入起始帧与结束帧连线，调节运镜幅度 (Motion)、时长与相机运动指令。
- **📝 AI 文本与音频节点 (Text & Audio)**：文本节点调用 LLM 润色剧本与扩写提示词；音频节点支持语音合成 (TTS) 与音效生成。
- **🎞️ 分镜拆解节点 (Storyboard Split)**：将一张九宫格分镜大图一键切分为 9 个独立的单帧镜头节点，分别连接生视频节点。
- **🌐 全景图节点 (Panorama Node)**：生成或浏览 360° 球面全景图。内置交互式全景查看器，旋转机位后一键截取构图画面！

### 高级节点：标签组 (Tag Group) 的收纳妙用
当项目包含数十张主角服装、面部和道具参考图时，杂乱的连线会污染画布。新建「标签组节点」，将某角色的所有参考图拖放进标签组进行封装。连接标签组到下游生图节点时，系统会自动聚合全组素材给模型，且**绝不会向提示词中注入额外的无用标签描述**，确保提示词纯净不漂移。

---

## 06. 3D 高斯泼溅 (3DGS) 深度工作流

本版本特别引入了业界前沿的 **3D Gaussian Splatting (3DGS)** 节点技术，将三维现实空间重建技术与 2D AI 生图无缝连接。

### 核心亮点
- **支持格式**：`.ply`、`.splat`、`.spz`、`.sog`、`.ksplat`、`.ssproj`
- **本地管理**：本地资产持久化存储，支持重命名与快速调用。
- **Chrome 深度漫游**：一键拉起独立的 SuperSplat 3D 空间。
- **快照自动回传**：3D 视窗截取的快照直接回传画布作为生图基准！

---

## 07. 导演台与 3D 预演动画系统

为了彻底解决 AI 视频生成中常见的“机位随机抽卡、角色动态不稳定、视听语言难以受控”等行业痛点，软件内置了**导演台 (Director Studio) 与预演台 (Previsualization)**。

### 导演台与预演台的区别
| 工作模式 | 主要工作任务 | 输出结果与用途 |
| :--- | :--- | :--- |
| **静态导演台**<br>(Director Studio) | 在 3D 空间中摆放角色模型、编辑骨骼肢体姿态、配置场景道具、布置主光/辅光位置，设置全景背景。 | 拍摄单张关键构图快照 (Snapshot)，作为 AI 文生图或垫图生图的精确姿态与光影参考。 |
| **动态预演台**<br>(Previs Studio) | 使用 24fps 专业动画时间轴，绘制地面走位轨迹，赋予角色行走/奔跑动作，安排摄影机运镜运动轨道。 | 录制一段低成本 3D 动态视频或关键帧序列，送回画布作为 AI 图生视频的最高权重控制源！ |

> **自由运镜快捷键**：在摄影机模板面板内点击「自由运镜」，可用游戏级第一人称视角摆镜头：`WASD` 空间移动机位，鼠标右键拖动视角，`F` 键快速锁定画面中心人物，`Enter` 打下一个机位关键帧，按 `Esc` 退出自由摆镜。

---

## 08. 画布智能助理 (Canvas Agent)

画布右上角的 **Agent** 是您的全能创作副驾。它不是孤立的网页聊天框，而是深度整合了画布上下文与工具调用协议的具身智能体。

### 核心能力
- **理解画布上下文**：识别当前选中的节点、已上传的参考图和连线关系。
- **自然语言建图**：说出您的剧本设想，Agent 自动为您排布 4-8 个分镜节点。
- **批量整理排版**：自动计算节点几何间距，规整排列杂乱画布。
- **智能诊断与排错**：遇到生成失败时，自动调取本地脱敏诊断日志，快速给出原因与解决对策。
- **安全保护机制**：自动模式下在执行“删除节点”等破坏性操作前，仍强制请求您的手动确认。

---

## 09. 提示词库、影视语典与批量导入

- **提示词库 (Prompt Library)**：内置上千条影视行业级双语提示词资产，覆盖风格、机位、光影、材质、角色与场景六大维度。
- **电影视听语言图鉴 (Cinematic Techniques)**：互动式影视专业辞书，图文并茂展示大师级视听语法与机位参考。
- **表格批量导入 (Bulk Prompt Import)**：上传 CSV 或 Excel 脚本表格，自由映射字段，一键批量在画布上生成几十个排版规整的任务节点！

---

## 10. 工程持久化、迁移与安全备份

- **本地 SQLite 自动保存**：节点坐标、连线拓扑、提示词历史与参数每秒自动落盘，程序崩溃或断电重启即刻精准还原。
- **工程打包导出 (.mvaigc)**：一键打包工程文件，方便团队成员跨设备共享。
- **凭据隔离保护**：`.mvaigc` 工程文件默认绝不包含账号密码或商业 API 凭据，杜绝额度被盗刷风险。

---

## 11. 故障排查 (FAQ) 与快捷键总表

### 11.1 常见问题与快速排查
| 常见现象 | 根本原因分析 | 推荐解决对策 |
| :--- | :--- | :--- |
| **融媒视界模型列表未显示或生成报错** | 1. mvaigc 账号或密码输入有误；<br>2. 本地代理端口被其他软件占用。 | 前往「设置 → 融媒视界 mvaigc」重新核对账号密码并点击保存；若端口冲突可尝试修改端口为 19001。 |
| **生成任务一直卡在 submitting 或 queued** | 1. 云端排队队列繁忙；<br>2. 本地防火墙阻止了本机代理访问。 | 打开左侧「日志」查看请求状态码，确认本地网络与代理通道正常连接。 |
| **3D 高斯节点「在 Chrome 中编辑」无反应** | 1. 系统未安装 Google Chrome 浏览器；<br>2. 导入的文件损坏或非标准 ply/splat。 | 确保系统已安装标准版 Chrome 浏览器；重新导入合规的点云或高斯格式资产。 |
| **ComfyUI 连接失败** | 1. ComfyUI 启动参数未开启跨域；<br>2. 服务端口非默认 8188。 | 启动 ComfyUI 时添加启动参数：`--enable-cors-header * --listen`，并在设置中确认端口。 |
| **图片节点显示白块或加载失败** | 本地临时缓存被清理软件误删。 | 打开左侧「日志」，找到对应生成成功的任务，点击「重新获取素材」自动重新拉取落盘。 |

### 11.2 全局核心操作快捷键速查
| 操作分类 | 快捷键 / 手势 | 功能效果说明 |
| :--- | :--- | :--- |
| **画布导航** | `Space` + 鼠标左键拖拽 / 鼠标中键 | 自由无极平移漫游当前工作画布 |
| **键盘平移** | `W` `A` `S` `D` 键盘按键 | 在画布获焦状态下极速进行游戏级视口漫游 |
| **画布缩放** | 鼠标滚轮上下滚动 | 以鼠标指针为中心进行平滑缩放放大与缩小 |
| **节点管理** | `Delete` / `Backspace` | 快速删除所有当前选中的节点及其连线 |
| **节点连选** | `Shift` + 鼠标左键点选 / 框选 | 多选节点，支持批量拖动移动与批量配置 |
| **预演台微调** | `←` / `→` 方向键 | 时间轴微调 1 帧；按住 `Shift` 步进 10 帧 (24fps) |
| **时间轴吸附** | 拖拽关键帧时按住 `Alt` 键 | 临时关闭关键帧网格吸附，进行亚像素自由精修 |
| **自由运镜** | `W` `A` `S` `D` + 鼠标转向 | 以第一人称视点飞行调整摄影机机位 |
| **运镜记录** | `Enter`（在自由摆镜面板中） | 在当前时间点记录摄影机机位关键帧 |
| **角色焦点** | `F`（在自由摆镜面板中） | 将摄影机镜头视心瞬间聚焦锁定至画面中心人物 |
"""
    return md

def build():
    html = generate_manual_html()
    html_path = os.path.abspath("docs/mvaigc-canvas-user-manual.html")
    pdf_path_root = os.path.abspath("mvaigc_桌面画布_操作手册.pdf")
    pdf_path_docs = os.path.abspath("docs/mvaigc_桌面画布_操作手册.pdf")
    md_path = os.path.abspath("docs/mvaigc-canvas-user-manual.md")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ HTML 手册生成完成: {html_path}")

    md_content = generate_markdown()
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"✅ Markdown 手册生成完成: {md_path}")

    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome_bin):
        print(f"❌ 找不到 Chrome 浏览器: {chrome_bin}")
        sys.exit(1)

    cmd = [
        chrome_bin,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path_root}",
        html_path
    ]
    print("⏳ 正在调用 Chrome 渲染全新高精度 PDF 手册...")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("Chrome 渲染警告或错误:\n", res.stderr)

    if os.path.exists(pdf_path_root):
        size_kb = os.path.getsize(pdf_path_root) / 1024
        print(f"✅ PDF 手册生成成功 (根目录): {pdf_path_root} ({size_kb:.1f} KB)")
        with open(pdf_path_root, "rb") as rf:
            with open(pdf_path_docs, "wb") as wf:
                wf.write(rf.read())
        print(f"✅ PDF 手册同步至 docs/: {pdf_path_docs}")
    else:
        print(f"❌ PDF 生成失败: 未找到输出文件 {pdf_path_root}")
        sys.exit(1)

if __name__ == "__main__":
    build()
