if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });
}

// DOM Elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const joinBtn = document.getElementById("joinBtn");
const muteMicBtn = document.getElementById("muteMicBtn");
const muteSpeakerBtn = document.getElementById("muteSpeakerBtn");
const endCallBtn = document.getElementById("endCallBtn");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const guessGameBtn = document.getElementById("guessGameBtn");
const youtubeWatchBtn = document.getElementById("youtubeWatchBtn"); // Added for YouTube
const gameContainer = document.getElementById("gameContainer");
const gameTitle = document.getElementById("gameTitle");
const gameContent = document.getElementById("gameContent");

// --- Global State ---
let localStream;
let peerConnection;
let isInitiator = false;
let signalingSocket;
let username = "User" + Math.floor(Math.random() * 1000);

// --- WebRTC Constants ---
const signalingServerUrl = "wss://webrtc-ttt.onrender.com";
const iceServers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" }
    ]
};

// --- YouTube Watch Party Variables ---
let player; // YouTube IFrame API Player object
let currentVideoId = "dQw4w9WgXcQ"; // Default video ID
let ignoreSync = false;


// --- WebRTC Functions ---
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log("✅ Local camera started.");
        return localStream;
    } catch (err) {
        console.error("❌ Failed to get local media stream:", err);
        throw err;
    }
}

async function createPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log("✅ Remote stream received.");
        }
    };
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log("➡️ Sending ICE candidate.");
            signalingSocket.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
        }
    };
}

async function startCall(initiator) {
    isInitiator = initiator;
    await createPeerConnection();
    if (isInitiator) {
        console.log("➡️ Creating WebRTC offer.");
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        signalingSocket.send(JSON.stringify({ type: 'offer', offer: offer }));
    }
}

async function joinCall() {
    try {
        await startLocalStream();
        signalingSocket = new WebSocket(signalingServerUrl);
        signalingSocket.onopen = () => {
            console.log("✅ Connected to signaling server.");
            signalingSocket.send(JSON.stringify({ type: 'client_ready', username: username }));
        };
        signalingSocket.onmessage = async (message) => {
            const data = JSON.parse(message.data);
            switch (data.type) {
                case 'peer_connected':
                    console.log("➡️ Another peer is available, starting call.");
                    startCall(true);
                    break;
                case 'offer':
                    console.log("⬅️ Received offer.");
                    startCall(false);
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    signalingSocket.send(JSON.stringify({ type: 'answer', answer: answer }));
                    break;
                case 'answer':
                    console.log("⬅️ Received answer.");
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    break;
                case 'candidate':
                    if (data.candidate) {
                        try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); console.log("⬅️ Added ICE candidate."); } catch (err) { console.error("❌ Error adding received ICE candidate:", err); }
                    }
                    break;
                case 'chat_message':
                    displayChatMessage(data.username, data.message);
                    break;
                case 'guess_game_state':
                    updateGuessingGameState(data);
                    break;
                case 'youtube_sync': // Handle YouTube sync messages
                    console.log("⬅️ Received YouTube sync message.");
                    applyYouTubeState(data);
                    break;
                case 'end_call':
                    console.log("❌ Remote peer ended the call.");
                    endCall();
                    break;
            }
        };
        joinBtn.classList.add('hidden');
        muteMicBtn.classList.remove('hidden');
        muteSpeakerBtn.classList.remove('hidden');
        endCallBtn.classList.remove('hidden');
        console.log('Joined the call. Streams are active.');
    } catch (err) {
        console.error("❌ Could not join call:", err);
    }
}

async function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    joinBtn.classList.remove('hidden');
    muteMicBtn.classList.add('hidden');
    muteSpeakerBtn.classList.add('hidden');
    endCallBtn.classList.add('hidden');
    isInitiator = false;
    console.log("❌ Call ended.");
    if (signalingSocket) {
        signalingSocket.send(JSON.stringify({ type: 'end_call' }));
        signalingSocket.close();
        signalingSocket = null;
    }
    // Stop YouTube Player when call ends
    if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
        player.destroy();
        player = null;
    }
}

function toggleAudio() {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteMicBtn.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
        muteMicBtn.classList.toggle('active', !audioTrack.enabled);
    }
}

function toggleVideo() {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        toggleVideoBtn.textContent = videoTrack.enabled ? 'Stop Video' : 'Start Video';
    }
}

