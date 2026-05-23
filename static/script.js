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
        alignedData = state.result || [];
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

  function getPhrases() {
    const phrases = [];
    let currentPhrase = null;
    for (const w of alignedData) {
      if (!currentPhrase || currentPhrase.text !== w.phrase) {
        currentPhrase = {
          text: w.phrase,
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

  function renderEditor() {
    editorTbody.innerHTML = "";
    for (let i = 0; i < alignedData.length; i++) {
      const w = alignedData[i];
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(w.word)}</td>
        <td class="editable" data-field="start_ms" data-index="${i}">${w.start_ms}</td>
        <td class="editable" data-field="end_ms" data-index="${i}">${w.end_ms}</td>
        <td>${escapeHtml(w.phrase)}</td>
      `;

      editorTbody.appendChild(tr);
    }

    editorTbody.querySelectorAll("td.editable").forEach((td) => {
      td.addEventListener("dblclick", () => {
        startEdit(td);
      });
    });
  }

  function startEdit(td) {
    const field = td.dataset.field;
    const index = parseInt(td.dataset.index, 10);
    const currentValue = alignedData[index][field];

    const input = document.createElement("input");
    input.type = "number";
    input.value = currentValue;
    input.min = "0";

    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();

    const finish = () => {
      const newValue = parseInt(input.value, 10);
      if (!isNaN(newValue) && newValue >= 0) {
        alignedData[index][field] = newValue;
        td.textContent = newValue;
        renderKaraoke();
      } else {
        td.textContent = currentValue;
      }
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") {
        td.textContent = currentValue;
      }
    });
  }

  downloadJson.addEventListener("click", () => {
    if (jobId) {
      window.open(`/api/download/${jobId}.json`, "_blank");
    }
  });

  downloadTxt.addEventListener("click", () => {
    if (jobId) {
      window.open(`/api/download/${jobId}.txt`, "_blank");
    }
  });

  downloadTxtB.addEventListener("click", () => {
    if (jobId) {
      window.open(`/api/download/${jobId}_b.txt`, "_blank");
    }
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
