const fileInput = document.getElementById('audio-file');
const dropZone = document.getElementById('drop-zone');
const metadataList = document.getElementById('metadata-list');
const waveformCanvas = document.getElementById('waveform-canvas');
const spectrumCanvas = document.getElementById('spectrum-canvas');
const durationValue = document.getElementById('duration-value');
const tempoValue = document.getElementById('tempo-value');
const loudnessValue = document.getElementById('loudness-value');
const colorValue = document.getElementById('color-value');
const moodValue = document.getElementById('mood-value');
const waveformCtx = waveformCanvas.getContext('2d');
const spectrumCtx = spectrumCanvas.getContext('2d');
let audioContext;

function highlightZone(enable) {
  dropZone.classList.toggle('dragover', enable);
}

dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  highlightZone(true);
});

['dragover', 'dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => event.preventDefault());
});

dropZone.addEventListener('dragleave', () => highlightZone(false));

dropZone.addEventListener('drop', (event) => {
  highlightZone(false);
  const file = event.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.type.startsWith('audio/')) {
    alert('오디오 파일을 업로드해주세요.');
    return;
  }

  initAudioContext();
  metadataList.innerHTML = '<li>파일 분석 중...</li>';
  moodValue.textContent = '음악의 감성과 리듬을 추출하고 있습니다...';
  durationValue.textContent = '--:--';
  tempoValue.textContent = '--';
  loudnessValue.textContent = '-- dB';
  colorValue.textContent = '--';

  const [metadata, audioBuffer] = await Promise.all([
    extractMetadata(file),
    decodeAudio(file)
  ]);

  renderMetadata(metadata, audioBuffer, file);
  renderSummary(audioBuffer, metadata);
  renderWaveform(audioBuffer);
  renderSpectrum(audioBuffer);
}