joinBtn.addEventListener('click', joinCall);
muteMicBtn.addEventListener('click', toggleAudio);
endCallBtn.addEventListener('click', endCall);
muteSpeakerBtn.addEventListener('click', () => {
    if (!remoteVideo || !remoteVideo.srcObject) return;
    const remoteStream = remoteVideo.srcObject;
    const audioTrack = remoteStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        muteSpeakerBtn.textContent = audioTrack.enabled ? 'Mute Speaker' : 'Unmute Speaker';
    }
});

// --- Chat Logic ---
function displayChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: 'chat_message',
            username: username,
            message: message
        }));
        chatInput.value = '';
    }
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});

// --- YouTube Watch Party Functions (Shared Control) ---

// 1. Called by the YouTube IFrame API script when loaded
function onYouTubeIframeAPIReady() {
    console.log("✅ YouTube IFrame API Ready.");
    if (document.getElementById('youtube-player')) {
        createYouTubePlayer(currentVideoId);
    }
}

// 2. Creates the YouTube Player
function createYouTubePlayer(videoId) {
    if (player) {
        player.destroy();
    }
    player = new YT.Player('youtube-player', {
        height: '360',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'rel': 0, 
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

// 3. Called when the player is ready
function onPlayerReady(event) {
    console.log("✅ YouTube Player Ready.");
    // With shared control, we don't need a host check here.
}

// 4. Called when the player's state changes (play, pause, buffering, etc.)
function onPlayerStateChange(event) {
    if (ignoreSync) {
        ignoreSync = false;
        return;
    }

    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        let state = event.data;
        let currentTime = player.getCurrentTime();

        // Broadcast sync message for play (1), pause (2), or buffering (3)
        if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
            // ANY user action broadcasts the sync message
            sendYouTubeState(currentVideoId, state, currentTime);
            console.log("➡️ Broadcast control action from current user.");
        }
    }
}

// 5. Sends video state to the signaling server
function sendYouTubeState(videoId, playerState, currentTime) {
    signalingSocket.send(JSON.stringify({
        type: 'youtube_sync',
        videoId: videoId,
        state: playerState,
        time: currentTime,
        timestamp: Date.now()
    }));
    console.log(`➡️ Sending YouTube state: ${playerState} at ${currentTime}s`);
}

// 6. Applies the received video state from the peer
function applyYouTubeState(data) {
    const { videoId, state, time, timestamp } = data;
    
    // Load new video if IDs don't match
    if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        console.log(`⬅️ Loading new video: ${videoId}`);
        loadYouTubeWatchParty(videoId);
        return; 
    }

    if (!player || typeof player.loadVideoById !== 'function') return;
    
    // Calculate time correction for network latency
    const latency = (Date.now() - timestamp) / 1000; 
    let syncTime = time + latency; 

    // Prevent recursive sync loops
    ignoreSync = true; 

    // Sync playback state
    if (state === YT.PlayerState.PLAYING) {
        player.seekTo(syncTime, true);
        player.playVideo();
        console.log(`⬅️ Sync: Playing at ${syncTime.toFixed(2)}s (Latency: ${latency.toFixed(3)}s)`);
    } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
        player.pauseVideo();
        player.seekTo(syncTime, true); 
        console.log(`⬅️ Sync: Paused/Buffering at ${syncTime.toFixed(2)}s`);
    } else if (state === YT.PlayerState.ENDED) {
        player.stopVideo();
        console.log(`⬅️ Sync: Ended`);
    }
}

// 7. Loads the Watch Party view
function loadYouTubeWatchParty(videoId = currentVideoId) {
    gameTitle.textContent = "YouTube Watch Party";
    gameContent.innerHTML = `
        <div id="youtube-player-container" style="width: 100%; max-width: 640px; margin: 0 auto;">
            <div id="youtube-player"></div>
        </div>
        <div class="youtube-controls" style="margin-top: 20px; display: flex; gap: 10px;">
            <input type="text" id="videoIdInput" placeholder="Video ID or URL" style="padding: 10px; flex-grow: 1; border-radius: 8px; border: 1px solid #444; background: #333; color: #fff;">
            <button id="loadVideoBtn" class="game-btn" style="background-color: #e53935;">Load Video</button>
        </div>
        <p style="margin-top: 15px; color: #bdbdbd;">Control is **shared**. Anyone can play, pause, or seek the video.</p>
    `;
    
    const inputField = gameContent.querySelector('#videoIdInput');
    inputField.value = videoId;

    gameContent.querySelector('#loadVideoBtn').addEventListener('click', handleLoadVideo);

    if (window.YT && window.YT.Player) {
        createYouTubePlayer(videoId);
    } 
}

