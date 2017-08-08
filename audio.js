const AUDIO_URL = 'beats-90bpm.mp3';
const SAMPLE_RATE = 44100;

// BPM detection
const LP_FREQ = 150;
const HP_FREQ = 80;
const FILTER_Q = 3;
const MIN_BPM = 80;
const MAX_BPM = 180;

init();


////////////////////////////////////////////////////////////////////////////////
// DOM
////////////////////////////////////////////////////////////////////////////////

const wireCtrl = (ctrlId, param) => {
  const ctrl = document.getElementById(ctrlId);
  ctrl.addEventListener('input', _ => {
    param['value'] = ctrl.value;
  });
  param['value'] = ctrl.value
};

////////////////////////////////////////////////////////////////////////////////
// UI
////////////////////////////////////////////////////////////////////////////////
let analyserNode;

function playSong(response) {

  const audioCtx = new AudioContext();
  const nyquist = audioCtx.sampleRate / 2;

  audioCtx.decodeAudioData(response, function(buffer) {
    const audioSource = audioCtx.createBufferSource();
    audioSource.buffer = buffer;
    audioSource.loop = true;

    // Gain
    const gainNode = audioCtx.createGain();
    wireCtrl('volume', gainNode.gain);

    // Analyser
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;

    // Chain 1 - just out
    audioSource.connect(analyserNode);
    analyserNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    audioSource.start(0);
  });
}


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

  if (typeof analyserNode === 'undefined') return;

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

  canvasCtx.fillStyle = '#00d6b3';
  for (let i = 0; i < audioData.length; i++) {
    const barWidth = graphWidth / audioData.length;
    // 256 is themax value for a Uint8Array item
    const barHeight = audioData[i] * graphHeight / 256;
    canvasCtx.fillRect(Math.round(i * barWidth),
        Math.round(graphHeight - barHeight),
        Math.round(barWidth) - 1, Math.round(barHeight));
  }

  // Show filter frequency
  if (typeof lowPass !== 'undefined') {
    canvasCtx.fillStyle = 'rgba(0, 0, 0, .4)';
    const filterX = Math.round(lowPass.frequency.value * graphWidth / nyquist);
    canvasCtx.fillRect(filterX, 0, Math.round(graphWidth - filterX), graphHeight);
  }
};

renderFrame(0);


////////////////////////////////////////////////////////////////////////////////
// BPM DETECTION
////////////////////////////////////////////////////////////////////////////////

function getPeaks(data) {
  // Split audio into widows of 22050 samples each, i.e. 44100 / 22050 = 0.5s each.
  // For each window, we save the loudest sample and its position in samples
  const windowSize = SAMPLE_RATE / 2;
  const howManyWindows = data[0].length / windowSize;

  let peaks = [];
  for (var win = 0; win < howManyWindows; win++) {
    var max = 0;
    for (var sample = win * windowSize; sample < (win + 1) * windowSize; sample++) {
      var volume = Math.max(Math.abs(data[0][sample]), Math.abs(data[1][sample]));
      if (!max || (volume > max.volume)) {
        max = {
          position: sample,
          volume: volume
        };
      }
    }
    peaks.push(max);
  }

  // We want to take only the loudest half of the peaks.
  // Therefore, we sort by volume and discard the lower half.
  // We then sort back by position.
  peaks.sort((a, b) => b.volume - a.volume);
  peaks = peaks.splice(0, peaks.length * 0.5);
  peaks.sort((a, b) => a.position - b.position);

  return peaks;
}

function getIntervals(peaks) {
  // Measure the interval between all peaks (every peak with each subsequent peak)
  // and conpute the BPM for each interval. The interval with the highest count
  // is the most likely.
  let groups = [];
  const samplesInOneMinute = 60 * SAMPLE_RATE;
  peaks.forEach((currentPeak, index) => {
    for (var i = 1; (index + i) < peaks.length && i < 10; i++) {
      const samplesBewteenPeaks = peaks[index + i].position - currentPeak.position;
      const group = {
        bpm: samplesInOneMinute / samplesBewteenPeaks,
        count: 1
      };

      // Limit / approximate BPM betwwn MIN_BPM and MAN_BPM (e.g. 80 and 180 BPM).
      while (group.bpm < MIN_BPM) group.bpm *= 2;
      while (group.bpm > MAX_BPM) group.bpm /= 2;

      group.bpm = Math.round(group.bpm);

      const foundGroup = groups.find(g => g.bpm === group.bpm);
      if (typeof foundGroup === 'undefined') {
        groups.push(group);
      } else {
        foundGroup.count += 1;
      }
    }
  });

  // Keep the top 10 potential BPMs.
  groups = groups.sort((a, b) => b.count - a.count).slice(0, 10);

  // Clean the data. If 2 groups have a very similar BPM (±1),
  // keep only the one with the highest count.
  let splices = [];
  groups.sort((a, b) => b.bpm - a.bpm);
  for (let i = 0; i < groups.length - 1; i++) {
    // Skip last item.
    if (i === groups.length - 1) return;

    // If the difference between the 2 groups BPM is ±1.
    if (groups[i].bpm - groups[i + 1].bpm <= 1) {
      if (groups[i].count >= groups[i + 1].count) {
        splices.push(i + 1);
      } else {
        splices.push(i);
      }
    }
  };
  splices.forEach((s, i) => groups.splice(s - i, 1));

  // Sort again by most found.
  return groups.sort((a, b) => b.count - a.count);;
}

function detectBpm(response, trackDuration) {
  const offlineAudioContext = new OfflineAudioContext(
    2, // stereo
    44100 * trackDuration, // 60 seconds long buffer
    44100 // sample rate
  );

  offlineAudioContext.decodeAudioData(response, function(buffer) {
    const source = offlineAudioContext.createBufferSource();
    source.buffer = buffer;

    // Leave only HP_FREQ - LP_FREQ band (where the kick drum is).
    const lowpass = offlineAudioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = LP_FREQ;
    lowpass.Q.value = FILTER_Q;
    const highpass = offlineAudioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = HP_FREQ;
    highpass.Q.value = FILTER_Q;

    // Connect nodes.
    source.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(offlineAudioContext.destination);

    // Start the source, and render the output into the offline conext.
    source.start(0);
    offlineAudioContext.startRendering();
  });

  offlineAudioContext.oncomplete = function(e) {
    const buffer = e.renderedBuffer;
    const peaks = getPeaks([buffer.getChannelData(0), buffer.getChannelData(1)]);
    const groups = getIntervals(peaks);

    console.log(peaks);

    console.info(`DETECTED BPM: ${groups[0].bpm}`);
  };
}

////////////////////////////////////////////////////////////////////////////////
// GET METADATA
////////////////////////////////////////////////////////////////////////////////
function getMetaData(response) {
  return new Promise((resolve, reject) => {
    const offlineAudioContext = new OfflineAudioContext(2, 44100, 44100);
    offlineAudioContext.decodeAudioData(response, function(buffer) {
      resolve(buffer.duration);
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// INIT
////////////////////////////////////////////////////////////////////////////////

function init() {
  const request = new XMLHttpRequest();
  request.open('GET', AUDIO_URL, true);
  request.responseType = 'arraybuffer';
  request.onload = function() {
    getMetaData(request.response.slice(0))
      .then(trackDuration => {
        detectBpm(request.response.slice(0), trackDuration);
        playSong(request.response);
      });
  }

  request.send();
}
