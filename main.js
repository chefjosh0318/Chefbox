import { initScene, uVB } from './scene.js';
import {
  loadCFG,
  renderRevenue, renderPipeline, renderAgents, renderMembers,
  initConfirmModal, startPolling,
} from './data.js';
import {
  initMic, initMicButton, initTelegram, initSettings,
  initMembersModal, initPanelToggle, setAmplitudeCallback,
} from './voice.js';

// Load config first so CFG is populated before anything tries to use it
loadCFG();

// Boot Three.js scene
initScene();

// Route mic amplitude into the orb uniform
setAmplitudeCallback(amp => { uVB.value = amp; });

// Render static/default data immediately so panels aren't blank
renderRevenue(null);
renderPipeline(null);
renderAgents(null);
renderMembers(null);

// Wire all UI
initMic();
initMicButton();
initTelegram();
initSettings();
initMembersModal();
initPanelToggle();
initConfirmModal();

// Start data polling (60s interval)
startPolling(60000);
