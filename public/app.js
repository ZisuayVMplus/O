(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const pasteArea = document.getElementById('pasteArea');
  const obfuscateBtn = document.getElementById('obfuscateBtn');
  const statusText = document.getElementById('statusText');
  const resultBlock = document.getElementById('resultBlock');
  const resultSummary = document.getElementById('resultSummary');
  const outputCode = document.getElementById('outputCode');
  const downloadBtn = document.getElementById('downloadBtn');
  const dropzoneContent = document.getElementById('dropzoneContent');

  let sourceName = 'script.lua';
  let sourceCode = '';
  let outputResult = '';

  function setSource(code, name) {
    sourceCode = code;
    if (name) sourceName = name;
    obfuscateBtn.disabled = sourceCode.trim().length === 0;
    statusText.textContent = '';
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result), file.name);
      pasteArea.value = String(reader.result);
      dropzoneContent.querySelector('p strong').textContent = file.name;
    };
    reader.onerror = () => {
      statusText.textContent = 'อ่านไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง';
    };
    reader.readAsText(file);
  }

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => readFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    readFile(file);
  });

  pasteArea.addEventListener('input', () => {
    setSource(pasteArea.value);
  });

  obfuscateBtn.addEventListener('click', () => {
    const code = pasteArea.value.trim().length ? pasteArea.value : sourceCode;
    if (!code.trim()) return;
    statusText.textContent = 'กำลังเข้ารหัส...';
    obfuscateBtn.disabled = true;

    setTimeout(() => {
      try {
        const { code: obf, count } = RoLock.run(code);
        outputResult = obf;
        outputCode.textContent = obf;
        resultSummary.innerHTML = `เข้ารหัสสำเร็จ — แทนที่ <strong>${count}</strong> string literal`;
        resultBlock.hidden = false;
        statusText.textContent = '';
        resultBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        statusText.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
      } finally {
        obfuscateBtn.disabled = false;
      }
    }, 120);
  });

  downloadBtn.addEventListener('click', () => {
    if (!outputResult) return;
    const base = sourceName.replace(/\.(lua|luau|txt)$/i, '');
    const ext = /\.luau$/i.test(sourceName) ? 'luau' : 'lua';
    const blob = new Blob([outputResult], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.obf.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