function initAudioContext() {
  if (audioContext && audioContext.state !== 'closed') return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

async function extractMetadata(file) {
  try {
    const metadata = await window.musicMetadata.parseBlob(file);
    return metadata;
  } catch (error) {
    return null;
  }
}

async function decodeAudio(file) {
  const arrayBuffer = await file.arrayBuffer();
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch (error) {
    return await new Promise((resolve, reject) => {
      audioContext.decodeAudioData(arrayBuffer, resolve, reject);
    });
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function renderMetadata(metadata, audioBuffer, file) {
  const common = metadata?.common || {};
  const format = metadata?.format || {};
  const items = [
    ['파일 이름', file.name],
    ['파일 크기', `${(file.size / 1024 / 1024).toFixed(2)} MB`],
    ['길이', formatTime(audioBuffer.duration)],
    ['샘플레이트', `${audioBuffer.sampleRate} Hz`],
    ['채널 수', audioBuffer.numberOfChannels],
    ['코덱', format.codec || '알 수 없음'],
    ['제목', common.title || '알 수 없음'],
    ['아티스트', common.artist || '알 수 없음'],
    ['앨범', common.album || '알 수 없음'],
    ['장르', (common.genre || ['알 수 없음']).join(', ')],
  ];

  metadataList.innerHTML = items.map(([label, value]) => `<li><strong>${label}</strong><span>${value}</span></li>`).join('');
}

function renderSummary(audioBuffer, metadata) {
  const samples = flattenAudio(audioBuffer);
  const loudness = computeLoudness(samples);
  const tempo = estimateTempo(samples, audioBuffer.sampleRate);
  const pitch = detectDominantPitch(samples, audioBuffer.sampleRate);
  const colorText = pitch ? `${pitch.note} (${pitch.frequency.toFixed(1)} Hz)` : '감지 불가';
  const mood = estimateMood(loudness, tempo, metadata);

  durationValue.textContent = formatTime(audioBuffer.duration);
  tempoValue.textContent = tempo ? `${Math.round(tempo)}` : '자동 감지 실패';
  loudnessValue.textContent = `${Math.round(loudness)} dB`;
  colorValue.textContent = colorText;
  moodValue.textContent = mood;
}

function flattenAudio(buffer) {
  const channelData = buffer.getChannelData(0);
  return channelData;
}

function computeLoudness(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return -20 * Math.log10(rms + 1e-12);
}

function estimateTempo(samples, sampleRate) {
  const segment = makeEnvelope(samples, sampleRate);
  const peakIntervals = findPeakIntervals(segment, sampleRate);
  if (!peakIntervals.length) return null;
  const averageMs = peakIntervals.reduce((sum, value) => sum + value, 0) / peakIntervals.length;
  const bpm = 60000 / averageMs;
  return bpm;
}

function makeEnvelope(samples, sampleRate) {
  const frameSize = Math.floor(sampleRate * 0.050);
  const envelope = [];
  for (let i = 0; i < samples.length; i += frameSize) {
    let sum = 0;
    for (let j = i; j < i + frameSize && j < samples.length; j++) {
      sum += Math.abs(samples[j]);
    }
    envelope.push(sum / frameSize);
  }
  return envelope;
}

function findPeakIntervals(envelope, sampleRate) {
  const intervals = [];
  let lastPeak = null;
  const threshold = Math.max(...envelope) * 0.35;
  envelope.forEach((value, index) => {
    if (value > threshold && envelope[index] === Math.max(envelope[index - 1] || 0, value, envelope[index + 1] || 0)) {
      const currentTime = index * 0.05 * 1000;
      if (lastPeak) {
        intervals.push(currentTime - lastPeak);
      }
      lastPeak = currentTime;
    }
  });
  return intervals.filter((interval) => interval > 150 && interval < 1500);
}

function detectDominantPitch(samples, sampleRate) {
  const fftSize = 2048;
  const chunk = samples.slice(0, fftSize);
  if (chunk.length < fftSize) return null;
  const frequencies = computeSpectrum(chunk, sampleRate);
  const peakIndex = frequencies.values.reduce((best, current, index) => current > frequencies.values[best] ? index : best, 0);
  const dominantFreq = frequencies.binSize * peakIndex;
  const note = frequencyToNote(dominantFreq);
  return { frequency: dominantFreq, note };
}

function frequencyToNote(freq) {
  if (!freq || freq <= 0) return '알 수 없음';
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const semitone = Math.round(12 * Math.log2(freq / 440) + 69);
  const note = noteNames[((semitone % 12) + 12) % 12];
  const octave = Math.floor(semitone / 12) - 1;
  return `${note}${octave}`;
}

function estimateMood(loudness, tempo, metadata) {
  const energy = loudness < -24 ? '부드러운' : loudness < -12 ? '활기찬' : '강렬한';
  const pace = tempo < 90 ? '느긋한' : tempo < 130 ? '리드미컬한' : '빠르게 흥분되는';
  const artist = metadata?.common?.artist ? `${metadata.common.artist}` : '';
  return `${energy} 리듬과 ${pace} 움직임을 지닌 음악입니다. ${artist ? `${artist}의 음악을 더욱 섬세하게 들려드립니다.` : ''}`;
}

function renderWaveform(buffer) {
  const samples = flattenAudio(buffer);
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  const step = Math.ceil(samples.length / width);
  const waveform = new Array(width).fill(0);

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let j = 0; j < step; j++) {
      const index = x * step + j;
      if (index < samples.length) sum += Math.abs(samples[index]);
    }
    waveform[x] = sum / step;
  }

  waveformCtx.clearRect(0, 0, width, height);
  const gradient = waveformCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(124, 140, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(86, 255, 202, 0.35)');

  waveformCtx.fillStyle = 'rgba(255,255,255,0.04)';
  waveformCtx.fillRect(0, 0, width, height);
  waveformCtx.lineWidth = 1.5;
  waveformCtx.strokeStyle = gradient;
  waveformCtx.beginPath();
  waveform.forEach((value, index) => {
    const y = height - value * height * 2.2;
    if (index === 0) waveformCtx.moveTo(index, y);
    else waveformCtx.lineTo(index, y);
  });
  waveformCtx.stroke();
}

function renderSpectrum(buffer) {
  const samples = flattenAudio(buffer);
  const spectrum = computeSpectrum(samples, buffer.sampleRate);
  const width = spectrumCanvas.width;
  const height = spectrumCanvas.height;
  const barCount = 120;
  const slice = Math.max(1, Math.floor(spectrum.values.length / barCount));

  spectrumCtx.clearRect(0, 0, width, height);
  spectrumCtx.fillStyle = 'rgba(255,255,255,0.05)';
  spectrumCtx.fillRect(0, 0, width, height);

  const gradient = spectrumCtx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#7c8cff');
  gradient.addColorStop(0.5, '#78fff9');
  gradient.addColorStop(1, '#ff93c1');
  const barWidth = Math.max(2, width / barCount - 4);

  for (let i = 0; i < barCount; i++) {
    const start = i * slice;
    const end = Math.min(start + slice, spectrum.values.length);
    const value = spectrum.values.slice(start, end).reduce((sum, val) => sum + val, 0) / Math.max(1, end - start);
    const barHeight = Math.min(height, value * height * 0.95);
    const x = i * (barWidth + 4) + 6;
    spectrumCtx.fillStyle = gradient;
    spectrumCtx.fillRect(x, height - barHeight, barWidth, barHeight);
  }
}

function computeSpectrum(samples, sampleRate) {
  const N = 4096;
  const input = applyHannWindow(samples.slice(0, N));
  const values = new Float32Array(N / 2);
  const binSize = sampleRate / N;

  for (let k = 0; k < N / 2; k++) {
    let real = 0;
    let imag = 0;
    const phaseStep = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      const sample = input[n] || 0;
      const angle = phaseStep * n;
      real += sample * Math.cos(angle);
      imag -= sample * Math.sin(angle);
    }
    values[k] = Math.sqrt(real * real + imag * imag) / N;
  }

  const normalized = new Float32Array(N / 2);
  let maxValue = 0;
  for (let i = 0; i < values.length; i++) {
    maxValue = Math.max(maxValue, values[i]);
  }
  maxValue = Math.max(maxValue, 1e-8);
  for (let i = 0; i < values.length; i++) {
    normalized[i] = Math.min(1, values[i] / maxValue) * 255;
  }

  return { values: normalized, binSize };
}

function applyHannWindow(samples) {
  const windowed = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (samples.length - 1)));
    windowed[i] = samples[i] * multiplier;
  }
  return windowed;
}
