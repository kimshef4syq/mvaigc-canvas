# image-search — query playbook for design_image_search

The backing engine favors descriptive aesthetic/style/mood phrases over exact-match keywords. Multi-word descriptive phrases (2-6 words) beat terse keyword strings: "modern minimalist living room", "watercolor portrait painting", "Makoto Shinkai anime scenery".

## Expand vague intent into concrete entities BEFORE writing queries

- Vague style word (`风格化的动漫` / `Y2K` / `赛博朋克` / `甜酷` / `多巴胺` / `治愈系` / `氛围感`) → name 3-5 specific sub-styles, works, or artists. `赛博朋克` → ["Blade Runner 2049 city", "Akira Tokyo neon", "cyberpunk neon alley"].
- Real person / brand+model / landmark / IP title → canonical English/romaji name + angle/scene anchor. `Tesla Model Y` → ["Tesla Model Y interior", "Tesla Model Y dashboard"].
- Specific subjects retain attributes that matter to the requested search results, such as a red Ferrari when its color is part of the brief. Choose an angle or scene that helps find usable references.
- For a broad subject (动漫 / 风景 / 美食 / 生活感), choose a coherent sub-category from the brief and context. Clarify when competing choices materially change the user's intended direction.

## Format rules

- English only — 2-6 words per query, descriptive phrases OK, no full sentences. Style/technique/lighting terms must be correct film/art-industry English (chiaroscuro, cel-shaded, Rembrandt lighting, tilt shift, bokeh) — never machine-translate or coin terms.
- COMPOUND CONSTRAINT: multiple co-occurring traits ("白发长发男性二次元" = white-hair + long-hair + male + anime) form one constraint set. Keep all required traits while varying an unspecified angle or scene, e.g. "white-haired long-haired male anime portrait" and "white-haired long-haired male anime swordsman".
- One unspecified axis per query across the array (style OR angle OR scene), not mixed. User-specified traits stay constant.
- TOTAL COUNT: when the user specifies a total number N, set `max_total_images = N`. `max_images_per_query` is only a per-query ceiling, never the requested total.
- VOLUME STRATEGY: spread queries across meaningful angles when exploring a broad subject; concentrate them when identity or compound traits tightly constrain the result. Query and download limits come from the tool schema, and actual volume follows the user's requested coverage and count.
- NOISE WORDS never allowed in any query: `4k` / `hd` / `no watermark` / `professional photography` / `stock photo` / `stylized` / `aesthetic` / `cinematic` / `mood` / 风格化 / 高级感 / 大片感 / 氛围感 / 治愈系 / 质感 / 参考 / reference / reference sheet / 表情包. They are intent words (zero discrimination), output-format words, or low-quality magnets (pull meme sites).

## Scenario strategies

- NAMED WORK / IP ("类似边缘行者的风格"): search by work title, never abstract style words. Priority: (1) canonical English title ("Cyberpunk Edgerunners key visual"); (2) if results are thin, research the same creator/studio's similar works and search THOSE titles (Studio Trigger → "Promare key visual", "Kill la Kill animation"); (3) only when no named works remain, concrete style descriptors ("thick lineart neon anime style"). Never search a studio/creator name directly.
- FASHION / BEAUTY / CONSUMER GOODS: append quality anchors — `runway` / `Vogue` / `Elle` / `haute couture` + benchmark brand names (techwear → ACRONYM / Nike ACG).
- QUALITY ANCHOR (general): reason about which source naturally produces the best images for the category, then append it: scenery → `desktop wallpaper`; interior → `architectural digest`; food → `food magazine editorial`; portrait → `magazine cover`. No fixed list.
- DIVERSITY / COMPARISON ("不同朝代纹样" / "各种色调"): enumerate concrete items (Tang / Song / Ming / Qing), one query per item.

## Pre-dispatch self-check — stop if any answer is "no"

- Can I picture exactly one thing for each query? (`anime character art` cannot — chibi stickers to mecha concept art.)
- Does each query name a person, brand, work, technique, or named style — NOT a generic category?
- Did any vague style word leak verbatim into a query? (If yes, expansion was skipped.)
- If the user specified multiple simultaneous traits, does EVERY query contain ALL of them? If any query drops a trait, fix it.
