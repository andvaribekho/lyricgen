(function () {
  let audioFile = null;
  let lyricsFile = null;
  let jobId = null;
  let alignedData = [];
  let eventSource = null;

  const audioInput = document.getElementById("audio-input");
  const lyricsInput = document.getElementById("lyrics-input");
  const dropAudio = document.getElementById("drop-audio");
  const dropLyrics = document.getElementById("drop-lyrics");
  const audioName = document.getElementById("audio-name");
  const lyricsName = document.getElementById("lyrics-name");
  const runBtn = document.getElementById("run-btn");
  const modelSelect = document.getElementById("model-select");
  const progressSection = document.getElementById("progress-section");
  const progressBar = document.getElementById("progress-bar");
  const progressMessage = document.getElementById("progress-message");
  const progressStatus = document.getElementById("progress-status");
  const karaokeSection = document.getElementById("karaoke-section");
  const karaokeDisplay = document.getElementById("karaoke-display");
  const currentTimeEl = document.getElementById("current-time");
  const audioPlayer = document.getElementById("audio-player");
  const editorSection = document.getElementById("editor-section");
  const editorTbody = document.getElementById("editor-tbody");
  const downloadJson = document.getElementById("download-json");
  const downloadTxt = document.getElementById("download-txt");
  const downloadTxtB = document.getElementById("download-txt-b");

  function setupDropZone(dropZone, input, nameEl, acceptType) {
    dropZone.addEventListener("click", () => input.click());

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        input.files = files;
        input.dispatchEvent(new Event("change"));
      }
    });

    input.addEventListener("change", () => {
      if (input.files.length > 0) {
        const file = input.files[0];
        nameEl.textContent = file.name;
        dropZone.classList.add("has-file");
        if (acceptType === "audio") {
          audioFile = file;
        } else {
          lyricsFile = file;
        }
      } else {
        nameEl.textContent = "";
        dropZone.classList.remove("has-file");
        if (acceptType === "audio") {
          audioFile = null;
        } else {
          lyricsFile = null;
        }
      }
      checkReady();
    });
  }

  setupDropZone(dropAudio, audioInput, audioName, "audio");
  setupDropZone(dropLyrics, lyricsInput, lyricsName, "lyrics");

  function checkReady() {
    runBtn.disabled = !(audioFile && lyricsFile);
  }

  runBtn.addEventListener("click", async () => {
    if (!audioFile || !lyricsFile) return;

    runBtn.disabled = true;
    runBtn.textContent = "Uploading...";

    const formData = new FormData();
    formData.append("audio", audioFile);
    formData.append("lyrics", lyricsFile);
    formData.append("model", modelSelect.value);

    try {
      const resp = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      jobId = data.job_id;

      progressSection.style.display = "block";
      runBtn.textContent = "Processing...";

      startProgressStream(jobId);
    } catch (err) {
      runBtn.textContent = "Run Alignment";
      runBtn.disabled = false;
      alert("Upload failed: " + err.message);
    }
  });

  function startProgressStream(jobId) {
    if (eventSource) {
      eventSource.close();
    }
    eventSource = new EventSource(`/api/progress/${jobId}`);

    eventSource.onmessage = (event) => {
      const state = JSON.parse(event.data);
      progressBar.style.width = state.progress + "%";
      progressMessage.textContent = state.message;

      if (state.status === "downloading_model") {
        progressStatus.textContent = "Downloading Whisper model...";
      } else if (state.status === "transcribing") {
        progressStatus.textContent = "Processing audio with Whisper...";
      } else if (state.status === "aligning") {
        progressStatus.textContent = "Matching lyrics to audio...";
      } else if (state.status === "complete") {
        progressStatus.textContent = "Done!";
        eventSource.close();
        alignedData = hydratePhraseGroups(state.result || []);
        showResults();
        runBtn.textContent = "Run Again";
        runBtn.disabled = false;
      } else if (state.status === "error") {
        progressStatus.textContent = state.message;
        progressStatus.style.color = "#ff6b9d";
        eventSource.close();
        runBtn.textContent = "Run Alignment";
        runBtn.disabled = false;
        alert(state.message);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };
  }

  function showResults() {
    renderKaraoke();
    renderEditor();
    karaokeSection.style.display = "block";
    editorSection.style.display = "block";

    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      audioPlayer.src = url;
      audioPlayer.addEventListener("loadedmetadata", () => {
        audioPlayer.play();
      });
    }
  }

  function hydratePhraseGroups(words) {
    const phraseToGroup = new Map();
    let nextGroup = 1;

    return words.map((word) => {
      if (!phraseToGroup.has(word.phrase)) {
        phraseToGroup.set(word.phrase, nextGroup);
        nextGroup += 1;
      }
      return {
        ...word,
        phrase_group: phraseToGroup.get(word.phrase),
      };
    });
  }

  function getPhrases() {
    const phrases = [];
    let currentPhrase = null;
    for (const w of alignedData) {
      const group = getGroupId(w);
      if (!currentPhrase || currentPhrase.group !== group) {
        currentPhrase = {
          text: w.phrase,
          group,
          words: [],
          startMs: w.start_ms,
          endMs: w.end_ms,
        };
        phrases.push(currentPhrase);
      }
      currentPhrase.words.push(w);
      currentPhrase.endMs = w.end_ms;
    }
    return phrases;
  }

  let phraseEls = [];

  function renderKaraoke() {
    const phrases = getPhrases();
    karaokeDisplay.innerHTML = "";
    phraseEls = [];

    for (const phrase of phrases) {
      const phraseEl = document.createElement("span");
      phraseEl.className = "karaoke-phrase";
      phraseEl.style.display = "none";
      phraseEl.dataset.startMs = phrase.startMs;
      phraseEl.dataset.endMs = phrase.endMs;

      for (const w of phrase.words) {
        const wordEl = document.createElement("span");
        wordEl.className = "karaoke-word";
        wordEl.textContent = w.word;
        wordEl.dataset.startMs = w.start_ms;
        wordEl.dataset.endMs = w.end_ms;

        const space = document.createTextNode(" ");
        phraseEl.appendChild(wordEl);
        phraseEl.appendChild(space);
      }

      karaokeDisplay.appendChild(phraseEl);
      phraseEls.push(phraseEl);
    }
  }

  audioPlayer.addEventListener("timeupdate", () => {
    const currentMs = audioPlayer.currentTime * 1000;
    currentTimeEl.textContent = Math.round(currentMs) + " ms";
    let activePhrase = null;
    let activeIdx = -1;

    for (let i = 0; i < phraseEls.length; i++) {
      const phraseEl = phraseEls[i];
      const start = parseInt(phraseEl.dataset.startMs, 10);
      const end = parseInt(phraseEl.dataset.endMs, 10);
      if (currentMs >= start && currentMs <= end) {
        activePhrase = phraseEl;
        activeIdx = i;
      }
    }

    if (activePhrase) {
      activePhrase.style.display = "";
      activePhrase.classList.add("active");

      for (let i = 0; i < phraseEls.length; i++) {
        if (i !== activeIdx) {
          phraseEls[i].style.display = "none";
          phraseEls[i].classList.remove("active");
        }
      }

      const wordEls = activePhrase.querySelectorAll(".karaoke-word");
      for (const wordEl of wordEls) {
        const wStart = parseInt(wordEl.dataset.startMs, 10);
        const wEnd = parseInt(wordEl.dataset.endMs, 10);

        wordEl.classList.remove("active-word", "sung-word");
        if (currentMs >= wStart && currentMs <= wEnd) {
          wordEl.classList.add("active-word");
        } else if (currentMs > wEnd) {
          wordEl.classList.add("sung-word");
        }
      }
    } else {
      for (const phraseEl of phraseEls) {
        phraseEl.style.display = "none";
        phraseEl.classList.remove("active");
      }
    }
  });

  function getPhraseGroups() {
    const map = {};
    const order = [];
    for (const w of alignedData) {
      const group = Number(w.phrase_group) || 1;
      if (!(group in map)) {
        order.push(group);
        map[group] = group;
      }
    }
    return { map, order };
  }

  function getGroupId(word) {
    return Number(word.phrase_group) || 1;
  }

  function renderEditor() {
    editorTbody.innerHTML = "";

    function addInsertRow(afterIndex) {
      const insertTr = document.createElement("tr");
      insertTr.className = "insert-row";
      insertTr.innerHTML = `
        <td colspan="7">
          <button class="insert-btn" data-after="${afterIndex}">+ insert word</button>
        </td>
      `;
      insertTr.querySelector(".insert-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        insertWordAfter(afterIndex);
      });
      editorTbody.appendChild(insertTr);
    }

    addInsertRow(-1);

    for (let i = 0; i < alignedData.length; i++) {
      const w = alignedData[i];
      const groupId = getGroupId(w);
      const tr = document.createElement("tr");
      tr.className = "word-row";
      tr.dataset.index = i;

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="editable" data-field="word" data-index="${i}">${escapeHtml(w.word)}</td>
        <td class="editable" data-field="start_ms" data-index="${i}">${w.start_ms}</td>
        <td class="editable" data-field="end_ms" data-index="${i}">${w.end_ms}</td>
        <td class="editable" data-field="phrase_group" data-index="${i}">@${groupId}</td>
        <td><button class="shift-grp-btn" data-index="${i}">GRP+1</button></td>
        <td><button class="delete-word-btn" data-index="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></td>
      `;

      tr.querySelector(".shift-grp-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        shiftGroupsDown(i);
      });

      tr.querySelector(".delete-word-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        showDeleteConfirm(i, e.currentTarget);
      });

      let clickTimer = null;
      tr.addEventListener("click", (e) => {
        if (e.target.closest("input") || e.target.closest("button")) return;
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          return;
        }
        clickTimer = setTimeout(() => {
          clickTimer = null;
          audioPlayer.currentTime = alignedData[i].start_ms / 1000;
        }, 220);
      });

      tr.addEventListener("dblclick", (e) => {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
        }
      });

      editorTbody.appendChild(tr);
      addInsertRow(i);
    }

    editorTbody.querySelectorAll("td.editable").forEach((td) => {
      td.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startEdit(td);
      });
    });
  }

  function shiftGroupsDown(fromIndex) {
    for (let i = fromIndex; i < alignedData.length; i++) {
      alignedData[i].phrase_group = getGroupId(alignedData[i]) + 1;
    }

    renderKaraoke();
    renderEditor();
  }

  function showDeleteConfirm(index, button) {
    editorTbody.querySelectorAll(".delete-confirm").forEach((el) => el.remove());

    const cell = button.closest("td");
    const confirmEl = document.createElement("div");
    confirmEl.className = "delete-confirm";
    confirmEl.innerHTML = `
      <span>Delete word?</span>
      <button class="delete-confirm-yes">Yes</button>
      <button class="delete-confirm-no">No</button>
    `;

    confirmEl.querySelector(".delete-confirm-yes").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteWord(index);
    });

    confirmEl.querySelector(".delete-confirm-no").addEventListener("click", (e) => {
      e.stopPropagation();
      confirmEl.remove();
    });

    cell.appendChild(confirmEl);
  }

  function deleteWord(index) {
    alignedData.splice(index, 1);
    renderKaraoke();
    renderEditor();
  }

  function insertWordAfter(afterIndex) {
    let prevEnd = 0;
    let nextStart = 0;

    if (afterIndex >= 0) {
      prevEnd = alignedData[afterIndex].end_ms;
    }
    if (afterIndex + 1 < alignedData.length) {
      nextStart = alignedData[afterIndex + 1].start_ms;
    }

    let startMs, endMs;
    if (prevEnd > 0 && nextStart > 0) {
      const mid = Math.round((prevEnd + nextStart) / 2);
      startMs = mid;
      endMs = mid;
    } else if (prevEnd > 0) {
      startMs = prevEnd;
      endMs = prevEnd + 100;
    } else if (nextStart > 0) {
      startMs = Math.max(0, nextStart - 100);
      endMs = nextStart;
    } else {
      startMs = 0;
      endMs = 100;
    }

    const newWord = {
      start_ms: startMs,
      end_ms: endMs,
      word: "",
      phrase: alignedData[afterIndex]?.phrase || alignedData[0]?.phrase || "",
      phrase_group: alignedData[afterIndex]
        ? getGroupId(alignedData[afterIndex])
        : alignedData[0]
          ? getGroupId(alignedData[0])
          : 1,
    };

    const insertIdx = afterIndex + 1;
    alignedData.splice(insertIdx, 0, newWord);
    renderKaraoke();
    renderEditor();

    const wordTd = editorTbody.querySelector(`td.editable[data-field="word"][data-index="${insertIdx}"]`);
    if (wordTd) {
      startEdit(wordTd);
    }
  }

  function startEdit(td) {
    const field = td.dataset.field;
    const index = parseInt(td.dataset.index, 10);
    const originalText = td.textContent;
    let currentValue;

    if (field === "phrase_group") {
      currentValue = getGroupId(alignedData[index]);
    } else {
      currentValue = alignedData[index][field];
    }

    const isText = field === "word" || field === "phrase_group";

    const input = document.createElement("input");
    input.type = isText ? "text" : "number";
    input.value = currentValue;
    if (!isText) input.min = "0";

    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();

    const finish = () => {
      const raw = input.value.trim();
      if (field === "phrase_group") {
        const newGroupId = parseInt(raw, 10);
        if (!isNaN(newGroupId) && newGroupId > 0) {
          alignedData[index].phrase_group = newGroupId;
        }
      } else if (field === "word") {
        alignedData[index][field] = raw || currentValue;
      } else {
        const newValue = parseInt(raw, 10);
        if (!isNaN(newValue) && newValue >= 0) {
          alignedData[index][field] = newValue;
        }
      }
      renderKaraoke();
      renderEditor();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") {
        td.textContent = originalText;
      }
    });
  }

  downloadJson.addEventListener("click", () => {
    const data = alignedData.map((w) => ({
      start_ms: w.start_ms,
      end_ms: w.end_ms,
      word: w.word,
      phrase: w.phrase,
      phrase_group: getGroupId(w),
    }));
    downloadTextFile(
      JSON.stringify(data, null, 2),
      `lyric_alignment_${jobId || "edited"}.json`,
      "application/json"
    );
  });

  downloadTxt.addEventListener("click", () => {
    const lines = alignedData.map((w) => {
      return `[${w.start_ms}ms -> ${w.end_ms}ms] ${w.word} (group: @${getGroupId(w)})`;
    });
    downloadTextFile(
      lines.join("\n") + "\n",
      `lyric_alignment_${jobId || "edited"}.txt`,
      "text/plain"
    );
  });

  downloadTxtB.addEventListener("click", () => {
    const lines = ["# format: words-guided"];
    for (const w of alignedData) {
      lines.push(`${w.start_ms} ${w.end_ms} @${getGroupId(w)} ${w.word}`);
    }
    downloadTextFile(
      lines.join("\n") + "\n",
      `lyric_alignment_${jobId || "edited"}_b.txt`,
      "text/plain"
    );
  });

  function downloadTextFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (audioPlayer.paused) {
        audioPlayer.play();
      } else {
        audioPlayer.pause();
      }
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 0.5);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      audioPlayer.currentTime = Math.min(audioPlayer.duration || Infinity, audioPlayer.currentTime + 0.5);
    }
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
