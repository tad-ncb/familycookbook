-- Rough per-serving macro estimates for the full NYT/archive catalog
-- (~60k rows), matching what's already computed client-side for the ~955
-- curated recipes (see estimateMacros/MACRO_KEYWORD_RULES/parenGrams in
-- index.html). Precomputed and stored here rather than computed on the fly
-- so the archive can eventually be sorted/filtered by macros the same way
-- "What I can make now" already works for the curated set.
alter table nyt_recipes add column if not exists kcal numeric;
alter table nyt_recipes add column if not exists protein numeric;
alter table nyt_recipes add column if not exists carbs numeric;
alter table nyt_recipes add column if not exists fat numeric;
