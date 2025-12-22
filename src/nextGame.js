(function (root) {
  const ns = (root.ReviewGuesser = root.ReviewGuesser || {});

  // Access seen games utilities
  const getSeenGames = ns.getSeenGames;
  const getSeenGamesData = ns.getSeenGamesData;

  // ---------------------------------------------------------------------------
  // CSV loading + caching
  // ---------------------------------------------------------------------------

  // All batch files used for "Smart Random"
  const BATCH_FILES = [
    "data/Batch_1.csv",
    "data/Batch_2.csv",
    "data/Batch_3.csv",
    "data/Batch_4.csv",
    "data/Batch_5.csv",
    "data/Batch_6.csv"
  ];

  // Simple in-memory cache: path -> Promise<number[]>
  const CSV_CACHE = Object.create(null);

  /**
   * Load a CSV file and parse it into an array of app IDs (numbers).
   * Results are cached per-path so each file is only fetched once.
   *
   * @param {string} relativePath - e.g. "data/released_appids.csv"
   * @returns {Promise<number[]>}
   */
  function loadCsvIds(relativePath) {
    if (CSV_CACHE[relativePath]) {
      return CSV_CACHE[relativePath];
    }

    const url =
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.getURL
        ? chrome.runtime.getURL(relativePath)
        : relativePath;

    CSV_CACHE[relativePath] = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("CSV fetch failed: " + r.status);
        return r.text();
      })
      .then((text) => {
        return text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => /^\d+$/.test(s))
          .map((s) => parseInt(s, 10));
      })
      .catch((err) => {
        console.warn("[ext] failed to load CSV", relativePath, err);
        return [];
      });

    return CSV_CACHE[relativePath];
  }

  /**
   * Existing behavior: full released app id list (for Pure Random).
   *
   * @returns {Promise<number[]>}
   */
  async function getReleasedAppIds() {
    // NOTE: we assume you placed this file at data/released_appids.csv
    return loadCsvIds("data/released_appids.csv");
  }

  /**
   * Helper to pick a random element from an array of app IDs,
   * excluding any that have been seen before.
   *
   * @param {number[]} ids
   * @returns {number|null}
   */
  function pickRandomId(ids) {
    if (!ids || !ids.length) return null;
    
    // Filter out seen games
    const seenGames = getSeenGames();
    const unseenIds = ids.filter((id) => !seenGames.has(id));
    
    // If all games have been seen, return null to signal exhaustion
    if (!unseenIds.length) {
      console.log("[ext] All games in this list have been seen!");
      return null;
    }
    
    const idx = Math.floor(Math.random() * unseenIds.length);
    return unseenIds[idx];
  }

  /**
   * "Pure Random" strategy: pick from the global released_appids list.
   *
   * @returns {Promise<number|null>}
   */
  async function getPureRandomAppId() {
    const ids = await getReleasedAppIds();
    return pickRandomId(ids);
  }

  /**
   * "Smart Random" strategy:
   *   - pick a random batch CSV (Batch_1..Batch_6)
   *   - load IDs from that file
   *   - pick a random app id from that batch (excluding seen games)
   *   - if the batch is exhausted, try other batches
   *   - if all batches exhausted → fall back to Pure Random
   *
   * @returns {Promise<number|null>}
   */
  async function getSmartRandomAppId() {
    if (!BATCH_FILES.length) return getPureRandomAppId();

    // Shuffle batch files to try them in random order
    const shuffledBatches = [...BATCH_FILES].sort(() => Math.random() - 0.5);
    
    for (const file of shuffledBatches) {
      const ids = await loadCsvIds(file);
      const id = pickRandomId(ids);
      if (id != null) return id;
    }

    // Fallback to Pure Random if all batches are exhausted
    return getPureRandomAppId();
  }

  /**
   * Resolve a random app id based on mode ("pure" | "smart"),
   * and navigate to that app on the Steam store.
   *
   * @param {"pure"|"smart"} mode
   */
  async function navigateToRandomApp(mode) {
    let appid = null;

    if (mode === "smart") {
      appid = await getSmartRandomAppId();
    } else {
      appid = await getPureRandomAppId();
    }

    if (!appid) {
      // Fallback: Dota 2, in case everything fails
      appid = 570;
    }

    window.location.assign(
      `https://store.steampowered.com/app/${appid}/`
    );
  }

  /**
   * Create a "Next Game" button with the given label and strategy.
   *
   * @param {string} label - Button text ("Pure Random" / "Smart Random")
   * @param {"pure"|"smart"} mode
   * @returns {HTMLAnchorElement}
   */
  function makeNextGameButton(label, mode) {
    const a = document.createElement("a");
    a.className = "btnv6_blue_hoverfade btn_medium ext-next-game";
    a.href = "#";

    const span = document.createElement("span");
    span.textContent = label;
    a.appendChild(span);

    a.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        navigateToRandomApp(mode);
      },
      { passive: false }
    );

    return a;
  }

  // ---------------------------------------------------------------------------
  // Oops / region-locked page: header button(s)
  // ---------------------------------------------------------------------------

  function installNextGameButtonOnOops() {
    const header = document.querySelector(
      ".page_header_ctn .page_content"
    );
    if (!header) return;

    // Avoid duplicates – if we already placed any ext-next-game, stop.
    if (header.querySelector(".ext-next-game")) return;

    const target =
      header.querySelector("h2.pageheader") || header;

    // Wrap both buttons in a simple row
    const pureBtn = makeNextGameButton("Next (Raw)", "pure");
    const smartBtn = makeNextGameButton("Next (Balanced)", "smart");
    const exportBtn = makeExportSeenGamesButton();
    const importBtn = makeImportSeenGamesButton();

    const row = document.createElement("div");
    row.style.marginTop = "10px";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.appendChild(pureBtn);
    row.appendChild(smartBtn);
    row.appendChild(exportBtn);
    row.appendChild(importBtn);

    if (target && target.parentElement) {
      target.insertAdjacentElement("afterend", row);
    } else {
      header.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------------
  // Normal app page: replace Community Hub with two buttons
  // ---------------------------------------------------------------------------

  function installNextGameButton() {
    const container = document.querySelector(
      ".apphub_HomeHeaderContent .apphub_OtherSiteInfo"
    );
    if (!container) return;

    // Avoid duplicates
    if (container.querySelector(".ext-next-game")) return;

    // Remove the original Community Hub button, if present
    const hubBtn = container.querySelector(
      "a.btnv6_blue_hoverfade.btn_medium"
    );
    if (hubBtn) hubBtn.remove();

    const pureBtn = makeNextGameButton("Next (Raw)", "pure");
    const smartBtn = makeNextGameButton("Next (Balanced)", "smart");
    const exportBtn = makeExportSeenGamesButton();
    const importBtn = makeImportSeenGamesButton();

    // Let Steam's layout handle positioning; just drop them in order
    container.appendChild(pureBtn);
    container.appendChild(smartBtn);
    container.appendChild(exportBtn);
    container.appendChild(importBtn);
  }

  // ---------------------------------------------------------------------------
  // Export Seen Games button
  // ---------------------------------------------------------------------------

  /**
   * Create a button that exports all seen game IDs as a text file.
   *
   * @returns {HTMLAnchorElement}
   */
  function makeExportSeenGamesButton() {
    const a = document.createElement("a");
    a.className = "btnv6_blue_hoverfade btn_medium ext-export-seen";
    a.href = "#";

    const span = document.createElement("span");
    span.textContent = "Export Seen";
    a.appendChild(span);

    a.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        exportSeenGames();
      },
      { passive: false }
    );

    return a;
  }

  /**
   * Export all seen games data as a downloadable CSV file.
   * Format: appId,correct,timestamp
   * correct = 1 for correct, 0 for wrong, ? for unknown/legacy
   * timestamp = ISO date string or empty for legacy entries
   */
  function exportSeenGames() {
    const seenGamesData = getSeenGamesData();
    const entries = [...seenGamesData.values()].sort((a, b) => a.appId - b.appId);
    
    if (entries.length === 0) {
      alert("No games have been seen yet!");
      return;
    }

    // Header line + data lines
    const lines = ["appId,correct,timestamp"];
    for (const entry of entries) {
      const correctStr = entry.correct === true ? "1" : entry.correct === false ? "0" : "?";
      const timestampStr = entry.timestamp ? new Date(entry.timestamp).toISOString() : "";
      lines.push(`${entry.appId},${correctStr},${timestampStr}`);
    }

    const content = lines.join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `steam-review-guesser-seen-games-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Import Seen Games button
  // ---------------------------------------------------------------------------

  /**
   * Create a button that imports seen game IDs from a CSV file.
   *
   * @returns {HTMLAnchorElement}
   */
  function makeImportSeenGamesButton() {
    const a = document.createElement("a");
    a.className = "btnv6_blue_hoverfade btn_medium ext-import-seen";
    a.href = "#";

    const span = document.createElement("span");
    span.textContent = "Import Seen";
    a.appendChild(span);

    a.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Create file input dynamically each time to avoid DOM issues
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".csv,text/csv";
        fileInput.style.cssText = "position:absolute;left:-9999px;opacity:0;";
        document.body.appendChild(fileInput);

        fileInput.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          if (file) {
            importSeenGames(file);
          }
          // Clean up
          document.body.removeChild(fileInput);
        });

        // Also clean up if user cancels
        fileInput.addEventListener("cancel", () => {
          document.body.removeChild(fileInput);
        });

        // Trigger the file picker
        fileInput.click();
      },
      { passive: false }
    );

    return a;
  }

  /**
   * Import seen games data from a CSV file.
   * Merges with existing data (existing entries are preserved, new entries are added).
   * Format expected: appId,correct,timestamp (with header line)
   *
   * @param {File} file
   */
  function importSeenGames(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

        if (lines.length === 0) {
          alert("The CSV file is empty.");
          return;
        }

        // Check if first line is a header
        const firstLine = lines[0].toLowerCase();
        const hasHeader = firstLine.includes("appid") || firstLine.includes("correct") || firstLine.includes("timestamp");
        const dataLines = hasHeader ? lines.slice(1) : lines;

        if (dataLines.length === 0) {
          alert("No data found in CSV file (only header).");
          return;
        }

        // Get existing data
        const existingData = getSeenGamesData();
        let importedCount = 0;
        let skippedCount = 0;

        for (const line of dataLines) {
          const parts = line.split(",");
          if (parts.length === 0) continue;

          const appIdStr = parts[0].trim();
          const appId = parseInt(appIdStr, 10);

          if (!Number.isFinite(appId) || appId <= 0) {
            skippedCount++;
            continue;
          }

          // Parse correct field (1=true, 0=false, ?/empty=null)
          let correct = null;
          if (parts.length > 1) {
            const correctStr = parts[1].trim();
            if (correctStr === "1") correct = true;
            else if (correctStr === "0") correct = false;
          }

          // Parse timestamp field
          let timestamp = null;
          if (parts.length > 2) {
            const timestampStr = parts[2].trim();
            if (timestampStr) {
              const parsed = Date.parse(timestampStr);
              if (Number.isFinite(parsed)) {
                timestamp = parsed;
              }
            }
          }

          // Only add if not already existing (don't overwrite)
          if (!existingData.has(appId)) {
            existingData.set(appId, {
              appId: appId,
              correct: correct,
              timestamp: timestamp
            });
            importedCount++;
          } else {
            skippedCount++;
          }
        }

        // Save merged data
        const SEEN_GAMES_KEY = "reviewGuesser_seenGames";
        localStorage.setItem(SEEN_GAMES_KEY, JSON.stringify([...existingData.values()]));

        alert(`Import complete!\n\nImported: ${importedCount} games\nSkipped (already seen or invalid): ${skippedCount}`);
      } catch (err) {
        console.error("[ext] Failed to import CSV", err);
        alert("Failed to import CSV file. Please check the file format.");
      }
    };

    reader.onerror = () => {
      alert("Failed to read the file.");
    };

    reader.readAsText(file);
  }

  // Expose on namespace
  ns.getReleasedAppIds = getReleasedAppIds;
  ns.installNextGameButtonOnOops = installNextGameButtonOnOops;
  ns.installNextGameButton = installNextGameButton;
  ns.exportSeenGames = exportSeenGames;
  ns.importSeenGames = importSeenGames;
})(window);