// 8. Handles loading a new video by ID/URL
function handleLoadVideo() {
    // No initiator check: anyone can load a video

    const input = document.getElementById('videoIdInput').value;
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|\w*[\/\?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = input.match(regex);
    let newVideoId;

    if (match && match[1]) {
        newVideoId = match[1];
    } else if (input.length === 11) {
        newVideoId = input;
    } else {
        alert("Invalid YouTube URL or Video ID.");
        return;
    }

    currentVideoId = newVideoId;
    
    // 1. Update the local player
    if (player && typeof player.loadVideoById === 'function') {
        player.loadVideoById(currentVideoId);
    } else {
         loadYouTubeWatchParty(currentVideoId);
    }
    
    // 2. Broadcast the change to the peer
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        sendYouTubeState(currentVideoId, YT.PlayerState.PAUSED, 0); 
    }
}


// --- Games Logic ---
let wordGuessingState = {};
const defaultWordList = ["PYTHON", "PROGRAMMING", "COMPUTER", "KEYBOARD", "DEVELOPER", "ALGORITHM", "VARIABLE"];
const API_KEY = "YOUR_GEMINI_API_KEY";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;


function handleGuessClick() {
    if (signalingSocket && wordGuessingState.gameStatus !== 'over') {
        const guessInput = gameContent.querySelector('#guessInput');
        const guess = guessInput.value.toUpperCase();
        signalingSocket.send(JSON.stringify({
            type: 'guess_game_move',
            guess: guess
        }));
        guessInput.value = '';
    }
}

function handleHintClick() {
    if (signalingSocket && wordGuessingState.gameStatus === 'playing') {
        signalingSocket.send(JSON.stringify({ type: 'guess_game_hint' }));
    }
}

function updateGuessingGameState(data) {
    wordGuessingState = data;
    const wordDisplay = gameContent.querySelector('#wordDisplay');
    const turnsDisplay = gameContent.querySelector('#turnsDisplay');
    const messageDisplay = gameContent.querySelector('#message');
    const usedLettersDisplay = gameContent.querySelector('#usedLetters');
    const hintDisplay = gameContent.querySelector('#hintDisplay');
    const guessInput = gameContent.querySelector('#guessInput');
    const guessBtn = gameContent.querySelector('#guessBtn');

    wordDisplay.textContent = wordGuessingState.displayWord.join(' ');
    turnsDisplay.textContent = `Turns left: ${wordGuessingState.turnsLeft}`;
    messageDisplay.textContent = wordGuessingState.message;
    usedLettersDisplay.textContent = `Used letters: ${Array.from(wordGuessingState.guessedLetters).join(', ')}`;
    hintDisplay.textContent = `Hint: ${wordGuessingState.hint}`;
    
    if (wordGuessingState.gameStatus === 'over') {
        guessInput.disabled = true;
        guessBtn.disabled = true;
    } else {
        guessInput.disabled = false;
        guessBtn.disabled = false;
    }
}

function loadGuessingGame() {
    gameTitle.textContent = "Word Guessing Game";
    gameContent.innerHTML = `
        <p class="message-display" id="message">Waiting for opponent...</p>
        <div class="word-display" id="wordDisplay"></div>
        <div class="turns-display" id="turnsDisplay"></div>
        <div class="game-input-group">
            <input type="text" id="guessInput" maxlength="1" placeholder="Guess a letter">
            <button id="guessBtn" class="game-btn">Guess</button>
        </div>
        <div id="hintDisplay"></div>
        <button id="getHintBtn" class="game-btn" style="background-color: #ff5722;">Get a Hint</button>
        <p class="used-letters" id="usedLetters"></p>
        <button class="restart-btn" id="restartBtn">Restart Game</button>
    `;
    gameContent.querySelector('#guessBtn').addEventListener('click', handleGuessClick);
    gameContent.querySelector('#getHintBtn').addEventListener('click', handleHintClick);
    gameContent.querySelector('#restartBtn').addEventListener('click', () => {
        if (signalingSocket) {
            signalingSocket.send(JSON.stringify({ type: 'guess_game_restart' }));
        }
    });
}

// Button listeners to load games/activities
guessGameBtn.addEventListener('click', loadGuessingGame);
youtubeWatchBtn.addEventListener('click', () => loadYouTubeWatchParty());

// Chess game button handler
document.getElementById("chessGameBtn").addEventListener("click", () => {
    document.getElementById("gameTitle").innerText = "Chess Game";
    document.getElementById("gameContent").innerHTML = `
        <iframe src="chess/index.html" 
                class="chess-frame"
                style="border:none;">
        </iframe>
    `;
});