(function (root) {
  const ns = (root.ReviewGuesser = root.ReviewGuesser || {});

  /**
   * Replace non-breaking spaces with regular spaces and trim the string.
   * @param {string} s
   * @returns {string}
   */
  function normalizeSpaces(s) {
    return (s || "").replace(/\u00A0/g, " ").trim();
  }

  /**
   * Parse numbers like:
   *   7,036 / 7.036 / 7 036 / 7K / 7 Mio
   *
   * Returns:
   *   - integer count
   *   - 0 when explicitly "0" (for "No reviews" callers)
   *   - null when nothing reasonable can be parsed
   *
   * @param {string} raw
   * @returns {number|null}
   */
  function parseReviewCountRaw(raw) {
    const s = normalizeSpaces(raw);
    if (!s) return null;

    // Zero special-case (handles "No reviews", etc.) — leave general case to caller
    if (/^\s*0\s*$/.test(s)) return 0;

    // Suffixes (K/M/B + common "Mio"/"Tsd")
    const mSuf = s.match(/(\d+[.,]?\d*)\s*(K|M|B|k|m|b|Mio|Tsd)\b/);
    if (mSuf) {
      const n = parseFloat(mSuf[1].replace(",", "."));
      const suf = mSuf[2].toLowerCase();
      const mult =
        suf === "k" || suf === "tsd"
          ? 1e3
          : suf === "m" || suf === "mio"
          ? 1e6
          : 1e9;
      const v = Math.round(n * mult);
      return Number.isFinite(v) ? v : null;
    }

    // Largest integer with separators
    const matches = [...s.matchAll(/\b(\d{1,3}(?:[ .,\u00A0]\d{3})+|\d{2,})\b/g)]
      .map((m) => parseInt(m[1].replace(/[ .,\u00A0]/g, ""), 10))
      .filter(Number.isFinite);

    if (matches.length) return Math.max(...matches);

    // Fallback: numbers immediately preceding 'review(s)' (captures single-digit counts)
    const mReviewWord = s.match(
      /\b(\d+)\b(?=\s*(?:user\s+)?reviews?\b)/i
    );
    if (mReviewWord) return parseInt(mReviewWord[1], 10);

    return null;
  }

  /**
   * Format integers with a SPACE as the thousands separator.
   * Example: 24323 -> "24 323"
   *
   * @param {number} n
   * @returns {string}
   */
  function formatNum(n) {
    const s = String(Math.trunc(Number(n) || 0));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  // ---------------------------------------------------------------------------
  // Seen Games Storage (localStorage)
  // ---------------------------------------------------------------------------

  const SEEN_GAMES_KEY = "reviewGuesser_seenGames";

  /**
   * Get all seen games data from localStorage.
   * @returns {Map<number, {appId: number, correct: boolean}>}
   */
  function getSeenGamesData() {
    try {
      const data = localStorage.getItem(SEEN_GAMES_KEY);
      if (!data) return new Map();
      const arr = JSON.parse(data);
      const map = new Map();
      
      for (const item of arr) {
        // Handle both old format (just numbers) and new format (objects)
        if (typeof item === "number") {
          map.set(item, { appId: item, correct: null });
        } else if (item && typeof item === "object" && Number.isFinite(item.appId)) {
          map.set(item.appId, { appId: item.appId, correct: item.correct });
        }
      }
      return map;
    } catch (e) {
      console.warn("[ext] Failed to read seen games from storage", e);
      return new Map();
    }
  }

  /**
   * Get the set of seen game IDs from localStorage.
   * @returns {Set<number>}
   */
  function getSeenGames() {
    const data = getSeenGamesData();
    return new Set(data.keys());
  }

  /**
   * Mark a game ID as seen with correctness info (store in localStorage).
   * @param {number|string} appId
   * @param {boolean} correct - Whether the guess was correct
   */
  function markGameAsSeen(appId, correct) {
    try {
      const id = Number(appId);
      if (!Number.isFinite(id)) return;
      const seen = getSeenGamesData();
      seen.set(id, { appId: id, correct: Boolean(correct) });
      localStorage.setItem(SEEN_GAMES_KEY, JSON.stringify([...seen.values()]));
    } catch (e) {
      console.warn("[ext] Failed to save seen game to storage", e);
    }
  }

  /**
   * Check if a game has been seen before.
   * @param {number|string} appId
   * @returns {boolean}
   */
  function hasSeenGame(appId) {
    const id = Number(appId);
    if (!Number.isFinite(id)) return false;
    return getSeenGames().has(id);
  }

  /**
   * Clear all seen games from storage.
   */
  function clearSeenGames() {
    try {
      localStorage.removeItem(SEEN_GAMES_KEY);
    } catch (e) {
      console.warn("[ext] Failed to clear seen games", e);
    }
  }

  // Expose on namespace
  ns.normalizeSpaces = normalizeSpaces;
  ns.parseReviewCountRaw = parseReviewCountRaw;
  ns.formatNum = formatNum;
  ns.getSeenGames = getSeenGames;
  ns.getSeenGamesData = getSeenGamesData;
  ns.markGameAsSeen = markGameAsSeen;
  ns.hasSeenGame = hasSeenGame;
  ns.clearSeenGames = clearSeenGames;
})(window);
