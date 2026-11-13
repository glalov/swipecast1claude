-- Face position in the current headshot, found by a face detector (MediaPipe) in the browser.
-- Shape: {"u": headshot_url it was measured on, "r": width/height, "x","y","w","h": face box as fractions 0..1}
-- or {"u": url, "r": ratio, "none": true} when no face was found. Stale when u <> headshot_url.
alter table public.profiles add column if not exists headshot_face jsonb;
