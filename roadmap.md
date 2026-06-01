# Gelbooru Support Roadmap

## Goal

Add a parallel Gelbooru implementation for `comfyui-anima-t8` without changing the behavior of the existing Danbooru nodes.

The first version should give users an independent Gelbooru tag browser, prompt insertion flow, and preview-image node path while keeping the existing Danbooru gallery and nodes intact.

## Boundaries

- Keep existing Danbooru node logic unchanged.
- Add Gelbooru-specific files instead of folding Gelbooru into the current Danbooru manager.
- Touch shared entry files only where ComfyUI registration or frontend menu wiring requires it.
- Store Gelbooru cache data in separate SQLite tables.
- Use Gelbooru's DAPI endpoints:
  - Posts: `/index.php?page=dapi&s=post&q=index&json=1`
  - Tags: `/index.php?page=dapi&s=tag&q=index&json=1`

## Phase 1: Backend Data Layer

- Add `api/gelbooru_client.py`.
  - Fetch tag pages from Gelbooru DAPI.
  - Fetch preview posts for a tag.
  - Normalize inconsistent JSON shapes into one internal format.
  - Support optional `api_key` and `user_id` parameters via environment variables or `data/gelbooru_auth.json`.
- Add `core/gelbooru_manager.py`.
  - Create `gelbooru_tags` table.
  - Search, paginate, pin, and refresh Gelbooru tags.
  - Cache preview metadata in process memory.

## Phase 2: HTTP Routes

- Add `/anima_t8/gtags`.
- Add `/anima_t8/gtags/refresh`.
- Add `/anima_t8/gtags/pin`.
- Add `/anima_t8/gtags/preview`.
- Add `/anima_t8/gtags/image`.

## Phase 3: Nodes

- Add `nodes/gelbooru_style_node.py`.
  - Node name: `Anima Gelbooru Style T8`.
  - Inputs: `gelbooru_tags`, `default_weight`, `use_artist_prefix`, `last_picked`.
  - Outputs: `STYLE_PROMPT`, `PREVIEW_IMAGES`.
  - Preview image lookup should use Gelbooru, not Danbooru.
- Register the node in `__init__.py`.

## Phase 4: Frontend

- Add `web/components/gelbooru_gallery.js`.
  - Tabs: Gelbooru artist, copyright, character, general.
  - Keep selection, weight, pin, search, letter filter, pagination, preview, and refresh behavior consistent with the existing gallery.
- Extend `web/api.js` with Gelbooru route wrappers.
- Extend `web/anima_t8.js` with a Gelbooru library button and node-level Gelbooru button.

## Phase 5: Verification

- Run Python compile checks for new and touched Python files.
- Run lightweight JavaScript syntax validation when available.
- Do not require a running ComfyUI instance for static validation.
- If a ComfyUI server is available later, manually verify:
  - New node appears under `Anima/T8`.
  - Gelbooru gallery opens.
  - Tags load, pin, refresh, and insert.
  - Preview images render through the local proxy.
