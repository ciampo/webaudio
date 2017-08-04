const wireCtrl = (ctrlId, param) => {
  const ctrl = document.getElementById(ctrlId);
  ctrl.addEventListener('input', _ => {
    param['value'] = ctrl.value;
  });
  param['value'] = ctrl.value
};


////////////////////////////////////////////////////////////////////////////////
// AUDIO
////////////////////////////////////////////////////////////////////////////////
const audioCtx = new AudioContext();
const nyquist = audioCtx.sampleRate / 2;
// Source
const audioMediaEL = new Audio('beats-90bpm.mp3');
audioMediaEL.autoplay = true;
audioMediaEL.loop = true;
const audioSource = audioCtx.createMediaElementSource(audioMediaEL);

// Lowpass filter
const lowPass = audioCtx.createBiquadFilter();
lowPass.type = 'lowpass';
wireCtrl('lowpass', lowPass.frequency);


// Gain
const gainNode = audioCtx.createGain();
wireCtrl('volume', gainNode.gain);

// Analyser
const analyserNode = audioCtx.createAnalyser();
analyserNode.fftSize = 256;

// Connecting
audioSource.connect(lowPass);
lowPass.connect(gainNode);
gainNode.connect(analyserNode);
analyserNode.connect(audioCtx.destination);


////////////////////////////////////////////////////////////////////////////////
// CANVAS
////////////////////////////////////////////////////////////////////////////////
const canvas = document.getElementById('canvas');
const canvasCtx = canvas.getContext('2d');
const canvasBCR = canvas.getBoundingClientRect();
canvas.width = canvasBCR.width;
canvas.height = canvasBCR.height;

const renderFrame = (ms) => {
  requestAnimationFrame(renderFrame);

  const audioData = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(audioData);

  // Clear canvas
  canvas.width = canvasBCR.width;
  const rest = Math.floor(canvas.width / audioData.length) - 1;
  const graphWidth = Math.round(audioData.length * rest);
  const graphHeight = Math.round(graphWidth / 4);

  // Draw frequencies
  canvasCtx.translate(Math.round((canvas.width - graphWidth) / 2),
      Math.round((canvas.height - graphHeight) / 2));

  canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  canvasCtx.fillRect(0, 0, graphWidth, graphHeight);

  canvasCtx.fillStyle = 'tomato';
  for (let i = 0; i < audioData.length; i++) {
    const barWidth = graphWidth / audioData.length;
    // 256 is themax value for a Uint8Array item
    const barHeight = audioData[i] * graphHeight / 256;
    canvasCtx.fillRect(Math.round(i * barWidth),
        Math.round(graphHeight - barHeight),
        Math.round(barWidth) - 1, Math.round(barHeight));
  }

  // Show filter frequency
  canvasCtx.fillStyle = 'rgba(0, 0, 0, .4)';
  const filterX = Math.round(lowPass.frequency.value * graphWidth / nyquist);
  canvasCtx.fillRect(filterX, 0, Math.round(graphWidth - filterX), graphHeight);
};

renderFrame(0);
